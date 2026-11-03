---
type: Module
title: Rio Maior events, the sources
description: "The maintainer's view of each source the rio-maior-events collector reads: when and how it was checked, what to look at by hand, what breaks it, why it was chosen over its alternatives, and the sites that could not be read, by municipality."
tags: [architecture, network]
sources:
  - resource: sources.json
  - resource: src/adapters/**
  - resource: references/sources.md
  - resource: tools/probe_*.ts
  - resource: .github/workflows/probe.yml
sources_digest: 028d10e45496c0be
---

# What this page is for

[The architecture page](rio-maior-events.md) says why a script collects and the model
reads. This page is for the person who keeps the list: which sources there are,
how each was verified, how to check one by hand when a run reports it failed,
and why a source was taken over its alternatives. **Addresses, layouts, reading traps and date
formats are not here**: they are in
[`references/sources.md`](../../references/sources.md),
which the model reads at run time, and in `sources.json` (the list, with each source's adapter and group) and the adapters. A source added or dropped changes `sources.json`, `sources.md`
and this page.

# How everything was verified

On 2026-10-20, one plain GET per page (and `robots.txt` once per host), the
visible text read by eye. The two JSON sources and the three Next.js sites were
first decoded offline from the saved responses; then `src/collect.ts` itself was run
on 2026-10-20 and read all 32 sources ok in 14.7 s (Viral Agenda, left out, see [Not reachable](#not-reachable)).
On 2026-11-03 the same was done for the three sources added then (Arruda dos Vinhos, Sobral de Monte Agraço, Marinha Grande): one plain GET per page and `robots.txt` once per host, and `src/collect.ts` itself run on them from a home address with no proxy, 3 ok, 22, 8 and 8 items, and 21 event pages read (8, 8 and 5). Whether they answer a GitHub runner directly was settled by the `probe` workflow, run on this branch on 2026-11-03 ([run 41654979471](https://github.com/4e6/rio-maior-events/actions/runs/41654979471)): Arruda dos Vinhos 200, 22 items, 8 details; Sobral de Monte Agraço 200, 8 items, 8 details; Marinha Grande 200, 8 items, 5 details, all answering the runner directly.
On 2026-11-03 Benavente was read for the same purpose and left out. From a home address with no proxy `src/cli/collect.ts` read it ok (25 items, 6 distinct events, 6 event pages), but the `probe` workflow showed that Benavente did not answer a GitHub runner in two probes (20 s timeouts): the collector and a plain Bun fetch both timed out after 20 s, in runs [41660030753](https://github.com/4e6/rio-maior-events/actions/runs/41660030753) and [41660978728](https://github.com/4e6/rio-maior-events/actions/runs/41660978728); and in run [41662405912](https://github.com/4e6/rio-maior-events/actions/runs/41662405912) the proxy probe returned `ProxyError: proxy failed: 502` for Benavente while Santarém, Torres Novas, Alcanena, Entroncamento and Vila Nova da Barquinha all returned 200. That is one proxy probe, one sample: a transient exit fault is not excluded. The site sets a `cookiesession1` session cookie, which hints at a firewall in front; that is evidence, not proof. The owner left it out; the proxy is never used "to add a source on the grounds that it can now be read" ([decision 0004, Consequences](/decisions/0004-a-residential-proxy-for-the-sites-that-refuse-github-runners.md)).
On 2026-11-03 the Feira Nacional do Cavalo's programme page (Golegã) was added as `fnc-golega`: one plain GET, `robots.txt` `Allow: /`, the `?p=497` redirect followed (301 to `/fnc-2026-3/`), and `src/cli/collect.ts --only fnc-golega` run from a home address with no proxy, ok, about 11,000 characters of text, not truncated, read directly. The `probe` workflow (GitHub run 41669143546, 2026-11-03) then read it from a GitHub runner: ok, 200, direct, no proxy (that step has none), 0 items, 11179 characters of text. (In the plain Bun fetch list `fnc-golega` shows 301, as expected: `probe_bun.ts` does not follow redirects.) A GitHub runner read it directly in one probe (run 41669143546); that is one run against a Cloudflare-fronted site, which may challenge or rate-limit some runner IPs on other days. Then this source fails alone for that build, and ops-watch's `rme-status-json` warns on failed sources and names it. The proxy is still not a reason to keep the source.
Drive times in `towns.md` are estimates. A source is only as checked as that: a
layout that changed since is the usual reason a run reports one failed or empty.

Every page was fetched once, with no retry. None of the robots files disallows
the paths read (several hold only the commented-out example text). The one
request-rate rule is the Entroncamento site's `Crawl-delay: 3`; one page per
run, and the collector's 1.5 s spacing per host, are within the spirit of it.

From a GitHub runner the picture differs: the `probe` workflow
(`.github/workflows/probe.yml`, run by hand) collects once there and prints one
line per source (`tools/probe_summary.ts`), plus one plain GET per source with
Bun (`tools/probe_bun.ts`). On 2026-11-03, with the three added sources, it gave 30 of 35 ok; the five failures are the same runner-refusers named next. Later the same day, with `fnc-golega` added (run 41669143546), it gave 31 of 36 ok, the same five failing (Torres Novas, Entroncamento, Alcanena, Barquinha, Santarém). On 2026-10-21 it gave 27 of 32 ok; Santarém (timeout),
Torres Novas (503), Alcanena, Entroncamento and Vila Nova da Barquinha
(connection reset) refuse the runner's address while answering a home one. The scheduled build reads these five through the fallback proxy
([the decision](../decisions/0004-a-residential-proxy-for-the-sites-that-refuse-github-runners.md)); the probe's last step checks them through it.

# Per source or group

The hand check is the same everywhere unless said: open the address in a
browser; the page should show dated cards for the coming weeks.

- **Rio Maior calendar and the Cineteatro.** The backbone; see
  [the architecture page](rio-maior-events.md#the-sources) for why a POST, and why
  UTC is converted. By hand: the calendar's endpoint must be POSTed, so check
  the municipality's own agenda page instead.
- **Portugal Running.** The one race calendar ([why](#why)). Breaks if the site starts
  refusing scripts, as GoTrail and Running.life did, or reformats its card date line (the collector then keeps every card and notes it; merge still holds the races to the coming weeks). Only the coming weeks are read (`horizon: near`). Each month's list is cut
  behind a "Mostrar mais" the collector cannot press, so a month can hold more
  races than the text shows; the readers say so in their coverage lines.
- **Joomla agendas (Alcanena, Entroncamento, Vila Nova da Barquinha, Torres
  Novas).** One template, so one change breaks four. Torres Novas shows page 1
  of 4 only. Entroncamento asks for a crawl delay of
  3; the collector reads one page of it.
- **Theatres and cinemas (Torres Novas, Torres Vedras, Alcobaça, Caldas da
  Rainha).** Small pages, each one venue; the Caldas da Rainha centre's is the
  thinnest, so an empty read there is plausible. Breaks when a venue moves to a ticketing service
  or hides the programme behind a script.
- **Torres Vedras music category.** Chosen over the municipality's `/agenda/`:
  that listing has 56 pages and its first page held two days of workshops. The
  music category is the part with concerts. The municipality's theatre and
  cinema categories were not fetched; the theatre's own page covers them.
- **Leiria.** First page of 128 only. The agenda's own site is separate from the
  municipality's; the municipal site was not used. Breaks if the list is
  loaded by script after the first page.
- **Alcobaça home page.** Chosen over the municipality's agenda page, which is
  built by script and gives nothing to a plain request. The Cine-Teatro's own page
  covers its films.
- **Óbidos.** The agenda site (a separate address from the municipality's) was
  chosen over the municipality's own `/agenda` page.
- **Santarém (the council's feed and the culture site).** The council's
  `/agenda` is not a page: it redirects to a "not found" page that happened to hold
  the month, and the site's robots.txt disallows `format=feed` and paging on
  the agenda, so the feed the portal publishes for calendars (`/rss_eventos`,
  with start and end dates, times and venue per entry) is the way in, read
  by its own adapter because the dates are not `pubDate`. That host often
  answers 500 or times out; a failed row is the usual sign, not a layout
  change. The culture site (Santarém Acontece) is read as well because it has
  the theatre, libraries and workshops the feed lacks, and it answers when
  the council host does not; its own RSS has ten items with no venue or end
  date, so the programme page is read as text instead. Breaks when the feed's
  field names change or the culture page's cards move.
- **Porto de Mós home page.** Chosen over the agenda page the site links to,
  which holds a 2020 listing. Breaks when the home page's agenda block moves.
- **Almeirim, Batalha, Nazaré, Peniche, Chamusca.** Municipal listings, one page
  each. None is paged: one page per source, by decision, so Almeirim
  (page 1 of 2) reaches only a few weeks ahead; so do the Cartaxo (1 of 2) and Torres Novas (1 of 4) agendas. Peniche's page
  carries leftover markup, which the collector filters and its text cap guards.
- **JSON sources (Ourém, Cadaval).** Ourém is a standard events plugin's API,
  steady. Cadaval's host name contains "stage" and may move; the
  town's own site would then show the new host in its scripts. Cadaval's event
  link is inferred from a route of the site; the inferred link answered 200 in the
  live run of 2026-10-20. Both are decoded by field, so a renamed field breaks
  them quietly: a run that reports zero items from either is worth a look.
- **Next.js sites (Bombarral, Lourinhã, Alenquer, Sobral de Monte Agraço).** The events come from data
  embedded in the page, not from its visible text, which is empty. The decoding
  depends on the framework's embedding format and the name of the list inside
  it; a framework change breaks all four at once. Only page 1 is read; the source's
  `note` in a run says how many pages there are. The list has midnight dates and
  no time, and an event page has no text either, so the adapter's `details`
  reads the page's own payload (`pageData.modules`, the object with a
  `description`): the description holds the time, venue and price, and its UTC
  dates become Lisbon time (follow 10 each, in date order). Its `schedule` field, when it is one clock time or a range, gives the start (and end) a time; any non-empty value is put first in the excerpt as "Horário: ...". A page whose payload
  has another shape is read as any page.
- **Feeds of one platform (Nazaré, Batalha, Chamusca, Arruda dos Vinhos, Marinha Grande).**
  The same template as Peniche's page, with an RSS feed at `/pages/<path>.rss`; a
  platform change breaks five sources. The feeds are cut by date, not by page:
  Arruda's starts on the collection day, so a multi-day festival that began before
  Monday is on the page but not in the feed; Marinha Grande's covers the current
  month only, so events from the 1st until the first Monday run are on no page, and
  the run before sees only the previous month. At 50 and 55 minutes, where only a big
  event is kept, that is the accepted cost.
- **Feira Nacional do Cavalo (Golegã, `fnc-golega`).** One `text` row with no `links` and no `follow`, at the page's WordPress number (`/?p=497`): the programme's slug changes every year (old slugs 404), page 497 was created in 2022 (REST creation date) and now holds the 2026 programme; that the site edits it in place each year is inferred, not seen (the Wayback Machine was offline, so earlier years' addresses could not be read), the "Programa" link on the home page sits in the menu the text parser skips, and a followed page gives only an 800-character excerpt, far short of the programme. The year is not on the day headings, so `references/sources.md` tells the readers to take it from the title and the weekdays. Breaks quietly if the site makes a new page for a year: `?p=497` then keeps showing the old programme, the source stays `ok` and nothing alerts; the October hand check in `sources.md` is the only guard. If page 497 is deleted the source fails, which ops-watch reports. Cloudflare fronts the site; a GitHub runner read it directly in one probe (run 41669143546, 2026-11-03), but Cloudflare may challenge or rate-limit some runner IPs on other days, and the source then fails alone for that build. The proxy is still not a reason to keep it.
- **Supplementary agendas.** As before: plain text, expect gaps.

# Event links and event pages

Which sources have `links` (markers) and how many event pages each fetches
(`follow` in `sources.json`); what a page gives was checked offline on the saved
pages of 2026-10-20 and live on 2026-10-21: 33 sources ok (Eventbrite, one of them, has since been removed), 147 event pages read, 1 min 36 s.

- **Torres Vedras music (15):** time, venue and the real title. Cineteatro
  (Rio Maior), Santarém Acontece, Alcobaça, Caldas (MCR), Cartaxo, Leiria, Almeirim:
  links only.
- **Centro Cultural das Caldas (12):** time, hall and prices.
- **Teatro Virgínia (10):** time and price. **Entroncamento (10):** the time
  only. **Torres Novas, Alcanena, Barquinha (10):** time. Torres Novas,
  Alcanena, Entroncamento and Barquinha link their mini-calendar day cells, whose
  `title` attribute names the event, so the marker is followed by that title. In
  the text the day number comes after the title, and models misread it (a day
  early, even with a rule saying so), so for these four (`options.mini_calendar`)
  the text adapter reads the calendar's HTML itself (`miniCalendarItems` in
  `src/adapters/common.ts`: the day from the cell, month and year from the
  calendar's hidden `month_ajax`/`year_ajax`) and gives each event as an item with
  its first date; the calendar marks only the first day, so there is no end. A
  day with several events is one link to a day view ("N Eventos"), so those get
  no date from the calendar. When no calendar can be read, the source's `note`
  says so and reading.md falls back to the number after the title. All of them
  refuse GitHub's runners directly today; the fallback proxy reads them in the scheduled build.
- **Óbidos (10):** hours and venue. **Porto de Mós (10)**: calendar data
  (start, end, venue); Batalha's pages carry the same, but its feed is read
  with no event pages.
- **Portugal Running, three districts (8 each):** the start time.
- **Teatro-Cine Torres Vedras, Cine-Teatro Alcobaça, Peniche (8):** event pages fetched; the research of 2026-10-20 found a time on the Teatro-Cine's pages (21h00) and Cine-Teatro Alcobaça's (20h30); Peniche's was not sampled.
- **Arruda dos Vinhos (8), Sobral de Monte Agraço (10), Marinha Grande (5):** Arruda's pages give start, end and venue; Sobral's give the time from `schedule`; Marinha Grande's give no structured data, so the excerpt (venue and time in prose) is what they add, which is why it is 5, not 8.
- **Nazaré (8):** the pages give the venue (live 2026-10-21: "cineteatro") and
  an excerpt with a line of detail ("Jovens pianistas"); the titles stay
  generic.
- **Feeds** (Nazaré, Batalha, Chamusca, Arruda dos Vinhos, Marinha Grande): `pubDate` is the start. Their `rss` addresses are
  the platform's `/pages/<path>.rss`. If one stops answering, the agenda page is
  the fallback to read as text.

# Not reachable

Sites tried on 2026-10-20 and not added. Municipality means the town the site
serves; the regional and national rows are there because they would have
covered several.

| Municipality | Site | Reason |
|---|---|---|
| Azambuja | cm-azambuja.pt agendas culturais | 404; the agendas are PDFs |
| Golegã | visitgolega.com/agenda | built by script, nothing to read; the fair's own site is read instead (`fnc-golega`) |
| Alpiarça | cm-alpiarca.pt | the events category (`/documentos/eventos`) is stale, nine posts from April to September, and current items are in `/noticias`, mixed with news, so a plain reader would need a news filter (checked 2026-11-03) |
| Salvaterra de Magos | cm-salvaterrademagos.pt | the home page links an agenda news post whose address changes |
| Tomar | cm-tomar.pt | about 55 minutes, like Sobral de Monte Agraço and Marinha Grande; readable from home on 2026-11-03 (page 1 of 3, dates in the text), but not added; readable from a home address (page 1 of 3, dates in the text) but left out of this change as a scope decision; adding it would be a row in `sources.json` followed by a `probe` run (the probe only reads `sources.json`, so it cannot test Tomar before a row exists), and it stays out unless that shows a runner reads it directly |
| Constância | none | stale: the newest agenda entry is December 2025 (2026-11-03) |
| Benavente | cm-benavente.pt/index.php/agenda/ | did not answer GitHub's runner in two probes (20 s timeouts, collector and plain Bun fetch); through the fallback proxy one probe got `ProxyError: proxy failed: 502` from the gateway while five other sites answered 200 (a transient exit fault is not excluded) (2026-11-03). Its feed is invalid XML and its REST list empty, but the `text` adapter reads the page from a home address; the verified row is in `references/sources.md` ("Not used: Benavente") |
| Médio Tejo (region) | agenda.mediotejo.pt | built by script, empty to a plain request |
| Rio Maior, Santarém, Caldas da Rainha, Óbidos, Alcobaça, Torres Novas, Cartaxo, Porto de Mós, Bombarral | Viral Agenda (viralagenda.com), nine municipality pages | refuses the collector's HTTP client with a 403 whatever the User-Agent (an honest one included), though curl and browsers are answered and its robots.txt allows Claude-User with a 15 s crawl delay; not routed around. It would add nightlife and private venues (clubs, a bar, galleries, a theatre), guided walks and municipal events past the first page of a town's own list: about 22 events over two to three weeks on 2026-10-20 |
| Santarém (regional) | O Mirante | HTTP 500 |
| National | Ticketline | no connection |
| Rio Maior | riomaiortv.pt | no connection |
| Rio Maior | Região de Rio Maior | stale since 2019 |
| Alentejo | Visit Alentejo | built by script |
| National | GoTrail, Running.life | 403 to this script |
| National | Racefinder | its robots.txt asks automated visitors off the listing by area |
| Any | Facebook, Instagram | need a login |
| Torres Vedras | theatre and cinema categories of the municipal agenda | not fetched |

Salvaterra de Magos has an agenda and only a stable address is
missing; it is the most likely to be worth a manual re-check. Golegã's agenda and the Médio Tejo agenda would
need a browser.

# Known issues

- **`excerpt()` can return the page's menu.** In `src/adapters/common.ts`, `excerpt()` finds the page's `og:title` in the text with `indexOf`; when the title there differs from the text by a quote (straight against curly), nothing matches and the excerpt falls back to the start of the page, which is the site's menu. It hit 2 of the 8 Benavente event pages sampled. `excerpt()` is called only by `extractDetail`, which runs for every followed event page: through `defaultDetails` for each adapter without its own `details` (today `text` and `municipal_rss`, so the `text` sources with `links` and the `municipal_rss` ones with `follow`: cm-nazare, cm-arruda, cm-mgrande), and in `nextjs` (cm-bombarral, cm-lourinha, cm-alenquer, cm-sobral) only as the fallback when its own page parsing throws. Not fixed.

# Why

- **Every municipality within about 45 minutes that a plain GET can read, and for
  the few at 50 to 55 minutes that an existing adapter reads, their big events only.**
  The page is for a person in Rio Maior; the readers keep only a big event from a
  town of 50 minutes or more (`references/reading.md`, `towns.md`). Widened by the
  owner on 2026-11-03: Peniche, Leiria, Chamusca, Entroncamento (50), Ourém and Vila
  Nova da Barquinha (55) were already sources at that distance; the widening added
  towns there that had none before, Arruda dos Vinhos (50), Golegã (50, its fair only), Sobral de Monte Agraço
  and Marinha Grande (55), and a town beyond that is still out. A source
  that needs a browser or a login is out, because the collector does not do
  either ([where it bends](rio-maior-events.md#what-reaches-the-network-and-where-it-is-careful)).
- **Own site before an aggregator.** A municipality's own listing is the
  primary, even when thin. Viral Agenda, the one community aggregator tried,
  refuses scripts ([Not reachable](#not-reachable)) and is left out rather than
  reached another way.
  It would have added about 22 events over two to three weeks. Rejected: a
  browser-like client or a `curl` fallback (getting round a refusal was not this
  script's call then), and honouring its 15 s crawl delay (the site answers 403
  whatever the delay, and no source needs a long delay today).
- **A source per page, no pagination.** Following page 2 would double the
  requests for a few more events and a politeness cost; the model is told which
  sources are cut at the first page.
- **One race calendar.** Race calendars list the same races, so the build reads
  one. Portugal Running won: it lists road races, trails and walks months ahead
  with each race's town, and lets a script in. GoTrail and Running.life answer
  the script with a 403; Racefinder's only listing by area is a filter its
  robots.txt asks automated visitors not to use.
- No municipal app or digital street screens were found online.
