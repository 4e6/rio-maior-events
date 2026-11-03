---
type: Decision
title: Every placeable event on the calendar, one list for the rest
description: "Grids run through the last month with a marked day, far days get day blocks, and only events with no day to mark are listed apart; the owner's decision of 2026-11-03."
tags: [page, calendar]
sources:
  - resource: assets/page.js
  - resource: assets/page.css
  - resource: src/render.ts
---

# Decision

Decided by the owner on 2026-11-03, after the six-month window ([decision
0005](0005-six-months-ahead-races-held-to-the-coming-weeks.md)) showed that a calendar
stopping at `window.near_end` hid months of events behind a list:

1. The month grids run through the last month that has an event, and at least through
   `near_end`'s month.
2. Clicking a day jumps the list for every day, near or far: far days get day blocks of
   their own.
3. Further ahead as a separate list of dated events goes away. Only events that cannot
   sit on a day stay in a list, "Date to be confirmed".

The rules are in [the page section of the architecture](../architecture/rio-maior-events.md).
In short: `single` and `multi_day` events mark every day; a recurring event whose next
date is after `near_end` marks its listed dates, with one card and an "again" row on the
others; an ongoing event that opens after `near_end` sits on its opening day; `date_tbc`
events, month-only or with a full date, mark nothing.

# Why

- A calendar that covers only part of the window sends the reader to a second place for
  the same kind of event. One way to find an event is easier to scan, and the jump,
  the scroll mark, `aria-current`, print and the no-script story all already work on
  day blocks.
- The grid range is worked out in `page.js`, once, with no filters: the placement rules
  live there, an old `events.json` needs the fallback anyway, and a grid that grew and
  shrank as you typed is worse than a quiet month. Month-only `date_tbc` events add no
  grid: an empty April is exactly what the owner ruled out.
- Ongoing events that open after `near_end` are placed by their opening day, as they
  were in Further ahead, and are not in the Ongoing block ("on now" would be false).

# Alternatives considered

- A popover or panel for far days: a new widget in a sticky, scrolling rail, with
  focus trap, Escape and placement, on desktop only, since a phone has no grid.
- Keeping Further ahead as a dated list with marked days: the owner's third point.
- Grids for all six months regardless: empty months read as "nothing on", so the
  range follows the marks.
- A day strip over six months: about 180 buttons, so the phone gets one chip per far
  month instead.

# Consequences, accepted

- **The calendar shows absence where merge cut dates.** A near regular's dots stop at
  `near_end`: its card is in Regulars, and a far day has no row for it to jump to (merge
  cuts such dates when `recurrence` has text; `page.js` stops the dots when it has
  none, as the grids ending at `near_end` used to). A far recurring event shows its
  first four dates (merge's cap when `recurrence` has text), so a Saturday market can
  look absent in January. The
  "again" row says the recurrence text and, with none, "date 2 of 4", never "of 4"
  meaning the series ends there. The grid note under the last grid says where the marks
  stop and that long runs and regulars are listed apart.
- **The Weekend filter judges each day** of a placed event. This reverses the rule in
  PR 23 that a far recurring event is judged by its next date: a Tuesday-and-Saturday
  regular does occur on that Saturday, and its card there is right. A far ongoing event
  is exempt: it keeps its day block and dot when its opening day is a weekday, as near
  ongoing events stay under Weekend.
- **Visible changes on the live page.** Near `date_tbc` cards moved, from after Later
  to the one Date to be confirmed list after the last far month (the list is after
  `#list`). "Big event" is on every card from 50 minutes away, near cards too, so some
  modest-looking near shows carry it (13 qualified on 2026-11-03).
- **The rail is longer** (five grids on live data, up to seven), so each grid is one
  tab stop with arrow keys and a skip link, and the active day is scrolled into view in
  the rail (not while the keyboard is in it). Greyed past days are not stops. A jump
  holds its day until the user takes over the scroll or the jump's scroll ends, and the
  foot of the page marks the last day in view.
- **The page grows** by about 18 KB of script (`page.js` 36 KB to 54 KB, inlined in
  every page); the far cards existed before, in a list, and the longer list is drawn in
  the browser.
- **A far month's chip counts the events on its days**, "again" and "continues" rows
  included, as a day button's label does: a market whose January holds only "again"
  rows still reads "Jan 1", and no chip reads 0 for a band it opens.
- **An undated event leaves the list once its month**, or the day the source gave, is
  behind the reader: the page is built weekly and read all week.
- `#ahead` with no far band drawn (nothing listed after `near_end`, or an old file) goes
  to Date to be confirmed, else to the end of the dated list. A phone has a month chip
  for every far band drawn, so with no chip there is no far day to reach.
- Not done: clicking a near day that only a regular marks jumps to the next day block,
  not to the Regulars card, as it always has; far days no longer carry such dots.
