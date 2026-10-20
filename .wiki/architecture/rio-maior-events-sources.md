---
type: Module
title: Rio Maior events, the sources
description: "The maintainer's view of each source the rio-maior-events collector reads: when and how it was checked, what to look at by hand, what breaks it, why it was chosen over its alternatives, and the sites that could not be read, by municipality."
tags: [architecture, skill, network]
sources:
  - resource: skills/rio-maior-events/scripts/sources.json
  - resource: skills/rio-maior-events/scripts/adapters/**
  - resource: skills/rio-maior-events/references/sources.md
sources_digest: 4408685dc6abc021
---

# What this page is for

[The skill's page](rio-maior-events.md) says why a script collects and the model
reads. This page is for the person who keeps the list: which sources there are,
how each was verified, how to check one by hand when a run reports it failed,
and why a source was taken over its alternatives. **Addresses, layouts, reading traps and date
formats are not here**: they are in
[`references/sources.md`](../../skills/rio-maior-events/references/sources.md),
which the model reads at run time, and in `scripts/sources.json` (the list, with each source's adapter and group) and the adapters. A source added or dropped changes `sources.json`, `sources.md`
and this page.

# How everything was verified

On 2026-10-20, one plain GET per page (and `robots.txt` once per host), the
visible text read by eye. The two JSON sources and the three Next.js sites were
first decoded offline from the saved responses; then `collect.py` itself was run
on 2026-10-20 and read all 32 sources ok in 14.7 s (Viral Agenda, left out, see [Not reachable](#not-reachable)).
Drive times in `towns.md` are estimates. A source is only as checked as that: a
layout that changed since is the usual reason a run reports one failed or empty.

Every page was fetched once, with no retry. None of the robots files disallows
the paths read (several hold only the commented-out example text). The one
request-rate rule is the Entroncamento site's `Crawl-delay: 3`; one page per
run, and the collector's 1.5 s spacing per host, are within the spirit of it.

# Per source or group

The hand check is the same everywhere unless said: open the address in a
browser; the page should show dated cards for the coming weeks.

- **Rio Maior calendar and the Cineteatro.** The backbone; see
  [the skill's page](rio-maior-events.md#the-sources) for why a POST, and why
  UTC is converted. By hand: the calendar's endpoint must be POSTed, so check
  the municipality's own agenda page instead.
- **Portugal Running.** The one race calendar ([why](#why)). Breaks if the site starts
  refusing scripts, as GoTrail and Running.life did. Each month's list is cut
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
- **Next.js sites (Bombarral, Lourinhã, Alenquer).** The events come from data
  embedded in the page, not from its visible text, which is empty. The decoding
  depends on the framework's embedding format and the name of the list inside
  it; a framework change breaks all three at once. Only page 1 is read; the source's
  `note` in a run says how many pages there are.
- **Supplementary agendas and Eventbrite.** As before: plain text, expect gaps.

# Event links and event pages

Which sources have `links` (markers) and how many event pages each fetches
(`follow` in `sources.json`); what a page gives was checked offline on the saved
pages of 2026-10-20 and live on 2026-10-21: 33 sources ok, 147 event pages read, 1 min 36 s.

- **Torres Vedras music (15):** time, venue and the real title. Cineteatro
  (Rio Maior), Santarém Acontece, Alcobaça, Caldas (MCR), Cartaxo, Leiria, Almeirim:
  links only.
- **Centro Cultural das Caldas (12):** time, hall and prices.
- **Teatro Virgínia (10):** time and price. **Entroncamento (10):** the time
  only. **Torres Novas, Alcanena, Barquinha (10):** time. Torres Novas and
  Entroncamento link their mini-calendar day cells, whose `title` attribute names
  the event, so the marker is followed by that title.
- **Óbidos (10):** hours and venue. **Porto de Mós (10)**: calendar data
  (start, end, venue); Batalha's pages carry the same, but its feed is read
  with no event pages.
- **Portugal Running, three districts (8 each):** the start time.
- **Teatro-Cine Torres Vedras, Cine-Teatro Alcobaça, Peniche (8):** event pages fetched; the research of 2026-10-20 found a time on the Teatro-Cine's pages (21h00) and Cine-Teatro Alcobaça's (20h30); Peniche's was not sampled.
- **Nazaré (8):** the pages give the venue (live 2026-10-21: "cineteatro") and
  an excerpt with a line of detail ("Jovens pianistas"); the titles stay
  generic.
- **Feeds** (Nazaré, Batalha, Chamusca): `pubDate` is the start. Their `rss` addresses are
  the platform's `/pages/<path>.rss`. If one stops answering, the agenda page is
  the fallback to read as text.

# Not reachable

Sites tried on 2026-10-20 and not added. Municipality means the town the site
serves; the regional and national rows are there because they would have
covered several.

| Municipality | Site | Reason |
|---|---|---|
| Azambuja | cm-azambuja.pt agendas culturais | 404; the agendas are PDFs |
| Golegã | visitgolega.com/agenda | built by script, nothing to read |
| Alpiarça | cm-alpiarca.pt | the agenda is a news post whose address changes |
| Salvaterra de Magos | cm-salvaterrademagos.pt | the home page links an agenda news post whose address changes, the same pattern as Alpiarça |
| Tomar | none | out of range (about 55 minutes, `towns.md`); no source |
| Médio Tejo (region) | agenda.mediotejo.pt | built by script, empty to a plain request |
| Rio Maior, Santarém, Caldas da Rainha, Óbidos, Alcobaça, Torres Novas, Cartaxo, Porto de Mós, Bombarral | Viral Agenda (viralagenda.com), nine municipality pages | refuses Python's HTTP client with a 403 whatever the User-Agent (an honest one included), though curl and browsers are answered and its robots.txt allows Claude-User with a 15 s crawl delay; not routed around. It would add nightlife and private venues (clubs, a bar, galleries, a theatre), guided walks and municipal events past the first page of a town's own list: about 22 events over two to three weeks on 2026-10-20 |
| Santarém (regional) | O Mirante | HTTP 500 |
| National | Ticketline | no connection |
| Rio Maior | riomaiortv.pt | no connection |
| Rio Maior | Região de Rio Maior | stale since 2019 |
| Alentejo | Visit Alentejo | built by script |
| National | GoTrail, Running.life | 403 to this script |
| National | Racefinder | its robots.txt asks automated visitors off the listing by area |
| Any | Facebook, Instagram | need a login |
| Torres Vedras | theatre and cinema categories of the municipal agenda | not fetched |

Alpiarça and Salvaterra de Magos have an agenda and only a stable address is
missing; they are the most likely to be worth a manual re-check. Golegã and the Médio Tejo agenda would
need a browser.

# Why

- **Every municipality within about 45 minutes that a plain GET can read.** The
  skill is for a person in Rio Maior; a town an hour away is out, and a source
  that needs a browser or a login is out, because the collector does not do
  either ([where it bends](rio-maior-events.md#it-is-not-a-pure-payload-and-where-it-bends)).
- **Own site before an aggregator.** A municipality's own listing is the
  primary, even when thin. Viral Agenda, the one community aggregator tried,
  refuses scripts ([Not reachable](#not-reachable)).
- **A source per page, no pagination.** Following page 2 would double the
  requests for a few more events and a politeness cost; the model is told which
  sources are cut at the first page.
- **One race calendar.** Race calendars list the same races, so the skill reads
  one. Portugal Running won: it lists road races, trails and walks months ahead
  with each race's town, and lets a script in. GoTrail and Running.life answer
  the script with a 403; Racefinder's only listing by area is a filter its
  robots.txt asks automated visitors not to use.
- No municipal app or digital street screens were found online.
