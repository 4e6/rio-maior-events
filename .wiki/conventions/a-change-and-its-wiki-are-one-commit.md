---
type: Convention
title: A change and its wiki are one commit
description: A change lands with every wiki page it touches in the same commit, each page pinned to the content of its sources after the last edit, so nothing is pinned after a merge.
tags: [process, wiki]
sources:
  - resource: AGENTS.md
sources_digest: ec339a103b37c00b
---

# The rule

A change lands as one commit with every wiki page it touches. That covers a page
whose text still holds: re-pin it too, so `stale` is clean on the branch and
stays clean after the merge.

- Edit the code, then the pages.
- Run `okf.py pin <page>` for each page as the **last** step, after the final
  edit to that page's `sources`. A source edited after the pin makes the page
  stale again. Pin only a page whose sources you have read.
- Run `okf.py index --write`, `okf.py lint` and `okf.py stale` and fix what they
  report.
- Append to [the log](../log.md) when a page's meaning changed. A cosmetic
  source change needs a re-pin and no log entry.

# Why

The pin is a digest of the sources' content, not a commit hash, so a squash
merge, a rebase or a shallow clone cannot invalidate it. A follow-up commit to
"fix the pins" would leave the default branch stale between the merge and the
fix, and the review of a change would not have seen the wiki that describes it.

# Where `okf.py` is

It is not in this repository. It ships with the `llm-wiki` skill
(`~/.claude/skills/llm-wiki/scripts/okf.py`, with a `requirements.txt` beside
it); build a venv from that file and pass `--bundle .wiki`, because the default
bundle name is `wiki`.
