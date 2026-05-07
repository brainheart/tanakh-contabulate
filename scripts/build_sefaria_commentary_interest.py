import argparse
import concurrent.futures
import json
import re
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


BOOKS_JSON_URL = "https://raw.githubusercontent.com/Sefaria/Sefaria-Export/master/books.json"
SOURCE_URL = "https://github.com/Sefaria/Sefaria-Export"
GCS_BASE_URL = "https://storage.googleapis.com/sefaria-export/"
ALLOWED_COMMENTARY_CATEGORIES = {
    "Rishonim on Tanakh",
    "Acharonim on Tanakh",
    "Modern Commentary on Tanakh",
}
BOOK_CATEGORY_NAMES = {"Torah", "Prophets", "Writings"}
CHAPTER_LABELS = {"Chapter", "Perek"}
VERSE_LABELS = {"Verse", "Pasuk"}

BOOK_TITLE_TO_ABBR = {
    "genesis": "Gen",
    "bereshit": "Gen",
    "bereishit": "Gen",
    "bereishis": "Gen",
    "beresheet": "Gen",
    "exodus": "Exod",
    "shemot": "Exod",
    "shemos": "Exod",
    "leviticus": "Lev",
    "vayikra": "Lev",
    "numbers": "Num",
    "bamidbar": "Num",
    "deuteronomy": "Deut",
    "devarim": "Deut",
    "joshua": "Josh",
    "judges": "Judg",
    "i samuel": "1Sam",
    "1 samuel": "1Sam",
    "ii samuel": "2Sam",
    "2 samuel": "2Sam",
    "i kings": "1Kgs",
    "1 kings": "1Kgs",
    "ii kings": "2Kgs",
    "2 kings": "2Kgs",
    "isaiah": "Isa",
    "jeremiah": "Jer",
    "ezekiel": "Ezek",
    "hosea": "Hos",
    "joel": "Joel",
    "amos": "Amos",
    "obadiah": "Obad",
    "jonah": "Jonah",
    "micah": "Mic",
    "nahum": "Nah",
    "habakkuk": "Hab",
    "zephaniah": "Zeph",
    "haggai": "Hag",
    "zechariah": "Zech",
    "malachi": "Mal",
    "psalms": "Ps",
    "tehillim": "Ps",
    "proverbs": "Prov",
    "mishlei": "Prov",
    "job": "Job",
    "iyov": "Job",
    "song of songs": "Song",
    "shir hashirim": "Song",
    "ruth": "Ruth",
    "lamentations": "Lam",
    "eikhah": "Lam",
    "eicha": "Lam",
    "ecclesiastes": "Eccl",
    "kohelet": "Eccl",
    "qohelet": "Eccl",
    "esther": "Esth",
    "daniel": "Dan",
    "ezra": "Ezra",
    "nehemiah": "Neh",
    "i chronicles": "1Chr",
    "1 chronicles": "1Chr",
    "ii chronicles": "2Chr",
    "2 chronicles": "2Chr",
    "divrei hayamim i": "1Chr",
    "divrei hayamim ii": "2Chr",
}
BOOK_TITLES_BY_LENGTH = sorted(BOOK_TITLE_TO_ABBR, key=len, reverse=True)
TAG_RE = re.compile(r"<[^>]+>")
SLUG_RE = re.compile(r"[^a-z0-9]+")


def fetch_json(url):
    quoted_url = urllib.parse.quote(url, safe=":/?&=%")
    with urllib.request.urlopen(quoted_url, timeout=60) as response:
        return json.load(response)


def slugify(value):
    slug = SLUG_RE.sub("_", str(value or "").lower()).strip("_")
    return slug or "commentator"


def is_nonempty_text(value):
    if not isinstance(value, str):
        return False
    return bool(TAG_RE.sub("", value).strip())


def choose_commentary_entries(books_payload):
    books = books_payload.get("books", books_payload if isinstance(books_payload, list) else [])
    by_title = defaultdict(list)
    for item in books:
        categories = item.get("categories") or []
        if (
            item.get("versionTitle") == "merged"
            and categories[:1] == ["Tanakh"]
            and len(categories) > 1
            and categories[1] in ALLOWED_COMMENTARY_CATEGORIES
            and item.get("cltk_flat_url")
        ):
            by_title[item["title"]].append(item)

    selected = []
    for rows in by_title.values():
        rows.sort(
            key=lambda item: (
                0 if item.get("language") == "Hebrew" else 1 if item.get("language") == "English" else 2,
                item.get("language", ""),
            )
        )
        selected.append(rows[0])
    return selected


def commentator_label(item):
    categories = item.get("categories") or []
    if len(categories) > 2 and categories[2] not in BOOK_CATEGORY_NAMES:
        return categories[2]
    title = item.get("title") or ""
    for separator in (" on ", ";"):
        if separator in title:
            return title.split(separator, 1)[0]
    return title


def infer_book_from_title(title):
    lower_title = str(title or "").lower()
    for book_title in BOOK_TITLES_BY_LENGTH:
        if re.search(r"\bon\s+" + re.escape(book_title) + r"\b", lower_title):
            return BOOK_TITLE_TO_ABBR[book_title]
    return None


def parse_flat_key(key, default_abbr):
    abbr = default_abbr
    chapter = None
    verse = None
    for part in str(key or "").split(","):
        part = part.strip()
        if "_" not in part:
            continue
        index_text, label = part.split("_", 1)
        try:
            index = int(index_text)
        except ValueError:
            continue
        label = label.replace("_", " ").strip()
        lower_label = label.lower()
        if lower_label in BOOK_TITLE_TO_ABBR:
            abbr = BOOK_TITLE_TO_ABBR[lower_label]
        if label in CHAPTER_LABELS:
            chapter = index + 1
        elif label in VERSE_LABELS:
            verse = index + 1
    if abbr and chapter and verse:
        return f"{abbr}.{chapter}.{verse}"
    return None


def parse_commentary_entry(item):
    label = commentator_label(item)
    default_abbr = infer_book_from_title(item.get("title"))
    result = {
        "title": item.get("title"),
        "language": item.get("language"),
        "commentator": label,
        "category": (item.get("categories") or [None, None])[1],
        "source_url": item.get("cltk_flat_url"),
        "counts": {},
        "segment_count": 0,
        "mapped_count": 0,
        "skipped_count": 0,
    }
    payload = fetch_json(item["cltk_flat_url"])
    text = payload.get("text") if isinstance(payload, dict) else None
    if not isinstance(text, dict):
        return result
    counts = Counter()
    for key, value in text.items():
        if not is_nonempty_text(value):
            continue
        result["segment_count"] += 1
        ref = parse_flat_key(key, default_abbr)
        if ref:
            counts[ref] += 1
            result["mapped_count"] += 1
        else:
            result["skipped_count"] += 1
    result["counts"] = dict(counts)
    return result


def make_unique_commentator_keys(labels):
    used = Counter()
    output = {}
    for label in sorted(labels):
        base = slugify(label)
        used[base] += 1
        output[label] = base if used[base] == 1 else f"{base}_{used[base]}"
    return output


def build_interest(books_url, max_workers):
    books_payload = fetch_json(books_url)
    entries = choose_commentary_entries(books_payload)
    parsed = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(parse_commentary_entry, item) for item in entries]
        for future in concurrent.futures.as_completed(futures):
            parsed.append(future.result())

    labels = {item["commentator"] for item in parsed if item.get("mapped_count")}
    key_by_label = make_unique_commentator_keys(labels)
    commentator_counts = Counter()
    commentator_titles = Counter()
    verse_totals = Counter()
    verse_by_commentator = defaultdict(Counter)
    category_counts = Counter()

    for item in parsed:
        label = item.get("commentator")
        key = key_by_label.get(label)
        if not key:
            continue
        title_has_mapped = False
        for canonical_id, count in item.get("counts", {}).items():
            if not count:
                continue
            title_has_mapped = True
            commentator_counts[key] += count
            verse_totals[canonical_id] += count
            verse_by_commentator[canonical_id][key] += count
            category_counts[item.get("category") or "unknown"] += count
        if title_has_mapped:
            commentator_titles[key] += 1

    labels_by_key = {key: label for label, key in key_by_label.items()}
    commentators = [
        {
            "key": key,
            "name": labels_by_key[key],
            "label": labels_by_key[key],
            "reference_count": commentator_counts[key],
            "source_title_count": commentator_titles[key],
        }
        for key in sorted(commentator_counts, key=lambda item: labels_by_key[item].lower())
    ]

    verses = {}
    for canonical_id in sorted(verse_totals):
        by_commentator = {
            key: count
            for key, count in sorted(verse_by_commentator[canonical_id].items())
            if count
        }
        verses[canonical_id] = {
            "total": verse_totals[canonical_id],
            "by_commentator": by_commentator,
        }

    return {
        "metadata": {
            "source_id": "sefaria_tanakh_commentaries",
            "source_name": "Sefaria Export Tanakh Commentaries",
            "source_url": SOURCE_URL,
            "books_json_url": books_url,
            "gcs_base_url": GCS_BASE_URL,
            "license_notes_url": "https://developers.sefaria.org/docs/usage-of-our-name-and-logo",
            "commentators": commentators,
            "category_counts": dict(sorted(category_counts.items())),
            "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "selection_note": "One merged text per commentary title, preferring Hebrew over English, from Sefaria Tanakh commentary categories.",
        },
        "summary": {
            "source_title_count": len(entries),
            "source_segment_count": sum(item.get("segment_count", 0) for item in parsed),
            "mapped_segment_count": sum(item.get("mapped_count", 0) for item in parsed),
            "skipped_segment_count": sum(item.get("skipped_count", 0) for item in parsed),
            "mapped_title_count": sum(1 for item in parsed if item.get("mapped_count")),
            "unmapped_title_count": sum(1 for item in parsed if not item.get("mapped_count")),
            "verses_with_interest": len(verses),
            "total_interest": sum(verse_totals.values()),
        },
        "verses": verses,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "-o",
        "--out",
        type=Path,
        default=Path("commentary/sefaria_tanakh_commentary_interest.json"),
        help="Output compact commentary-interest JSON",
    )
    parser.add_argument("--books-url", default=BOOKS_JSON_URL, help="Sefaria Export books.json URL")
    parser.add_argument("--max-workers", type=int, default=16, help="Concurrent download workers")
    args = parser.parse_args()

    payload = build_interest(args.books_url, args.max_workers)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    summary = payload["summary"]
    print(
        "Done: "
        f"{summary['total_interest']} mapped commentary segments, "
        f"{len(payload['metadata']['commentators'])} commentators, "
        f"{summary['verses_with_interest']} verses"
    )


if __name__ == "__main__":
    main()
