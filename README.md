# Hebrew Bible Contabulate

Static single-page contabulate search for the Hebrew Bible (Tanakh), built from Westminster Leningrad Codex OSIS XML with right-to-left Hebrew display.

The generated site lives in [docs](/Users/klaus/Projects/tanakh-contabulate/docs) and is designed for GitHub Pages deployment at `hebrew.contabulate.org`.

## Source Text

- Open Scriptures `morphhb`: https://github.com/openscriptures/morphhb
- Westminster Leningrad Codex text contained in the `source_text/*.xml` OSIS files
- Morphological markup is stripped down to plain Hebrew verse text for display; search indexes normalize Hebrew by removing nikud and cantillation marks
- Commentary-interest counts are generated from Sefaria-Export Tanakh commentary data: https://github.com/Sefaria/Sefaria-Export
- The vocabulary views' proper-name exclusion lists ("Hide proper names", off by default) are extracted from morphhb morphology (proper-noun `Np` segments, including attested prefixed forms); when scoped to one book the list is editable in the UI, with edits kept per book in the browser's localStorage.

## Build

Run:

```bash
python3 build.py
```

This parses all 39 Tanakh books in traditional order and writes:

- `docs/data/plays.json`
- `docs/data/chunks.json`
- `docs/data/characters.json`
- `docs/data/tokens.json`
- `docs/data/tokens2.json`
- `docs/data/tokens3.json`
- `docs/data/tokens_char*.json`
- `docs/data/character_name_filter_config.json`
- `docs/data/commentary_interest.json`
- `docs/commentary/*.json`
- `docs/lines/all_lines.json`

## Local Preview

Run:

```bash
python3 -m http.server 4173 -d docs
```

Then open `http://127.0.0.1:4173/`.

## Tests

Python build-output checks:

```bash
pytest tests/test_build_output.py
```

Playwright smoke test:

```bash
npx playwright test
```

## Notes

- Search indexes are accent-insensitive for Hebrew matching.
- Display text preserves pointed Hebrew and sof pasuq punctuation.
- Commentary counts store per-verse counts, commentator metadata, and compact per-book comment references. The app fetches visible comment text from Sefaria when a commentary count is opened.
- The overall UI remains LTR, while Hebrew content cells and verse text render RTL.
- Counts are drill-down links: a count of chapters/verses/books opens that granularity filtered to the row's scope (via a location-prefix column filter), term-hit counts open the matching verses, word/bigram/trigram counts open the scoped vocabulary view, and comment counts open the commentary list.
- Ancestor name cells filter the current view to that ancestor: Section in the books view, Book in the chapters/verses views, Chapter in the verses view. Identity cells stay plain.
- Word/Bigram/Trigram granularities put distinct n-grams in the rows (count within the current location scope, corpus-wide book count, verse count, and "unusualness" — the midrank percentile of TF-IDF ((1 + ln scope count) × ln(39 / books containing), sublinear so frequency cannot swamp rarity) within the view's vocabulary). Their count cells door back into the location dimension by adding the n-gram as a term column; the proper-name exclusion applies across the books in scope.
