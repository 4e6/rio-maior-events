# Python to TypeScript port: tasks and switch-over

The Python pipeline in `scripts/` (tests in `tests/python/`) is being ported to Bun and TypeScript under `src/`.
Port bar: the same behaviour on real inputs, not bug-for-bug Python. WHATWG `URL` plus the `clean_url` rules the
tests pin (no full urllib port); `TextDecoder` plus a small shim for Python codec names; deterministic event ids
need not equal Python's; `$` before a trailing newline is fixed (not carried over); output is `JSON.stringify`.
One runtime dependency is allowed: `saxes` (XML). No `src/py/json.ts`: `JSON.parse` / `JSON.stringify(x, null, 1)`
cover loads/dumps, and the two JSON helpers only nextjs needs (a value-end scanner replacing `raw_decode`, a string
decoder tolerating raw control characters) live in `src/adapters/nextjs.ts`.

Every stub states its Python counterpart (`file:function`) in a comment. Shared shapes: `src/adapters/types.ts`,
`src/net-errors.ts`. Tests use `test/helpers.ts` (`fixture(name)` reads `tests/python/fixtures`; fixtures are not copied).

## Rule for every task

Port the Python tests for your files to `bun:test` first, keeping the test names, then make them pass. Replace a
stub body only for the functions you own; keep exported signatures (change one only with the owner of its callers).
`bun test` and `bunx tsc --noEmit` must pass on each commit.

## Tasks

| Task | What | Files owned | Depends on |
|---|---|---|---|
| T1 | str, Unicode, entities, `html.unescape` | `src/py/str.ts`, `src/py/html_unescape.ts`, `src/py/entities.generated.ts` (+ `tools/gen_entities.py`) | T0 |
| T2 | `HTMLParser` (3.14 event stream) | `src/py/htmlparser.ts` | T0, `unescape` from T1 |
| T3 | URLs | `src/url.ts` | T0 |
| T4 | codecs, datetime | `src/py/codecs.ts`, `src/py/datetime.ts` | T0 |
| T5 | XML on saxes | `src/py/xml.ts` | T0, T4 (codecs) |
| T6 | common | `src/adapters/common.ts` | T1, T2, T3, T4, T5 |
| T7 | feed and API adapters | `santarem_rss`, `municipal_rss`, `riomaior_calendar`, `events_calendar`, `cadaval_api` in `src/adapters/` | T3, T4, T5, `plain`/`makeItem` from T6 |
| T8 | `text` and `nextjs` adapters | `src/adapters/text.ts`, `nextjs.ts` | T6 |
| T9 | network | `src/net.ts`, `src/net-errors.ts` (`classify*`) | T0, T3, T4 |
| T10 | collector | `src/collect.ts`, `src/cli/collect.ts`, `src/adapters/index.ts` | T0, T9 (adapters faked) |
| T11 | merge, render, check_candidates | `src/merge.ts`, `src/render.ts`, `src/check_candidates.ts`, their `src/cli/*` | T1, T4 |
| T12 | parity harness: Python vs TS on recorded inputs, fix differences | `tools/parity.*`, `tools/diff.ts` | T6 to T11 |

Order: T1, T3, T4, T5, T9 in parallel; T2 after T1's `unescape`; then T6, T7, T10, T11; then T8; then T12.

## Switch-over

`src/build.ts` keeps calling the Python scripts (`collect.py`, `merge.py`, `render.py`, `check_candidates.py`)
until the TypeScript replacement of a step has landed with its tests. T10 switches the collect step (the
`COLLECT_SCRIPT` call becomes `src/cli/collect.ts`); T11 switches merge, finalize, render and the candidates check,
one step per change. T12 runs both implementations on the same recorded inputs before each switch is final. The
Python scripts and tests are deleted only after the last step has switched and parity is clean.
