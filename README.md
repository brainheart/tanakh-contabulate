# Hebrew Bible Contabulate

Static single-page contabulate search for the Hebrew Bible (Tanakh), built from Westminster Leningrad Codex OSIS XML with right-to-left Hebrew display.

The generated site lives in [docs](/Users/klaus/Projects/tanach-contabulate/docs) and is designed for GitHub Pages deployment at `hebrew.contabulate.org`.

## Source Text

- Open Scriptures `morphhb`: https://github.com/openscriptures/morphhb
- Westminster Leningrad Codex text contained in the `source_text/*.xml` OSIS files
- Morphological markup is stripped down to plain Hebrew verse text for display; search indexes normalize Hebrew by removing nikud and cantillation marks

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
- The overall UI remains LTR, while Hebrew content cells and verse text render RTL.
