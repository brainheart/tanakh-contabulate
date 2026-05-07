# Commentary Interest Data

This directory stores compact commentary-interest counts for the Tanakh site.

Current source:

- [Sefaria-Export](https://github.com/Sefaria/Sefaria-Export)
- Categories: `Rishonim on Tanakh`, `Acharonim on Tanakh`, and `Modern Commentary on Tanakh`
- Source format: Sefaria `cltk-flat` merged exports

The generated JSON counts non-empty commentary segments that can be mapped to a canonical `Book.Chapter.Verse` reference. It does not include commentary text.

Regenerate with:

```bash
python3 scripts/build_sefaria_commentary_interest.py
```
