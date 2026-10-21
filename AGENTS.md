# AGENTS.md

## What this is

A Bun/TypeScript pipeline that builds a daily events page for Rio Maior, Portugal.
[README.md](README.md) describes it.

## Working here

- `bun install`, then `bun test` (offline; the pipeline's tests run against a fake
  `claude`) and `bunx tsc --noEmit`. Both must pass before a change lands.
- Never run the collector in a loop, and never route around a site's refusal (a
  403, a robots.txt, a throttle). A site that refuses is recorded as failed; see
  [the decision](.wiki/decisions/0001-sources-must-answer-a-github-runner.md).
- The corpus of saved pages (collected sources, `work/`, any run output) is
  private. It is never committed; keep it under the ignored folders.

## Project knowledge

Durable knowledge about this project (architecture boundaries, the rationale
behind its rules, decisions) lives in an OKF knowledge bundle at [.wiki/](.wiki/).
**Start at [.wiki/index.md](.wiki/index.md)** and drill down; don't read the whole
bundle.

Wiki updates land in the same commit as the change, never as a follow-up, and
that includes re-pinning a page whose text still holds: run `okf.py pin <page>`
after the change's last edit to the page's sources, and check with `okf.py
stale`. `okf.py` is not in this repository: it ships with the `llm-wiki` skill
(`~/.claude/skills/llm-wiki/scripts/okf.py`, with a `requirements.txt` beside it),
and the bundle is `.wiki`, so pass `--bundle .wiki`. See
[the convention](.wiki/conventions/a-change-and-its-wiki-are-one-commit.md).
