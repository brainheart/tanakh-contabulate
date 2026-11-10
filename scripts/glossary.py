"""English reading aids for the Hebrew text: a lemma, gloss, and root for every word.

The source text is the Open Scriptures Hebrew Bible, whose every word carries
a lemma (an augmented Strong number). The Open Scriptures Hebrew Lexicon turns
that number into a pointed dictionary form, a short English definition, the
King James renderings recorded by Strong, and the root the word is filed under
in Brown-Driver-Briggs. Prefixes written together with a word (and, the, in,
to ...) are part of its written form here, as in the search index, and are not
separate entries.
"""
import hashlib
import re
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

LEXICON_COMMIT = "21c9add13bc727d3a951361778e97e3ff7afd1ce"
LEXICON_BASE = f"https://raw.githubusercontent.com/openscriptures/HebrewLexicon/{LEXICON_COMMIT}/"
LEXICON_FILES = {
    "HebrewStrong.xml": "a628f4f89f8bdaf2483fd3faf1abc8653cc6717758dfc9f24beb7571d9bdd0c4",
    "LexicalIndex.xml": "8f7a605c58899d2f44430149c143c00903976e1e91232476677972a69e5bc85f",
    "AugIndex.xml": "e7217ca8ff8ff3f21f9cf1bbe87411adf55f6aa88bcf5ed9ddc886cc6b160c5d",
}
LEX_NS = {"l": "http://openscriptures.github.com/morphhb/namespace"}
OSIS_NS = {"osis": "http://www.bibletechnologies.net/2003/OSIS/namespace"}
POS_LABELS = {
    "N": "noun", "V": "verb", "A": "adjective", "Np": "name", "Ng": "gentilic", "D": "adverb",
    "R": "preposition", "C": "conjunction", "P": "pronoun", "T": "particle", "Tn": "negative",
    "Ti": "interrogative", "I": "interjection",
}
# Words too common in glosses to say what a lemma means. They are indexed
# only for lemmas whose glosses contain nothing else.
STOP_WORDS = frozenset("""
a an the and or of to in on for with by from at as is are was were be been it its he she they them
their his her you your we our us i my me him who whom which that this those these then so but not
no will would shall should may might can could do does did have has had o if when what there than
am self selves thing things e ie etc figuratively literally abstractly specifically generally
implication especially causatively properly concretely used compare
""".split())


def verify_lexicon(directory):
    for name, expected in LEXICON_FILES.items():
        if hashlib.sha256((Path(directory) / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f"Source checksum mismatch: {name}")


def _text(element):
    return re.sub(r"\s+", " ", "".join(element.itertext())).strip() if element is not None else ""


def load_lexicon(directory):
    """Augmented Strong number -> {lemma, pos, gloss, usage, root}."""
    directory = Path(directory)
    verify_lexicon(directory)
    index = {}
    for part in ET.parse(directory / "LexicalIndex.xml").getroot().findall("l:part", LEX_NS):
        language = part.get("{http://www.w3.org/XML/1998/namespace}lang", "heb")
        for entry in part.findall("l:entry", LEX_NS):
            etym = entry.find("l:etym", LEX_NS)
            xref = entry.find("l:xref", LEX_NS)
            index[entry.get("id")] = {
                "lemma": _text(entry.find("l:w", LEX_NS)),
                "pos": _text(entry.find("l:pos", LEX_NS)),
                "gloss": _text(entry.find("l:def", LEX_NS)),
                "strong": xref.get("strong") if xref is not None else None,
                "root_letters": etym.get("root") if etym is not None else None,
                "etym_type": etym.get("type") if etym is not None else None,
                "parents": [p.strip() for p in _text(etym).split(",") if p.strip()] if etym is not None else [],
                "aramaic": language == "arc",
            }

    def root_of(entry_id, seen=()):
        entry = index.get(entry_id)
        if not entry or entry_id in seen:
            return ""
        if entry["root_letters"]:
            return entry["root_letters"]
        if entry["etym_type"] == "sub" and entry["parents"]:
            return root_of(entry["parents"][0], seen + (entry_id,))
        return ""

    strong = {}
    for entry in ET.parse(directory / "HebrewStrong.xml").getroot().findall("l:entry", LEX_NS):
        meaning = entry.find("l:meaning", LEX_NS)
        strong[entry.get("id")[1:]] = {
            "lemma": _text(entry.find("l:w", LEX_NS)),
            "defs": [_text(d) for d in meaning.findall("l:def", LEX_NS)] if meaning is not None else [],
            "meaning": _text(meaning),
            "usage": _text(entry.find("l:usage", LEX_NS)).rstrip("."),
        }
    lexicon = {}
    for word in ET.parse(directory / "AugIndex.xml").getroot().findall("l:w", LEX_NS):
        augmented = word.get("aug")
        entry = index.get(_text(word))
        # Single letters are the prefixes (in, and, the, to ...), which stand
        # as a word's lemma when only a pronoun is attached to them.
        digits = re.match(r"\d+", augmented or "")
        base = strong.get(digits.group(0), {}) if digits else {}
        if entry:
            lexicon[augmented] = {
                "lemma": entry["lemma"] or base.get("lemma", ""),
                "pos": entry["pos"],
                "gloss": display_gloss(entry["gloss"], base.get("defs", [])) or base.get("usage", ""),
                "short": entry["gloss"],
                "meaning": base.get("meaning", ""),
                "usage": base.get("usage", ""),
                "root": root_of(_text(word)),
                "aramaic": entry["aramaic"],
            }
    for number, base in strong.items():
        lexicon.setdefault(number, {
            "lemma": base["lemma"], "pos": "", "gloss": display_gloss("", base["defs"]) or base["usage"],
            "short": "", "meaning": base["meaning"], "usage": base["usage"], "root": "", "aramaic": False,
        })
    return lexicon


def display_gloss(short, strong_defs, limit=4):
    """The lexical index's short definition, then Strong's own key words
    where they add something."""
    parts = []
    for text in [short] + list(strong_defs):
        text = text.strip()
        if text and text.lower() not in {p.lower() for p in parts}:
            parts.append(text)
    if not parts:
        return ""
    return parts[0] + ("; " + ", ".join(parts[1:limit]) if len(parts) > 1 else "")


def lemma_key(attribute):
    """`c/d/776` -> `776`; `1254 a` -> `1254a`. Prefix letters are not lemmas."""
    last = attribute.split("/")[-1].strip()
    match = re.fullmatch(r"(\d+)(?: ([a-z]))?(?:\+)?", last)
    if match:
        return match.group(1) + (match.group(2) or "")
    return last if re.fullmatch(r"[a-z]", last) else None


def annotate(book_files, tokenize, word_text):
    """Words by verse with their lemma keys: {osisID: [(token, key or None)]}."""
    notes = {}
    for xml_path in book_files:
        root = ET.parse(xml_path).getroot()
        for verse in root.findall(".//osis:chapter/osis:verse", OSIS_NS):
            out = []
            for child in verse:
                if child.tag.rsplit("}", 1)[-1] != "w":
                    continue
                key = lemma_key(child.attrib.get("lemma", ""))
                for token in tokenize(word_text(child)):
                    out.append((token, key))
            notes[verse.attrib["osisID"]] = out
    return notes


def gloss_words(gloss):
    plain = re.sub(r"\([^)]*\)", " ", gloss)
    words = [w for w in re.findall(r"[a-z]+(?:'[a-z]+)?", plain.lower()) if w not in STOP_WORDS]
    return words or re.findall(r"[a-z]+(?:'[a-z]+)?", gloss.lower())


def word_index(gloss, meaning, usage, count, limit=24):
    """English words weighted by the lemma's frequency: the definition in
    full, the rest of Strong's explanation at three quarters. The King James
    renderings Strong lists are unranked, so a rendering used once looks like
    one used a thousand times; they only break ties, at weight 1."""
    weights = {}
    for word in gloss_words(gloss):
        weights[word] = max(2, count)
    for word in gloss_words(meaning):
        weights.setdefault(word, max(2, count * 3 // 4))
    for word in gloss_words(usage.replace("×", " ").replace("+", " ")):
        weights.setdefault(word, 1)
    return [[w, c] for w, c in sorted(weights.items(), key=lambda wc: (-wc[1], wc[0]))[:limit]]


def king_james(usage, limit=150):
    text = re.sub(r"\s+", " ", usage).strip()
    if len(text) > limit:
        text = text[:limit].rsplit(",", 1)[0] + ", …"
    return "King James: " + text


def build_glossary(source_dir, book_files, tokenize, word_text):
    lexicon = load_lexicon(Path(source_dir) / "lexicon")
    notes = annotate(book_files, tokenize, word_text)
    stats = Counter()
    form_total = Counter()
    form_lemmas = defaultdict(Counter)
    lemma_forms = defaultdict(Counter)
    for words in notes.values():
        for token, key in words:
            form_total[token] += 1
            stats["words"] += 1
            if key and key not in lexicon:
                # An augmented number the index lacks: fall back to the plain number.
                plain = re.match(r"\d+", key).group(0)
                key = plain if plain in lexicon else None
            if not key:
                stats["words_without_lemma"] += 1
                continue
            form_lemmas[token][key] += 1
            lemma_forms[key][token] += 1
    ordered = sorted(lemma_forms, key=lambda k: (-sum(lemma_forms[k].values()), k))
    index = {key: i for i, key in enumerate(ordered)}
    lemmas = []
    for key in ordered:
        entry = lexicon[key]
        count = sum(lemma_forms[key].values())
        if not entry["gloss"]:
            stats["lemmas_without_gloss"] += 1
        lemmas.append({
            "lemma": entry["lemma"],
            "pos": POS_LABELS.get(entry["pos"], "word") + (" (Aramaic)" if entry["aramaic"] else ""),
            "root": entry["root"],
            "n": count,
            "def": entry["gloss"],
            "en": [king_james(entry["usage"])] if entry["usage"] else [],
            "w": word_index(entry["gloss"], entry["meaning"], entry["usage"], count),
            "forms": [[f, c] for f, c in sorted(lemma_forms[key].items(), key=lambda fc: (-fc[1], fc[0]))],
        })
    forms = {}
    for form in sorted(form_total):
        related = [index[k] for k, _ in form_lemmas[form].most_common(3)]
        glosses = []
        for i in related:
            if lemmas[i]["def"] and lemmas[i]["def"] not in glosses:
                glosses.append(lemmas[i]["def"])
        forms[form] = [form_total[form], glosses[:3], related]
    stats["lemmas"] = len(lemmas)
    stats["forms"] = len(forms)
    stats["roots"] = len({e["root"] for e in lemmas if e["root"]})
    return {"forms": forms, "lemmas": lemmas}, stats
