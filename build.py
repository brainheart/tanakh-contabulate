import json
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
    for subdir_name in ("data", "lines"):
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


def extract_word_text(word_elem: ET.Element) -> str:
    text = "".join(word_elem.itertext())
    text = text.replace("/", "")
    return normalize_display_ws(text)


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
            for child in verse_elem:
                local = child.tag.rsplit("}", 1)[-1]
                if local == "w":
                    word = extract_word_text(child)
                    if word:
                        parts.append(word)
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


def build(source_dir: Path, out_dir: Path) -> None:
    clean_output_dir(out_dir)
    data_dir = out_dir / "data"
    lines_dir = out_dir / "lines"

    plays = []
    characters = []
    chunks = []
    all_lines = []
    tokens = defaultdict(list)
    tokens2 = defaultdict(list)
    tokens3 = defaultdict(list)

    verse_id = 0

    for book_id, (_, _, abbr, _, _) in enumerate(BOOK_ORDER, start=1):
        meta = BOOK_META[abbr]
        section_id = SECTION_IDS[meta["section_en"]]
        xml_path = source_dir / f"{abbr}.xml"
        if not xml_path.exists():
            raise FileNotFoundError(f"Missing source book: {xml_path}")

        verses = parse_book(xml_path)
        book_total_words = 0
        chapter_numbers = sorted({verse["chapter"] for verse in verses})

        for verse in verses:
            verse_tokens = tokenize_hebrew(verse["text"])
            if not verse_tokens:
                continue

            verse_id += 1
            total_words = len(verse_tokens)
            unique_words = len(set(verse_tokens))
            book_total_words += total_words

            heading = f"{meta['title_he']} {verse['chapter']}:{verse['verse']} ({meta['title_en']})"
            location = format_location(section_id, book_id, abbr, verse["chapter"], verse["verse"])

            chunks.append(
                {
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
                    "characters_present_count": 0,
                }
            )

            all_lines.append(
                {
                    "play_id": book_id,
                    "canonical_id": verse["canonical_id"],
                    "location": location,
                    "act": verse["chapter"],
                    "scene": verse["verse"],
                    "line_num": verse_id,
                    "speaker": "",
                    "text": verse["text"],
                }
            )

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

        plays.append(
            {
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
            }
        )

    write_json(data_dir / "plays.json", plays)
    write_json(data_dir / "characters.json", characters)
    write_json(data_dir / "chunks.json", chunks)
    write_json(data_dir / "tokens.json", dict(tokens))
    write_json(data_dir / "tokens2.json", dict(tokens2))
    write_json(data_dir / "tokens3.json", dict(tokens3))
    write_json(data_dir / "tokens_char.json", {})
    write_json(data_dir / "tokens_char2.json", {})
    write_json(data_dir / "tokens_char3.json", {})
    write_json(
        data_dir / "character_name_filter_config.json",
        {
            "global_additions": [],
            "global_removals": [],
            "play_additions": {},
            "play_removals": {},
        },
    )
    write_json(lines_dir / "all_lines.json", all_lines)


if __name__ == "__main__":
    build(Path("source_text"), Path("docs"))
