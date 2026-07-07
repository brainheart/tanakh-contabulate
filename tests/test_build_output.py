import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
DATA = DOCS / "data"
LINES = DOCS / "lines"
COMMENTARY = DOCS / "commentary"
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
        DATA / "commentary_interest.json",
        COMMENTARY / "Gen.json",
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
    assert all(play["verse_count"] == play["total_lines"] for play in plays)


def test_chunks_and_lines_contain_hebrew_text():
    chunks = load_json(DATA / "chunks.json")
    lines = load_json(LINES / "all_lines.json")
    assert len(chunks) == len(lines) == 23213
    assert chunks[0]["canonical_id"] == "Gen.1.1"
    assert chunks[0]["verse_count"] == 1
    assert chunks[0]["commentary_interest"] > 300
    assert chunks[0]["commentary_rashi"] == 3
    assert HEBREW_RE.search(lines[0]["text"])
    assert "׃" in lines[0]["text"]
    assert lines[0]["commentary_interest"] == chunks[0]["commentary_interest"]


def test_commentary_summary_and_book_totals():
    commentary = load_json(DATA / "commentary_interest.json")
    plays = load_json(DATA / "plays.json")
    chunks = load_json(DATA / "chunks.json")
    genesis_detail = load_json(COMMENTARY / "Gen.json")

    assert commentary["metadata"]["source_id"] == "sefaria_tanakh_commentaries"
    assert len(commentary["metadata"]["commentators"]) >= 70
    assert commentary["metadata"]["detail_path_template"] == "commentary/{book}.json"
    assert len(commentary["metadata"]["detail_books"]) == 39
    assert commentary["summary"]["total_interest"] > 300000
    assert plays[0]["commentary_interest"] > 40000
    assert genesis_detail["book"] == "Gen"
    assert len(genesis_detail["sources"]) >= 50
    assert len(genesis_detail["verses"]["Gen.1.1"]) == chunks[0]["commentary_interest"]
    assert isinstance(genesis_detail["verses"]["Gen.1.1"][0][1], list)

    # Detail refs are clamped to the built corpus, so detail record totals
    # agree with the count columns at every level.
    genesis_canonical_ids = {c["canonical_id"] for c in chunks if c["play_abbr"] == "Gen"}
    assert set(genesis_detail["verses"]).issubset(genesis_canonical_ids)
    detail_total = sum(len(records) for records in genesis_detail["verses"].values())
    assert detail_total == plays[0]["commentary_interest"]


def test_name_filter_config_lists_proper_nouns_per_book():
    config = load_json(DATA / "character_name_filter_config.json")
    additions = config["play_additions"]
    assert len(additions) == 39
    assert "אברהם" in additions["Gen"]
    # Prefixed surface forms are included so they match the n-gram indexes.
    assert "לאברהם" in additions["Gen"]
    assert "בעז" in additions["Ruth"]
    assert len(additions["Gen"]) > 300
    # Common nouns must not leak into the name lists.
    assert "אלהים" not in additions["Gen"]


def test_token_stream_and_per_verse_text_metrics():
    tokens = load_json(DATA / "tokens.json")
    # Parashah layout markers (setumah/petuchah) must not be tokenized as words
    assert "ס" not in tokens
    assert "פ" not in tokens

    chunks = load_json(DATA / "chunks.json")
    assert {"name_count", "aramaic_count", "hapax_count"} <= set(chunks[0])
    sums = {}
    for c in chunks:
        b = sums.setdefault(c["play_abbr"], [0, 0, 0, 0])
        b[0] += c["name_count"]
        b[1] += c["aramaic_count"]
        b[2] += c["hapax_count"]
        b[3] += c["total_words"]
    assert sums["Dan"][1] / sums["Dan"][3] > 0.5  # Daniel is majority Aramaic
    assert sums["Gen"][1] == 2  # Laban's two Aramaic words (Gen 31:47)
    assert sums["Prov"][1] == 0  # no Aramaic in Proverbs
    assert sums["1Chr"][0] / sums["1Chr"][3] > 0.25  # Chronicles is name-dense
    assert sums["Song"][2] / sums["Song"][3] > 0.15  # Song of Songs hapax density


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
