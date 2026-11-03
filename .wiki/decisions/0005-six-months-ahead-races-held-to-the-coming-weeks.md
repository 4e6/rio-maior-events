---
type: Decision
title: Six months ahead, races held to the coming weeks
description: "The window is six months, the dated weeks end at window.near_end, Portugal Running's races stop there by a collector filter and a merge backstop, and the yearly hints stay on the coming weeks; the owner's decision of 2026-11-03."
tags: [window, races, cost]
sources:
  - resource: src/merge.ts
  - resource: src/collect.ts
  - resource: src/adapters/text.ts
  - resource: sources.json
---

# Decision

The agenda reaches six months ahead (`window.end`, the same day six months on,
clamped to a shorter month). The part listed in full, the coming weeks, ends at
`window.near_end`, the old default end. What starts later is Further ahead on the page.
Portugal Running's three rows have `horizon: "near"`: their races stop at `near_end`.
The yearly-hint table stays on the coming weeks.

# Why

- Sources already list some events months out; showing them costs one section and
  no new source. A hand-kept far list was rejected: it goes stale unseen.
- One global window means every validator (`check_candidates`, `render.checkEvent`,
  finalize) keeps judging one window. A second window threaded through every stage
  was rejected.
- Races: seasons of races fill every month, against [capture, do not link](../architecture/rio-maior-events.md),
  so they would swamp the section. A reader rule for "no far races" varies between
  runs, so it is not the rule: the collector's card filter saves cost, and merge's
  backstop (by unit, not by names) enforces it, since the undated guide table of
  usual months survives the filter. The backstop fails closed: a race it cannot place
  before `near_end` (a bad date, or a month like "Dezembro" that runs past it) or from a
  unit it cannot attribute is left out and reported, because nothing after merge holds
  races to `near_end`. The filter fails the other way: it drops only a card in the
  shape it knows, so a layout change costs reading, never text.
- Hints over six months would make the hand-kept yearly table the far list.
- A month grid over six months would read as "nothing on in March".

# Consequences

- Cost is expected to rise by about 5 to 10 percent of the $1.15 run (reader output and editor
  input for 25 to 45 far events at most, an upper bound: the year-less-date rule drops real
  ones); measure from `status.json` `usage_usd` over the first runs.
- Recurring events list dates to `near_end` only. Ourém is one request at `per_page=50`: a
  busier calendar would lose its latest events silently. Santarém Acontece is still cut at
  about 4 December by its own cap.
- Rejected: the far end as the end of the sixth month; chosen is the same day, which
  is the literal six months and leaves the last month partial (the page says "to 3 May").
