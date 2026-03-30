import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

OSIS_NS = "http://www.bibletechnologies.net/2003/OSIS/namespace"
TOKEN_RE = re.compile(r"[A-Za-z]+")
IGNORED_TEXT_TAGS = {
    "date",
    "header",
    "language",
    "note",
    "publisher",
    "refSystem",
    "revisionDesc",
    "rights",
    "title",
    "work",
}
ALLOWED_TESTAMENTS = {"Old Testament", "New Testament"}


def localname(tag):
    return tag.rsplit("}", 1)[-1]


def normalize_ws(text):
    return " ".join((text or "").split())


def tokenize(text):
    return TOKEN_RE.findall((text or "").lower())


def iter_allowed_books(root):
    for group in root.iter():
        if localname(group.tag) != "div" or group.attrib.get("type") != "bookGroup":
            continue
        titles = [
            normalize_ws((child.text or ""))
            for child in group
            if localname(child.tag) == "title"
        ]
        testament = titles[0] if titles else ""
        if testament not in ALLOWED_TESTAMENTS:
            continue
        for child in group:
            if localname(child.tag) == "div" and child.attrib.get("type") == "book":
                yield testament, child


def extract_book_title(book_elem):
    for child in book_elem:
        if localname(child.tag) != "title":
            continue
        short = normalize_ws(child.attrib.get("short"))
        if short:
            return short
        text = normalize_ws(child.text)
        if text:
            return text
    return book_elem.attrib.get("osisID", "Unknown")


def extract_verses(book_elem):
    current_chapter = None
    current_verse = None
    verses = []

    def append_text(text):
        if current_verse is not None and text:
            current_verse["parts"].append(text)

    def finalize_current_verse():
        nonlocal current_verse
        if current_verse is None:
            return
        text = normalize_ws(" ".join(current_verse["parts"]))
        if text:
            current_verse["text"] = text
            verses.append(current_verse)
        current_verse = None

    def visit(elem):
        nonlocal current_chapter, current_verse
        tag = localname(elem.tag)
        if tag in IGNORED_TEXT_TAGS:
            return
        if current_verse is not None and tag not in {"chapter", "verse"}:
            append_text(elem.text)
        for child in elem:
            child_tag = localname(child.tag)
            if child_tag == "chapter" and "sID" in child.attrib:
                ref = child.attrib.get("osisRef") or child.attrib.get("n") or ""
                try:
                    current_chapter = int((ref.split(".")[-1] if "." in ref else ref) or 0)
                except ValueError:
                    current_chapter = None
            elif child_tag == "verse" and "sID" in child.attrib:
                osis_id = child.attrib.get("osisID", "")
                verse_num = child.attrib.get("n") or (osis_id.split(".")[-1] if osis_id else "")
                try:
                    verse_number = int(verse_num)
                except ValueError:
                    verse_number = None
                current_verse = {
                    "osis_id": osis_id,
                    "chapter": current_chapter,
                    "verse": verse_number,
                    "parts": [],
                }
            visit(child)
            if child_tag == "verse" and "eID" in child.attrib:
                finalize_current_verse()
                continue
            if current_verse is not None:
                append_text(child.tail)

    visit(book_elem)
    finalize_current_verse()
    return verses


def clean_dir_json_files(path):
    path.mkdir(parents=True, exist_ok=True)
    for json_path in path.glob("*.json"):
        json_path.unlink()


def format_location(book_id, book_abbr, chapter=None, verse=None):
    location = f"{int(book_id):02d}.{book_abbr}"
    if chapter is not None:
        location = f"{location}.{int(chapter):03d}"
    if verse is not None:
        location = f"{location}.{int(verse):03d}"
    return location


def build(source_path: Path, out_dir: Path):
    tree = ET.parse(source_path)
    root = tree.getroot()

    data_dir = out_dir / "data"
    lines_dir = out_dir / "lines"
    clean_dir_json_files(data_dir)
    clean_dir_json_files(lines_dir)

    plays = []
    chunks = []
    all_lines = []
    tokens = {}
    tokens2 = {}
    tokens3 = {}

    verse_id = 0

    for book_id, (testament, book_elem) in enumerate(iter_allowed_books(root), start=1):
        book_abbr = book_elem.attrib.get("osisID", f"BOOK{book_id}")
        book_title = extract_book_title(book_elem)
        verses = extract_verses(book_elem)
        chapter_numbers = sorted({v["chapter"] for v in verses if v.get("chapter") is not None})
        book_total_words = 0

        for verse in verses:
            text = verse["text"]
            toks = tokenize(text)
            if not toks:
                continue
            verse_id += 1
            chapter_num = int(verse["chapter"] or 0)
            verse_num = int(verse["verse"] or 0)
            canonical_id = verse["osis_id"] or f"{book_abbr}.{chapter_num}.{verse_num}"
            location = format_location(book_id, book_abbr, chapter_num, verse_num)
            unique_words = len(set(toks))
            total_words = len(toks)
            book_total_words += total_words

            chunk_row = {
                "scene_id": verse_id,
                "canonical_id": canonical_id,
                "location": location,
                "play_id": book_id,
                "play_title": book_title,
                "play_abbr": book_abbr,
                "genre": testament,
                "act": chapter_num,
                "scene": verse_num,
                "heading": f"{book_title} {chapter_num}:{verse_num}",
                "total_words": total_words,
                "unique_words": unique_words,
                "num_speeches": 0,
                "num_lines": 1,
                "characters_present_count": 0,
            }
            chunks.append(chunk_row)
            all_lines.append(
                {
                    "play_id": book_id,
                    "canonical_id": canonical_id,
                    "location": location,
                    "act": chapter_num,
                    "scene": verse_num,
                    "line_num": verse_id,
                    "speaker": "",
                    "text": text,
                }
            )

            verse_unigrams = {}
            verse_bigrams = {}
            verse_trigrams = {}
            for tok in toks:
                verse_unigrams[tok] = verse_unigrams.get(tok, 0) + 1
            for idx in range(len(toks) - 1):
                bigram = f"{toks[idx]} {toks[idx + 1]}"
                verse_bigrams[bigram] = verse_bigrams.get(bigram, 0) + 1
            for idx in range(len(toks) - 2):
                trigram = f"{toks[idx]} {toks[idx + 1]} {toks[idx + 2]}"
                verse_trigrams[trigram] = verse_trigrams.get(trigram, 0) + 1

            for term, count in verse_unigrams.items():
                tokens.setdefault(term, []).append([verse_id, count])
            for term, count in verse_bigrams.items():
                tokens2.setdefault(term, []).append([verse_id, count])
            for term, count in verse_trigrams.items():
                tokens3.setdefault(term, []).append([verse_id, count])

        plays.append(
            {
                "play_id": book_id,
                "location": format_location(book_id, book_abbr),
                "title": book_title,
                "abbr": book_abbr,
                "genre": testament,
                "first_performance_year": None,
                "num_acts": len(chapter_numbers),
                "num_scenes": len(verses),
                "num_speeches": 0,
                "total_words": book_total_words,
                "total_lines": len(verses),
            }
        )

    (data_dir / "plays.json").write_text(
        json.dumps(plays, ensure_ascii=False), encoding="utf-8"
    )
    (data_dir / "chunks.json").write_text(
        json.dumps(chunks, ensure_ascii=False), encoding="utf-8"
    )
    (data_dir / "characters.json").write_text("[]", encoding="utf-8")
    (data_dir / "tokens.json").write_text(
        json.dumps(tokens, ensure_ascii=False), encoding="utf-8"
    )
    (data_dir / "tokens2.json").write_text(
        json.dumps(tokens2, ensure_ascii=False), encoding="utf-8"
    )
    (data_dir / "tokens3.json").write_text(
        json.dumps(tokens3, ensure_ascii=False), encoding="utf-8"
    )
    (data_dir / "tokens_char.json").write_text("{}", encoding="utf-8")
    (data_dir / "tokens_char2.json").write_text("{}", encoding="utf-8")
    (data_dir / "tokens_char3.json").write_text("{}", encoding="utf-8")
    (data_dir / "character_name_filter_config.json").write_text(
        json.dumps(
            {
                "global_additions": [],
                "global_removals": [],
                "play_additions": {},
                "play_removals": {},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (lines_dir / "all_lines.json").write_text(
        json.dumps(all_lines, ensure_ascii=False), encoding="utf-8"
    )

    return {
        "book_count": len(plays),
        "verse_count": len(chunks),
        "line_count": len(all_lines),
    }


if __name__ == "__main__":
    base = Path(__file__).parent
    source_path = base / "osis" / "eng-kjv.osis.xml"
    out_dir = base / "docs"
    print(f"Building from {source_path} -> {out_dir}")
    result = build(source_path, out_dir)
    print(
        "Done: "
        f"{result['book_count']} books, "
        f"{result['verse_count']} verses, "
        f"{result['line_count']} verse rows written to {out_dir}"
    )
