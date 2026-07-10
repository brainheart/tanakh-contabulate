import datetime
import json
import math
import re
import shutil
import unicodedata
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

OSIS_NS = "http://www.bibletechnologies.net/2003/OSIS/namespace"
NS = {"osis": OSIS_NS}

HEBREW_LETTER_RE = re.compile(r"[\u05D0-\u05EA]+")
HEBREW_TOKEN_RE = re.compile(r"[\u05D0-\u05EA]+(?:[\u05F3\u05F4'\"]?[\u05D0-\u05EA]+)*")
STRIP_POINTS_RE = re.compile(r"[\u0591-\u05BD\u05BF-\u05C7]")
SLASH_RE = re.compile(r"/+")
WHITESPACE_RE = re.compile(r"\s+")
COMMENTARY_INTEREST_SOURCE = "sefaria_tanakh_commentary_interest.json"
COMMENTARY_DETAIL_SOURCE_DIR = "details"
SENT_RE = re.compile(r"[׃.!?]+")  # sof pasuq or western terminators

BOOK_ORDER = [
    ("Torah", "תורה", "Gen", "בראשית", "Genesis"),
    ("Torah", "תורה", "Exod", "שמות", "Exodus"),
    ("Torah", "תורה", "Lev", "ויקרא", "Leviticus"),
    ("Torah", "תורה", "Num", "במדבר", "Numbers"),
    ("Torah", "תורה", "Deut", "דברים", "Deuteronomy"),
    ("Nevi'im", "נביאים", "Josh", "יהושע", "Joshua"),
    ("Nevi'im", "נביאים", "Judg", "שופטים", "Judges"),
    ("Nevi'im", "נביאים", "1Sam", "שמואל א", "1 Samuel"),
    ("Nevi'im", "נביאים", "2Sam", "שמואל ב", "2 Samuel"),
    ("Nevi'im", "נביאים", "1Kgs", "מלכים א", "1 Kings"),
    ("Nevi'im", "נביאים", "2Kgs", "מלכים ב", "2 Kings"),
    ("Nevi'im", "נביאים", "Isa", "ישעיהו", "Isaiah"),
    ("Nevi'im", "נביאים", "Jer", "ירמיהו", "Jeremiah"),
    ("Nevi'im", "נביאים", "Ezek", "יחזקאל", "Ezekiel"),
    ("Nevi'im", "נביאים", "Hos", "הושע", "Hosea"),
    ("Nevi'im", "נביאים", "Joel", "יואל", "Joel"),
    ("Nevi'im", "נביאים", "Amos", "עמוס", "Amos"),
    ("Nevi'im", "נביאים", "Obad", "עובדיה", "Obadiah"),
    ("Nevi'im", "נביאים", "Jonah", "יונה", "Jonah"),
    ("Nevi'im", "נביאים", "Mic", "מיכה", "Micah"),
    ("Nevi'im", "נביאים", "Nah", "נחום", "Nahum"),
    ("Nevi'im", "נביאים", "Hab", "חבקוק", "Habakkuk"),
    ("Nevi'im", "נביאים", "Zeph", "צפניה", "Zephaniah"),
    ("Nevi'im", "נביאים", "Hag", "חגי", "Haggai"),
    ("Nevi'im", "נביאים", "Zech", "זכריה", "Zechariah"),
    ("Nevi'im", "נביאים", "Mal", "מלאכי", "Malachi"),
    ("Ketuvim", "כתובים", "Ps", "תהילים", "Psalms"),
    ("Ketuvim", "כתובים", "Prov", "משלי", "Proverbs"),
    ("Ketuvim", "כתובים", "Job", "איוב", "Job"),
    ("Ketuvim", "כתובים", "Song", "שיר השירים", "Song of Songs"),
    ("Ketuvim", "כתובים", "Ruth", "רות", "Ruth"),
    ("Ketuvim", "כתובים", "Lam", "איכה", "Lamentations"),
    ("Ketuvim", "כתובים", "Eccl", "קהלת", "Ecclesiastes"),
    ("Ketuvim", "כתובים", "Esth", "אסתר", "Esther"),
    ("Ketuvim", "כתובים", "Dan", "דניאל", "Daniel"),
    ("Ketuvim", "כתובים", "Ezra", "עזרא", "Ezra"),
    ("Ketuvim", "כתובים", "Neh", "נחמיה", "Nehemiah"),
    ("Ketuvim", "כתובים", "1Chr", "דברי הימים א", "1 Chronicles"),
    ("Ketuvim", "כתובים", "2Chr", "דברי הימים ב", "2 Chronicles"),
]

SECTION_ORDER = [("Torah", "תורה"), ("Nevi'im", "נביאים"), ("Ketuvim", "כתובים")]
SECTION_IDS = {english: idx for idx, (english, _) in enumerate(SECTION_ORDER, start=1)}

BOOK_META = {
    abbr: {
        "section_en": section_en,
        "section_he": section_he,
        "abbr": abbr,
        "title_he": title_he,
        "title_en": title_en,
        "display_title": f"{title_he} ({title_en})",
    }
    for section_en, section_he, abbr, title_he, title_en in BOOK_ORDER
}


def clean_output_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    for subdir_name in ("data", "lines", "commentary"):
        subdir = path / subdir_name
        if subdir.exists():
            shutil.rmtree(subdir)
        subdir.mkdir(parents=True, exist_ok=True)


def normalize_display_ws(text: str) -> str:
    return WHITESPACE_RE.sub(" ", (text or "")).strip()


def remove_hebrew_points(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text or "")
    stripped = STRIP_POINTS_RE.sub("", decomposed)
    return unicodedata.normalize("NFC", stripped)


def normalize_search_text(text: str) -> str:
    text = remove_hebrew_points(text)
    text = SLASH_RE.sub("", text)
    text = normalize_display_ws(text).lower()
    return text


def tokenize_hebrew(text: str) -> list[str]:
    normalized = normalize_search_text(text)
    return [match.group(0) for match in HEBREW_TOKEN_RE.finditer(normalized)]


def count_sentences(text):
    return len(SENT_RE.findall(text or ""))


def mattr(tokens, window=50):
    """Moving-average type-token ratio: lexical diversity comparable across lengths."""
    if not tokens:
        return 0.0
    if len(tokens) < window:
        return len(set(tokens)) / len(tokens)
    ratios = [
        len(set(tokens[i:i + window])) / window
        for i in range(len(tokens) - window + 1)
    ]
    return sum(ratios) / len(ratios)


def extract_word_text(word_elem: ET.Element) -> str:
    text = "".join(word_elem.itertext())
    text = text.replace("/", "")
    return normalize_display_ws(text)


# Proper-noun segment in a morphhb morph code ("HNp", "HR/Np", "HC/R/Np", ...).
NAME_MORPH_RE = re.compile(r"(?:^|/)[HA]?Np")


def extract_proper_name_tokens(xml_path: Path) -> set[str]:
    """Word forms (including attached prefixes) whose morphology contains a
    proper-noun segment, normalized like search tokens so they match the
    n-gram indexes exactly."""
    root = ET.parse(xml_path).getroot()
    names = set()
    for word_elem in root.findall(".//osis:w", NS):
        morph = word_elem.attrib.get("morph", "")
        if not NAME_MORPH_RE.search(morph):
            continue
        for token in tokenize_hebrew(extract_word_text(word_elem)):
            names.add(token)
    return names


def seg_text(seg_elem: ET.Element) -> str:
    text = normalize_display_ws("".join(seg_elem.itertext()))
    seg_type = seg_elem.attrib.get("type")
    if seg_type == "x-maqqef":
        return "־"
    return text


def join_verse_parts(parts: list[str]) -> str:
    text = ""
    no_space_before = {"׃", "־", ",", ".", ";", ":", "!", "?", ")", "]", "}", "׳", "״"}
    no_space_after = {"(", "[", "{", "־"}
    for part in parts:
        if not part:
            continue
        if not text:
            text = part
            continue
        if part in no_space_before or text[-1] in no_space_after:
            text += part
        else:
            text += " " + part
    return normalize_display_ws(text)


def parse_book(xml_path: Path) -> list[dict]:
    root = ET.parse(xml_path).getroot()
    verses = []
    for chapter_elem in root.findall(".//osis:chapter", NS):
        chapter_ref = chapter_elem.attrib.get("osisID", "")
        chapter_num = int(chapter_ref.split(".")[-1])
        for verse_elem in chapter_elem.findall("./osis:verse", NS):
            verse_ref = verse_elem.attrib.get("osisID", "")
            verse_num = int(verse_ref.split(".")[-1])
            parts = []
            word_parts = []
            name_count = 0
            aramaic_count = 0
            for child in verse_elem:
                local = child.tag.rsplit("}", 1)[-1]
                if local == "w":
                    word = extract_word_text(child)
                    if word:
                        parts.append(word)
                        word_parts.append(word)
                        morph = child.attrib.get("morph", "")
                        if NAME_MORPH_RE.search(morph):
                            name_count += 1
                        if morph.startswith("A"):
                            aramaic_count += 1
                elif local == "seg":
                    punctuation = seg_text(child)
                    if punctuation:
                        parts.append(punctuation)
            text = join_verse_parts(parts)
            verses.append(
                {
                    "canonical_id": verse_ref,
                    "chapter": chapter_num,
                    "verse": verse_num,
                    "text": text,
                    # Words only: keeps layout segs (the setumah/petuchah
                    # parashah markers ס and פ) out of the token stream
                    "token_text": " ".join(word_parts),
                    "name_count": name_count,
                    "aramaic_count": aramaic_count,
                }
            )
    return verses


def format_location(section_id: int, book_id: int, abbr: str, chapter: int | None = None, verse: int | None = None) -> str:
    location = f"{section_id:02d}.{book_id:02d}.{abbr}"
    if chapter is not None:
        location += f".{chapter:03d}"
    if verse is not None:
        location += f".{verse:03d}"
    return location


def write_json(path: Path, payload) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def load_commentary_interest(project_root: Path):
    source_path = project_root / "commentary" / COMMENTARY_INTEREST_SOURCE
    if not source_path.exists():
        return {"metadata": {"commentators": []}, "summary": {}, "verses": {}}
    payload = json.loads(source_path.read_text(encoding="utf-8"))
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    verses = payload.get("verses") if isinstance(payload.get("verses"), dict) else {}
    return {"metadata": metadata, "summary": summary, "verses": verses}


def write_commentary_details(project_root: Path, out_dir: Path, canonical_ids):
    """Copy per-book comment detail files, dropping refs to verses outside the
    built corpus so detail lists agree with the count columns everywhere."""
    source_dir = project_root / "commentary" / COMMENTARY_DETAIL_SOURCE_DIR
    target_dir = out_dir / "commentary"
    copied_books = []
    if not source_dir.exists():
        return copied_books
    for source_path in sorted(source_dir.glob("*.json")):
        payload = json.loads(source_path.read_text(encoding="utf-8"))
        verses = payload.get("verses") if isinstance(payload.get("verses"), dict) else {}
        payload["verses"] = {
            canonical_id: records
            for canonical_id, records in verses.items()
            if canonical_id in canonical_ids
        }
        target_path = target_dir / source_path.name
        target_path.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        copied_books.append(source_path.stem)
    return copied_books


def get_commentary_columns(metadata):
    columns = []
    for item in metadata.get("commentators", []):
        key = normalize_display_ws(str(item.get("key", "")))
        if not key:
            continue
        columns.append(
            {
                "key": key,
                "name": normalize_display_ws(str(item.get("name", key))),
                "label": normalize_display_ws(str(item.get("label", item.get("name", key)))),
            }
        )
    return columns


def empty_commentary_fields(commentary_columns):
    return {"commentary_interest": 0}


def commentary_fields_for(canonical_id, commentary_verses, commentary_columns):
    fields = empty_commentary_fields(commentary_columns)
    item = commentary_verses.get(canonical_id) or {}
    try:
        fields["commentary_interest"] = int(item.get("total") or 0)
    except (TypeError, ValueError):
        fields["commentary_interest"] = 0
    by_commentator = item.get("by_commentator") if isinstance(item.get("by_commentator"), dict) else {}
    for column in commentary_columns:
        try:
            count = int(by_commentator.get(column["key"]) or 0)
        except (TypeError, ValueError):
            count = 0
        if count:
            fields[f"commentary_{column['key']}"] = count
    return fields


def build(source_dir: Path, out_dir: Path) -> None:
    clean_output_dir(out_dir)
    data_dir = out_dir / "data"
    lines_dir = out_dir / "lines"
    project_root = source_dir.parent
    commentary_interest = load_commentary_interest(project_root)
    commentary_metadata = dict(commentary_interest["metadata"])
    commentary_summary = commentary_interest["summary"]
    commentary_verses = commentary_interest["verses"]
    commentary_columns = get_commentary_columns(commentary_metadata)

    plays = []
    characters = []
    chunks = []
    all_lines = []
    tokens = defaultdict(list)
    tokens2 = defaultdict(list)
    tokens3 = defaultdict(list)

    verse_id = 0
    name_filter_play_additions = {}

    for book_id, (_, _, abbr, _, _) in enumerate(BOOK_ORDER, start=1):
        meta = BOOK_META[abbr]
        section_id = SECTION_IDS[meta["section_en"]]
        xml_path = source_dir / f"{abbr}.xml"
        if not xml_path.exists():
            raise FileNotFoundError(f"Missing source book: {xml_path}")

        verses = parse_book(xml_path)
        name_filter_play_additions[abbr] = sorted(extract_proper_name_tokens(xml_path))
        book_total_words = 0
        book_tokens = []  # ordered token stream for book-level MATTR
        book_commentary_fields = empty_commentary_fields(commentary_columns)
        chapter_numbers = sorted({verse["chapter"] for verse in verses})

        for verse in verses:
            verse_tokens = tokenize_hebrew(verse["token_text"])
            if not verse_tokens:
                continue

            verse_id += 1
            total_words = len(verse_tokens)
            unique_words = len(set(verse_tokens))
            book_total_words += total_words
            book_tokens.extend(verse_tokens)

            heading = f"{meta['title_he']} {verse['chapter']}:{verse['verse']} ({meta['title_en']})"
            location = format_location(section_id, book_id, abbr, verse["chapter"], verse["verse"])
            verse_commentary_fields = commentary_fields_for(
                verse["canonical_id"], commentary_verses, commentary_columns
            )
            for key, value in verse_commentary_fields.items():
                book_commentary_fields[key] = book_commentary_fields.get(key, 0) + value

            chunk_row = {
                "scene_id": verse_id,
                "canonical_id": verse["canonical_id"],
                "location": location,
                "play_id": book_id,
                "play_title": meta["display_title"],
                "play_abbr": abbr,
                "genre": meta["section_he"],
                "act": verse["chapter"],
                "scene": verse["verse"],
                "heading": heading,
                "total_words": total_words,
                "unique_words": unique_words,
                "num_speeches": 0,
                "num_lines": 1,
                "verse_count": 1,
                "characters_present_count": 0,
                "sentence_count": count_sentences(verse["text"]),
                "name_count": verse["name_count"],
                "aramaic_count": verse["aramaic_count"],
            }
            chunk_row.update(verse_commentary_fields)
            chunks.append(chunk_row)

            line_row = {
                "play_id": book_id,
                "canonical_id": verse["canonical_id"],
                "location": location,
                "act": verse["chapter"],
                "scene": verse["verse"],
                "line_num": verse_id,
                "speaker": "",
                "text": verse["text"],
            }
            line_row.update(verse_commentary_fields)
            all_lines.append(line_row)

            verse_unigrams = defaultdict(int)
            verse_bigrams = defaultdict(int)
            verse_trigrams = defaultdict(int)

            for token in verse_tokens:
                verse_unigrams[token] += 1
            for idx in range(len(verse_tokens) - 1):
                verse_bigrams[f"{verse_tokens[idx]} {verse_tokens[idx + 1]}"] += 1
            for idx in range(len(verse_tokens) - 2):
                verse_trigrams[
                    f"{verse_tokens[idx]} {verse_tokens[idx + 1]} {verse_tokens[idx + 2]}"
                ] += 1

            for term, count in verse_unigrams.items():
                tokens[term].append([verse_id, count])
            for term, count in verse_bigrams.items():
                tokens2[term].append([verse_id, count])
            for term, count in verse_trigrams.items():
                tokens3[term].append([verse_id, count])

        book_row = {
            "play_id": book_id,
            "location": format_location(section_id, book_id, abbr),
            "title": meta["display_title"],
            "abbr": abbr,
            "genre": meta["section_he"],
            "first_performance_year": None,
            "num_acts": len(chapter_numbers),
            "num_scenes": len(verses),
            "num_speeches": 0,
            "total_words": book_total_words,
            "total_lines": len(verses),
            "verse_count": len(verses),
            "mattr_50": round(mattr(book_tokens), 3),
        }
        book_row.update(book_commentary_fields)
        plays.append(book_row)

    # Additive metric fields (char_count, rarity_sum) per verse. The UI derives
    # ratio metrics (mean word length, lexical rarity) at any aggregation level
    # by summing these and dividing by total words.
    corpus_freq = {tok: sum(c for _, c in postings) for tok, postings in tokens.items()}
    corpus_total = sum(corpus_freq.values()) or 1
    tok_rarity = {tok: -math.log10(f / corpus_total) for tok, f in corpus_freq.items()}
    verse_chars = {}
    verse_rarity = {}
    verse_hapax = {}
    for tok, postings in tokens.items():
        length = len(tok)
        rarity = tok_rarity[tok]
        is_hapax = corpus_freq[tok] == 1
        for vid, count in postings:
            verse_chars[vid] = verse_chars.get(vid, 0) + length * count
            verse_rarity[vid] = verse_rarity.get(vid, 0.0) + rarity * count
            if is_hapax:
                verse_hapax[vid] = verse_hapax.get(vid, 0) + count
    for chunk_row in chunks:
        vid = chunk_row["scene_id"]
        chunk_row["char_count"] = verse_chars.get(vid, 0)
        chunk_row["rarity_sum"] = round(verse_rarity.get(vid, 0.0), 3)
        chunk_row["hapax_count"] = verse_hapax.get(vid, 0)

    canonical_ids = {chunk_row["canonical_id"] for chunk_row in chunks}
    commentary_detail_books = write_commentary_details(project_root, out_dir, canonical_ids)
    if commentary_detail_books:
        commentary_metadata["detail_path_template"] = "commentary/{book}.json"
        commentary_metadata["detail_books"] = commentary_detail_books

    instance_meta_path = project_root / "instance-meta.json"
    instance_meta = json.loads(instance_meta_path.read_text(encoding="utf-8")) if instance_meta_path.exists() else {}
    instance_payload = {
        "schema": 1,
        **instance_meta,
        "updated": datetime.date.today().isoformat(),
        "stats": {
            "texts": len(plays),
            "text_label": instance_meta.get("text_label", "books"),
            "segments": len(chunks),
            "segment_label": instance_meta.get("segment_label", "verses"),
            "words": sum(p.get("total_words", 0) for p in plays),
            "distinct_words": len(tokens),
            "commentaries": len(commentary_metadata.get("commentators", [])),
            "comments": int(commentary_summary.get("total_interest", 0) or 0),
        },
    }
    instance_payload.pop("text_label", None)
    instance_payload.pop("segment_label", None)
    (out_dir / "instance.json").write_text(
        json.dumps(instance_payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    write_json(data_dir / "plays.json", plays)
    write_json(data_dir / "characters.json", characters)
    write_json(data_dir / "chunks.json", chunks)
    write_json(data_dir / "tokens.json", dict(tokens))
    write_json(data_dir / "tokens2.json", dict(tokens2))
    write_json(data_dir / "tokens3.json", dict(tokens3))
    write_json(
        data_dir / "commentary_interest.json",
        {
            "metadata": commentary_metadata,
            "summary": {
                **commentary_summary,
                "source_file": COMMENTARY_INTEREST_SOURCE,
            },
        },
    )
    write_json(data_dir / "tokens_char.json", {})
    write_json(data_dir / "tokens_char2.json", {})
    write_json(data_dir / "tokens_char3.json", {})
    write_json(
        data_dir / "character_name_filter_config.json",
        {
            "global_additions": [],
            "global_removals": [],
            "play_additions": name_filter_play_additions,
            "play_removals": {},
        },
    )
    write_json(lines_dir / "all_lines.json", all_lines)


if __name__ == "__main__":
    build(Path("source_text"), Path("docs"))
