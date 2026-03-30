import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
DATA = DOCS / "data"
LINES = DOCS / "lines"
HEBREW_RE = re.compile(r"[\u05D0-\u05EA]")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_expected_output_files_exist_and_are_nonempty():
    expected = [
        DATA / "plays.json",
        DATA / "characters.json",
        DATA / "chunks.json",
        DATA / "tokens.json",
        DATA / "tokens2.json",
        DATA / "tokens3.json",
        DATA / "tokens_char.json",
        DATA / "tokens_char2.json",
        DATA / "tokens_char3.json",
        DATA / "character_name_filter_config.json",
        LINES / "all_lines.json",
    ]
    for path in expected:
        assert path.exists(), f"missing output file: {path}"
        assert path.stat().st_size > 0, f"empty output file: {path}"


def test_book_and_section_structure_matches_tanakh():
    plays = load_json(DATA / "plays.json")
    assert len(plays) == 39
    assert plays[0]["title"].startswith("בראשית")
    assert plays[-1]["title"].startswith("דברי הימים ב")
    assert {play["genre"] for play in plays} == {"תורה", "נביאים", "כתובים"}


def test_chunks_and_lines_contain_hebrew_text():
    chunks = load_json(DATA / "chunks.json")
    lines = load_json(LINES / "all_lines.json")
    assert len(chunks) == len(lines) == 23213
    assert chunks[0]["canonical_id"] == "Gen.1.1"
    assert HEBREW_RE.search(lines[0]["text"])
    assert "׃" in lines[0]["text"]


def test_token_indexes_include_common_hebrew_terms():
    tokens = load_json(DATA / "tokens.json")
    tokens2 = load_json(DATA / "tokens2.json")
    tokens3 = load_json(DATA / "tokens3.json")

    assert "אלהים" in tokens
    assert "בראשית" in tokens
    assert "יהוה" in tokens
    assert "יהוה אלהים" in tokens2
    assert "בראשית ברא אלהים" in tokens3

    assert len(tokens["אלהים"]) > 100
    assert len(tokens2["יהוה אלהים"]) > 10
    assert len(tokens3["בראשית ברא אלהים"]) == 1
