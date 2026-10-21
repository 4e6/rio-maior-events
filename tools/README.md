# tools

- `probe_summary.ts`, `probe_bun.ts`: used by `.github/workflows/probe.yml` (run by hand): the collector's per-source
  result and one plain GET per list page with Bun's client.
- `gen_*.py`: generators for the test vectors and tables that came from Python's own behaviour (`html.entities`,
  Unicode data, `html.parser`, `urllib`, codecs). They need Python 3.14 and are not run in CI; the files they wrote are
  committed (`src/py/*.generated.ts`, `test/fixtures/*vectors.json`, `test/vectors/`).
  - `gen_entities.py`, `gen_unicode.py`, `gen_vectors.py`, `gen_htmlparser_vectors.py` use only the standard library.
  - `gen_py_vectors.py` and `gen_url_vectors.py` import the Python collector (`scripts/`), which was deleted when the
    port landed. To regenerate their output, run them from a checkout of the commit before that deletion.

Comments in `src/` and `test/` that cite `scripts/*.py` or `tests/python/` name the Python code the TypeScript was
ported from; it is in the git history before the commit "Delete the Python pipeline".
