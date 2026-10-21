---
type: Decision
title: Haiku readers on 30,000-character pieces, a Sonnet editor
description: "The daily run reads with Haiku on pieces of at most 30,000 characters and edits with Sonnet, by the user's decision of 2026-10-21 and against the evaluation's advice: about $1.15 a run against about $3, with more fact slips."
tags: [model, cost]
sources:
  - resource: .github/workflows/daily.yml
  - resource: src/build.ts
  - resource: src/split.ts
---

# Decision

`daily.yml` sets `READ_MODEL=haiku`, `EDIT_MODEL=sonnet` and
`READ_SPLIT_CHARS=30000`. Without them the code reads whole groups with Sonnet
and the editor uses the readers' model. Removing the three variables goes back
to that.

# What the evaluation found

On one collected run, read three times each way:

| Reading | Cost a run | Events missed | Fact slips on the page |
|---|---|---|---|
| Haiku, 30,000-character pieces | about $1.15 | 0 to 1 | 4 to 7 |
| Sonnet, whole groups | about $3 | 2 to 3 | none |

The slips were a performer as the venue, an exhibitors' fee as the price, a
civic meeting kept. Dates, times, towns and duplicates were clean either way.
The evaluation advised against Haiku; the user chose it for the cost.

# Alternatives considered

- **Haiku on whole groups.** Missed 3 to 7 events a run.
- **Opus readers.** About $11 a run.
- **Sonnet readers on whole groups** (the code's default). Kept as the way back,
  not the daily setting: about $3 a run.
- **A Haiku editor.** On Haiku it merged a one-day race into a range, so the
  editor stays on Sonnet.

# See also

[Fan-out reading](../architecture/rio-maior-events.md#how-the-collection-is-built)
in the architecture page.
