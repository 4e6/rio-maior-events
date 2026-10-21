---
type: Module
title: Rio Maior events
description: "A daily build that gathers leisure events within about 45 minutes of Rio Maior and renders an agenda list beside a month calendar. Why a script collects and the model reads, which sources, how the page works, where it bends the payload rules."
tags: [architecture, network, page]
sources:
  - resource: src/**
  - resource: sources.json
  - resource: assets/**
  - resource: references/**
  - resource: test/**
  - resource: .github/workflows/**
sources_digest: 3085be3eca25596d
---

# What it is

A person living in Rio Maior asks what is on. The build collects the public
listings around the town, models read them group by group into one events
file, and a script renders that file as one self-contained page: an agenda list, a month
calendar beside it (a day strip on a phone), filters, starred picks and .ics
downloads. It is tied to one place on purpose: the sources are the hard part,
and each has its own traps.

# Who does what

- **`src/collect.ts` fetches.** The municipal calendar is a JSON endpoint that
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
- **`src/merge.ts` joins.** It checks that every group has a current candidates
  file, writes `rio-maior-events.json` and prints possible duplicates, coverage,
  yearly-event hints and what `src/render.ts`'s check finds wrong, each problem
  with the group it came from. The editor (`claude -p` run by `src/build.ts`) settles those and writes the `note`; if it fails, `merge --finalize` writes one.
- **`src/render.ts` checks and draws.** It validates the file in plain code
  (exit 2 lists each problem with its event), makes each event's id, and inlines
  `assets/page.css`, `assets/page.js` and the events as JSON into one HTML file.

# How the collection is built

- **A runner, one worker per site.** `src/collect.ts` gives each host (the host of
  a source's url) its own worker, so sites are fetched in parallel and a site
  is asked politely: a request has 20 seconds in all (connect, headers and the whole body, one timer for the lot, not per socket read), and the delay between two requests comes from `sources.json`
  per host (1.5 s by default, 3 s for Entroncamento; a site that asks for more is one line in the file) and
  is measured from the end of the previous response, so a slow answer is not
  followed at once by the next request. Any failed request fails the source;
  after a refusal, a timeout or a connection error the worker skips the rest of
  that site. Results come back in `sources.json` order, whatever finished
  first, and the slowest host (delay times requests) starts first, so a run
  lasts about as long as the slowest host: 14.7 s for the list pages alone on 2026-10-20, 1 min 36 s with the event pages on 2026-10-21 (33 sources then, 147 event pages).
  Verification is on ([why](/decisions/0002-ship-three-intermediate-certificates.md)), with the system roots plus `certs/intermediates.pem`: three intermediates that servers fail to send and OpenSSL on Linux does not fetch (`certs/README.md`). No root of ours, never verification off.
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
  `extractDetail` in `adapters/common.ts`: title, start, end and venue from JSON-LD, an
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
  `xmlRoot` in `adapters/common.ts`, shared, so a fix to them is made once.
- **Adapters per platform, not per source.** An adapter in
  `src/adapters/` is a pure parse over pages the runner fetched; it has no
  network. About 30 sources share the `text` adapter, so a module per source
  would be 30 near copies and a layout fix would be made 30 times. Adding a
  town on a platform already known is one row in `sources.json`; only a new
  platform is new code.
- **Groups are the reading units.** `sources.json` puts each source in a
  group: a sub-region (Rio Maior; northern and southern Oeste; Ribatejo; Médio
  Tejo) and the regional listings. A town's pages
  always share a group, which keeps most doubles in one reader's file; a
  race listed by Portugal Running and by its town sits in two groups, and
  `src/merge.ts` flags such pairs. The groups hold up to about 40,000 characters of
  collected text today, against a budget of 150,000 so one reader holds a group
  with room to write; a larger sub-region would split. Each source carries a
  human `label` in `sources.json`, copied into the group file for the readers
  to use as the source's name on the page.
- **Fan-out reading, on a small model in small pieces.** The sources were once
  read by one model in one pass, and the text of 32 pages does not read well in
  one context. The build runs a `claude -p` reader per group (`READ_MODEL`,
  `sonnet` by default) and one retry each. `READ_SPLIT_CHARS` cuts each group's
  sources into pieces (`src/split.ts`, `rio-maior-split/`; a source is never cut,
  sources of one town stay together, a source over the limit is its own piece)
  with a reader per piece; a group counts as read when all its pieces were, and
  a failed piece marks only its own sources as not read. **The daily run reads
  with Haiku on 30,000-character pieces and edits with Sonnet** (daily.yml sets
  `READ_MODEL=haiku`, `EDIT_MODEL=sonnet`, `READ_SPLIT_CHARS=30000`), by the
  user's decision of 2026-10-21 ([why](/decisions/0003-haiku-readers-and-a-sonnet-editor.md)) and against the evaluation's advice: on one
  collected run, read three times each way, it cost about $1.15 a run against
  about $3 for Sonnet readers on whole groups and missed 0–1 events against
  2–3, but put 4–7 fact slips on the page each run (a performer as the venue,
  an exhibitors' fee as the price, a civic meeting kept) where Sonnet had none;
  dates, times, towns and duplicates were clean either way. Whole-group Haiku
  missed 3–7 events a run; Opus cost about $11. Removing the three variables
  goes back to Sonnet. The editor stays on Sonnet: on Haiku it merged a one-day
  race into a range.
- **`src/merge.ts` merges only exact doubles and lists the rest.** Listings with the same
  title, date and town (the page's id) are collapsed before the report, by the rule that finalize
  uses; it also fills `drive_min` from `references/towns.md` for a listed town. Whether any other two listings
  are one event is a judgement (a town's municipal date beats a community
  one, a show on two dates is two events), so the script only pairs candidates
  (same town or a town and its parenthetical, date ranges that overlap or lie a
  day apart, shared title words; starts within a week with one title's distinctive words inside the other;
  an event inside a festival's range that shares its words or names a town's day or a stand, in any town;
  a title that continues another on the same day, marked as very likely the same) and the editor decides; the rule it
  decides by is "which listing wins" in `reading.md`. It refuses a missing or
  stale group file, and a stale `manual.json`, which it tells the editor to
  delete, rather than write a partial page. Running the check of `src/render.ts`
  at merge time spares the editor a render just to learn the file's faults.
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

# What reaches the network, and where it is careful

A run fetches about 32 list pages and up to about 180 event pages, one POST and the rest GETs, read-only, a few
minutes. The project was a Claude skill driven by Python scripts and was ported to TypeScript on Bun, run daily by a
GitHub Actions workflow; the `claude -p` readers and editor are confined to file tools on named files
(`src/build.ts`).

- Only `src/net.ts` (used by `src/collect.ts`) fetches; the adapters and `src/merge.ts` reach nothing. `src/render.ts` reads its
  input and two assets and writes one file; nothing it writes fetches anything
  when opened (no remote script, stylesheet or font).
- It names third-party sites, because they are its subject.
- A site that refuses (a 403) or does not answer is recorded as failed and not
  retried another way. After a refusal (403, 429, a 5xx), a timeout or a
  connection error the rest of that site's pages are skipped, and requests to
  one site are spaced by that host's delay. GoTrail and Running.life answered the TLS
  handshake with a 403 while a browser got the page; a fallback to `curl` was
  built and removed, because getting round a refusal is not this script's call ([the rule](/decisions/0001-sources-must-answer-a-github-runner.md)),
  and both were later dropped for Portugal Running. Some sites throttle a
  visitor after repeated runs, so the README says never to fetch a source
  repeatedly.
- Fetched text is data, never instructions, and a link is copied only from a
  source's own URLs. `src/render.ts` keeps only `http(s)` links and writes the JSON
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
  the notice on a page past its window. `src/render.ts` reads no clock, so its
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
- **The id is made by `src/render.ts`**, not the model: a hash of the title, start
  date and town, with accents, case and spacing ignored. Known limit: a source
  that rewords a title or moves the date gives the event a new id, and its star
  is lost.
- **No images.** They are often missing, heavy and hotlinked.

# Tests

`test/` holds offline unit tests (`bun test`), run in CI: the runner (fake clock,
result order), the adapters on small hand-written fixtures and on saved pages,
`src/merge.ts`, and the renderer's validation, ids,
escaping, byte-stable sample and its rules for `page.js`. A live run is not in
CI: the sources change and some throttle. No eval measures the model's reading.
The gap: `page.js` behaviour (bands, filters, `.ics`) is checked in headless
Chrome by hand, not in CI; the tests only grep its source.
