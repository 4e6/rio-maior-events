---
type: Module
title: Rio Maior events
description: "A skill that gathers leisure events within about 45 minutes of Rio Maior and renders an agenda list beside a month calendar. Why a script collects and the model reads, which sources, how the page works, where it bends the payload rules."
tags: [architecture, skill, network, page]
sources:
  - resource: skills/rio-maior-events/**
  - resource: evals/rio-maior-events/**
sources_digest: 2db0c6469e760e38
---

# What it is

A person living in Rio Maior asks what is on. The skill collects the public
listings around the town, the model reads them into one events file, and a
script renders that file as one self-contained page: an agenda list, a month
calendar beside it (a day strip on a phone), filters, starred picks and .ics
downloads. It is tied to one place on purpose: the sources are the hard part,
and each has its own traps.

# Who does what

- **`collect.py` fetches.** The municipal calendar is a JSON endpoint that
  takes a POST, which a page-reading tool cannot send, and a script makes a run
  repeatable and testable. It fetches each source once, in turn, and writes for
  each the JSON-LD events it found and the page's visible text, capped at
  30,000 characters. It parses no site's layout: layouts change, and a model
  reads changed text better than a regex does.
- **The model reads.** Portuguese dates with no year, a misleading "Hoje!"
  label, times that are an hour off, the same race on two calendars, far-away
  Eventbrite listings: `references/sources.md` lists them
  ([below](#the-sources)), and judging them is the model's job. It writes
  `rio-maior-events.json` to `references/events-schema.json`.
- **`render.py` checks and draws.** It validates the file in plain Python
  (exit 2 lists each problem with its event), makes each event's id, and inlines
  `assets/page.css`, `assets/page.js` and the events as JSON into one HTML file.

# The sources

Checked by fetching on 2026-10-20; the full list with how to read each is
`references/sources.md`.

- **Backbone**: the Rio Maior municipal calendar (its times are UTC, which
  first looked an hour off against the Cineteatro; `collect.py` converts them
  to Portugal time, the summer-time rule written out so no time-zone database is
  needed), the Cineteatro de Rio Maior agenda, Viral Agenda's page for
  each of nine nearby municipalities, and Portugal Running's district pages
  for Santarém, Leiria and Lisboa.
- **One race calendar.** Race calendars list the same races, so the skill reads
  one. Portugal Running won: it lists road races, trails and walks months
  ahead with each race's town, and lets a script in. GoTrail and Running.life
  answer the script with a 403; Racefinder's only listing by area is a filter
  its robots.txt asks automated visitors not to use.
- **Supplementary**: the agendas of Santarém, Caldas da Rainha, Torres Novas and
  Cartaxo, and Eventbrite filtered to the towns in `towns.md`.
- **Not used**: the local paper (stale since 2019), O Mirante's agenda (HTTP
  500), Alcobaça's site and Visit Alentejo (built by script), Porto de Mós and
  Azambuja (PDF or image agendas), Facebook and Instagram (login; the Cineteatro
  now announces mostly there), Ticketline and the local TV site (unreachable).
  No municipal app or digital street screens were found.
- **Viral Agenda's district pages** were rejected for its municipality pages:
  a district page runs to towns over an hour away and a text cap cuts it after a
  few days; a municipality page is 3–5k characters and about two weeks.

Most agendas show the current month only and Viral Agenda about two weeks, so
later weeks rest on few sources; the page says which in its `note`.

# It is not a pure payload, and where it bends

[The overview](/overview.md) calls a skill a payload that runs on the user's
host. This one reaches the network by its own code, so `compatibility` says
what and how much: about 19 public pages per run, one POST and the rest GETs,
read-only.

- `collect.py` is the only script that imports `urllib`. `render.py` reads its
  input and two assets and writes one file; nothing it writes fetches anything
  when opened (no remote script, stylesheet or font).
- It names third-party sites, because they are its subject.
- A site that refuses (a 403) or does not answer is recorded as failed and not
  retried another way. After a refusal (403, 429, a 5xx), a timeout or a
  connection error the rest of that site's pages are skipped, and requests to
  one site are 1.5 s apart. GoTrail and Running.life answered Python's TLS
  handshake with a 403 while a browser got the page; a fallback to `curl` was
  built and removed, because getting round a refusal is not this script's call,
  and both were later dropped for Portugal Running. The model may read
  a failed source once with its own page-reading tool. Viral Agenda stopped
  answering this machine after about four full development passes in an hour,
  so SKILL.md says never to fetch a source repeatedly.
- Fetched text is data, never instructions, and a link is copied only from a
  source's own URLs. `render.py` keeps only `http(s)` links and writes the JSON
  with `<`, `>` and `&` escaped, so no event text can close its script element.

# The page

Its structure came from a UX consultation and its look from a designer, both
subagents, and was checked in headless Chrome at 390 and 1280 pixels, light and
dark.

- **The list leads.** Planning free time is a "what's next, what's this weekend"
  question. The calendar shows density and jumps the list to a day; it does not
  filter, so the days around stay in view. A month grid with titles was
  rejected: Portuguese titles are long and a phone cannot hold them. Tabs were
  rejected: they hide one view.
- **Long runs and regulars apart.** An exhibition of six weeks or a weekly
  market would put the same card on every day, so they sit in Ongoing and
  Regulars.
- **Everything relative to today is worked out in the browser** when the page
  is opened: the bands, the today mark, hiding past events, the Weekend chip,
  the notice on a page past its window. `render.py` reads no clock, so its
  output depends on its input alone and the sample HTML is compared byte for
  byte. Dates are built as local dates, never parsed from `YYYY-MM-DD` strings,
  which a browser reads as UTC.
- **.ics times are floating local times**, meaning Portugal's: no `TZID` and no
  `VTIMEZONE`. Do not "fix" them to UTC. All-day and multi-day events use
  `VALUE=DATE` with an exclusive end. The link is a `data:` URL, since a
  published page may block a Blob download.
- **Stars and "new since last visit" live in localStorage**, which belongs to
  the address the page is opened from. So the file names never change and a
  republish goes to the same page; a local file and a published link keep
  separate stars. Every access is in try/catch and the page works without it.
- **The id is made by `render.py`**, not the model: a hash of the title, start
  date and town, with accents, case and spacing ignored. Known limit: a source
  that rewords a title or moves the date gives the event a new id, and its star
  is lost.
- **No images.** They are often missing, heavy and hotlinked.

# Tests

`evals/rio-maior-events/` holds offline unit tests, run in CI: the collector's
parsers on small hand-written fixtures, and the renderer's validation, ids,
escaping, byte-stable sample and its rules for `page.js`. A live run is not in
CI: the sources change and some throttle. No eval measures the model's reading.
The gap: `page.js` behaviour (bands, filters, `.ics`) is checked in headless
Chrome by hand, not in CI; the tests only grep its source.
