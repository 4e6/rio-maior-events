---
type: Decision
title: Six months ahead, races held to the coming weeks
description: "The window is six months, the dated weeks end at window.near_end, Portugal Running's races stop there by a collector filter, a merge backstop and a finalize one, and the yearly hints stay on the coming weeks; the owner's decision of 2026-11-03."
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
`window.near_end`, the old default end. What starts later is shown by month after them ([decision 0006](0006-every-placeable-event-on-the-calendar.md); at first a separate Further ahead list).
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
  unit it cannot attribute is left out and reported. Merge drops them before the editor
  sees them, and `merge --finalize` drops any the editor adds back: an event after
  `near_end` (placed the same fail-closed way) whose every source is the name or label of a
  horizon-near row of `sources_checked`, which merge writes for it. Finalize matches by
  name because it has only the file; that is weaker than the unit but fails safe (a race
  its town also lists cites the town and stays), and a file without the horizon cuts
  nothing. When the window has a `near_end` but `sources_checked` has no horizon-near row with a
  label (the editor stripped them; a fresh merge always writes them), finalize warns on one line
  and counts `races_guard_off` in its stats, and never fails the build. The filter fails the other way: it drops only a card in the
  shape it knows, so a layout change costs reading, never text.
- Hints over six months would make the hand-kept yearly table the far list.
- A month grid over six months would read as "nothing on in March". (Reversed for the page: [decision 0006](0006-every-placeable-event-on-the-calendar.md) puts every placeable event on the calendar, with a note where the marks stop.)

# Consequences

- Cost is expected to rise by about 5 to 10 percent of the $1.15 run (reader output and editor
  input for 25 to 45 far events at most, an upper bound: the year-less-date rule drops real
  ones); measure from `status.json` `usage_usd` over the first runs.
- Recurring events list dates to `near_end` only, when `recurrence` says how they go on
  (without it every date stays). A far hint the editor re-adds is held by `editing.md`
  alone: finalize's rule is for races. Ourém is one request at `per_page=50`: a
  busier calendar would lose its latest events silently. Santarém Acontece publishes
  only about seven weeks ahead on one page; its cap was raised from 31,700 to 44,000
  characters on 2026-11-03 so that page is read whole (39,458 characters that day, to
  19 December, where the old cap stopped at 11 December; 44,000 is that plus about
  11 %, and keeps its reader piece near the largest one already read).
- Rejected: the far end as the end of the sixth month; chosen is the same day, which
  is the literal six months and leaves the last month partial (the page says "to 3 May").
