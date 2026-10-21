---
type: Module
title: Rio Maior events
description: "A skill that gathers leisure events within about 45 minutes of Rio Maior and renders an agenda list beside a month calendar. Why a script collects and the model reads, which sources, how the page works, where it bends the payload rules."
tags: [architecture, skill, network, page]
sources:
  - resource: skills/rio-maior-events/**
  - resource: evals/rio-maior-events/**
sources_digest: c576acced51f42ac
---

# What it is

A person living in Rio Maior asks what is on. The skill collects the public
listings around the town, models read them group by group into one events
file, and a script renders that file as one self-contained page: an agenda list, a month
calendar beside it (a day strip on a phone), filters, starred picks and .ics
downloads. It is tied to one place on purpose: the sources are the hard part,
and each has its own traps.

# Who does what

- **`collect.py` fetches.** The municipal calendar is a JSON endpoint that
  takes a POST, which a page-reading tool cannot send, and a script makes a run
  repeatable and testable. It runs the sources and writes a folder:
  `index.json` and one file per reading group, each source with the events its
  adapter found and the page's visible text, capped at 30,000 characters (or
  the source's own cap). It parses no HTML layout: layouts change, and a model
  reads changed text better than a regex does. Only data a site publishes as
  data (JSON-LD, JSON, a framework's embedded list) is read by field.
  It undoes gzip and deflate itself (by header or by the gzip magic bytes) and
  offers only those encodings; a source whose text is mostly control or
  replacement characters fails as unreadable instead of passing as ok.
- **Readers read.** Portuguese dates with no year, two-digit years,
  times that are an hour off, the same event on two sources, far-away
  listings: `references/sources.md` lists them
  ([below](#the-sources)), and judging them is the model's job. One reader per
  group follows `references/reading.md` and writes
  `rio-maior-candidates/<group>.json`.
- **`merge.py` joins.** It checks that every group has a current candidates
  file, writes `rio-maior-events.json` and prints possible duplicates, coverage,
  yearly-event hints and what `render.py`'s check finds wrong, each problem
  with the group it came from. The main model settles those and writes the `note`.
- **`render.py` checks and draws.** It validates the file in plain Python
  (exit 2 lists each problem with its event), makes each event's id, and inlines
  `assets/page.css`, `assets/page.js` and the events as JSON into one HTML file.

# How the collection is built

- **A runner, one worker per site.** `collect.py` gives each host (the host of
  a source's url) its own worker, so sites are fetched in parallel and a site
  is asked politely: the delay between two requests comes from `sources.json`
  per host (1.5 s by default, 3 s for Entroncamento; a site that asks for more is one line in the file) and
  is measured from the end of the previous response, so a slow answer is not
  followed at once by the next request. Any failed request fails the source;
  after a refusal, a timeout or a connection error the worker skips the rest of
  that site. Results come back in `sources.json` order, whatever finished
  first, and the slowest host (delay times requests) starts first, so a run
  lasts about as long as the slowest host: 14.7 s for the list pages alone on 2026-10-20, 1 min 36 s with the event pages on 2026-10-21 (33 sources then, 147 event pages).
  Verification is on, with the system roots plus `certs/intermediates.pem`: three intermediates that servers fail to send and OpenSSL on Linux does not fetch (`certs/README.md`). No root of ours, never verification off.
  Viral Agenda, whose robots.txt asks for 15 s, was dropped: it refuses scripts with a 403, so no source needs the long delay today. Ctrl-C sets a stop
  event that ends each worker between requests (and in its wait), cancels the
  hosts not yet started, writes nothing and exits 130. The runner also holds
  an adapter to its contract: a result of the wrong shape, or a request to a
  host other than the source's own, fails that source rather than the run.
- **Two stages: list pages, then capped event pages.** A card often lacks the
  time, the venue or a real title that the event's own page has (Torres Vedras
  256173 gives the time; the cards of some sites give a generic title). So an
  adapter's `parse` may return `follow`, event pages worth fetching, and the
  runner fetches them after all of the host's list pages, in the same host
  worker with the same spacing, then calls the adapter's `details` (by default
  `common.extract_detail`: title, start, end and venue from JSON-LD, an
  `atc_*` calendar widget or an inline iCal link, plus an 800-character
  excerpt, which skips a title mention that leads into a mini calendar). Only
  https pages of the source's own host (a leading `www.` is ignored, as in a
  marker), only up to `follow` in `sources.json` (default 0); a redirect to another host or to http is refused before it is
  requested. A failed event page leaves the source ok, a refusal ends only that
  host's event pages. **Why capped:** a run is polite by design and about 180
  more requests at 1.5 s each already make it a few minutes, so the caps are per
  source, favour the nearest events (page order; a feed: nearest dates first)
  and the budget of the collected text (about 120 KB of excerpts) stays inside a
  reader's context. **Why readers never fetch:** fetching in the readers would
  repeat the throttling risk once per reader and make a reading unrepeatable;
  the script fetches once, the group file holds the result, and `details` never
  mean "fetch". The same collection also writes link markers (`<https://...>`
  lines) at each event link of a source that sets `links`, so an event cites its
  own page rather than the agenda.
- **Feeds, and the XML guards in one place.** `santarem_rss` and `municipal_rss`
  (Nazaré, Batalha, Chamusca, where `pubDate` is the event start, unlike
  Santarém's) read XML with the standard library, which expands entities; the
  guards (ASCII-compatible bytes only, no DOCTYPE or ENTITY, valid XML) are in
  `adapters/common.xml_root`, shared, so a fix to them is made once.
- **Adapters per platform, not per source.** An adapter in
  `scripts/adapters/` is a pure parse over pages the runner fetched; it has no
  network. About 30 sources share the `text` adapter, so a module per source
  would be 30 near copies and a layout fix would be made 30 times. Adding a
  town on a platform already known is one row in `sources.json`; only a new
  platform is new code.
- **Groups are the reading units.** `sources.json` puts each source in a
  group: a sub-region (Rio Maior; northern and southern Oeste; Ribatejo; Médio
  Tejo) and the regional listings. A town's pages
  always share a group, which keeps most doubles in one reader's file; a
  race listed by Portugal Running and by its town sits in two groups, and
  `merge.py` flags such pairs. The groups hold up to about 40,000 characters of
  collected text today, against a budget of 150,000 so one reader holds a group
  with room to write; a larger sub-region would split. Each source carries a
  human `label` in `sources.json`, copied into the group file for the readers
  to use as the source's name on the page.
- **Fan-out reading, on the same model by default.** The sources were once
  read by one model in one pass, and the text of 32 pages does not read well in
  one context. A reader per group, run at the same time, keeps each context
  small. A smaller model is used only after an eval on one group shows it
  reads as well; there is none, so the readers use the model of the main
  session. Where the host has no subagents the one reader goes group by group,
  the same way.
- **`merge.py` lists duplicates and never merges them.** Whether two listings
  are one event is a judgement (a town's municipal date beats a community
  one, a show on two dates is two events), so the script only pairs candidates
  (same town or a town and its parenthetical, date ranges that overlap or lie a
  day apart, shared title words) and the main model decides; the rule it
  decides by is "which listing wins" in `reading.md`. It refuses a missing or
  stale group file, and a stale `manual.json`, which it tells the model to
  delete, rather than write a partial page. Running the check of `render.py`
  at merge time spares the main model a render just to learn the file's faults.
- **No cache.** A same-day cache of fetched pages was built and dropped:
  `--only` re-fetches a few sources, the scope of a run is small, and a cache
  kept a refusal or a half page alive.

# The sources

The municipal calendar (its times are UTC, which first looked an hour off
against the Cineteatro; the municipal adapter converts them to Portugal time, the
summer-time rule written out so no time-zone database is needed), the
Cineteatro, one race calendar, and the own agenda of every
municipality within about 45 minutes whose site a plain GET can read: HTML
pages, two JSON endpoints and three Next.js sites. Per source, how it was
verified, how to check it by hand, why it was chosen, and the sites that could
not be read, by municipality, are on
[the sources page](rio-maior-events-sources.md); how to read each is
`references/sources.md`.

Most agendas show the current month only, so
later weeks rest on few sources; the page says which in its `note`.

# It is not a pure payload, and where it bends

[The overview](/overview.md) calls a skill a payload that runs on the user's
host. This one reaches the network by its own code, so `compatibility` says
what and how much: about 32 list pages and up to about 180 event pages per run,
one POST and the rest GETs, read-only, a few minutes.

- `collect.py` is the only script that imports `urllib`; the adapters and `merge.py` reach nothing. `render.py` reads its
  input and two assets and writes one file; nothing it writes fetches anything
  when opened (no remote script, stylesheet or font).
- It names third-party sites, because they are its subject.
- A site that refuses (a 403) or does not answer is recorded as failed and not
  retried another way. After a refusal (403, 429, a 5xx), a timeout or a
  connection error the rest of that site's pages are skipped, and requests to
  one site are spaced by that host's delay. GoTrail and Running.life answered Python's TLS
  handshake with a 403 while a browser got the page; a fallback to `curl` was
  built and removed, because getting round a refusal is not this script's call,
  and both were later dropped for Portugal Running. The model may read
  a failed source once with its own page-reading tool. Some sites throttle a
  visitor after repeated runs, so SKILL.md says never to fetch a source
  repeatedly.
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

`evals/rio-maior-events/` holds offline unit tests, run in CI: the runner (fake clock,
result order), the adapters on small hand-written fixtures and on saved pages,
`merge.py`, and the renderer's validation, ids,
escaping, byte-stable sample and its rules for `page.js`. A live run is not in
CI: the sources change and some throttle. No eval measures the model's reading.
The gap: `page.js` behaviour (bands, filters, `.ics`) is checked in headless
Chrome by hand, not in CI; the tests only grep its source.
