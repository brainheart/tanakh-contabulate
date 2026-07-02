# Commentary Interest Data

This directory stores compact commentary-interest counts and per-book comment references for the Tanakh site.

Current source:

- [Sefaria-Export](https://github.com/Sefaria/Sefaria-Export)
- Categories: `Rishonim on Tanakh`, `Acharonim on Tanakh`, and `Modern Commentary on Tanakh`
- Source format: Sefaria `cltk-flat` merged exports

The generated count JSON records non-empty commentary segments that can be mapped to a canonical `Book.Chapter.Verse` reference. Per-book files under `details/` retain source/comment refs for click-through lists. They do not embed full commentary text; the app fetches visible comment text from Sefaria and links each record to Sefaria/source JSON. When `build.py` publishes these files to `docs/commentary/`, it drops refs to verses outside the morphhb corpus so detail lists always agree with the site's count columns.

Regenerate with:

```bash
python3 scripts/build_sefaria_commentary_interest.py
```
