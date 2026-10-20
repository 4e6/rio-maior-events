---
type: Module
title: Rio Maior events, the sources
description: "The maintainer's view of each source the rio-maior-events collector reads: when and how it was checked, what to look at by hand, what breaks it, why it was chosen over its alternatives, and the sites that could not be read, by municipality."
tags: [architecture, skill, network]
sources:
  - resource: skills/rio-maior-events/scripts/collect.py
  - resource: skills/rio-maior-events/references/sources.md
sources_digest: 7edc135a97c2c9a4
---

# What this page is for

[The skill's page](rio-maior-events.md) says why a script collects and the model
reads. This page is for the person who keeps the list: which sources there are,
how each was verified, how to check one by hand when a run reports it failed,
and why a source was taken over its alternatives. **Addresses, layouts and date
formats are not here**: they are in `references/sources.md`, which the model
reads at run time, and in `collect.py`. A source added or dropped changes both
and this page.

# How everything was verified

On 2026-10-20, one plain GET per page (and `robots.txt` once per host), the
visible text read by eye. The two JSON sources and the three Next.js sites were
decoded offline from the saved responses, not run through `collect.py`. Drive
times in `towns.md` are estimates. A source is only as checked as that: a layout
that changed since is the usual reason a run reports one failed or empty.

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
- **Viral Agenda.** Community cards for nine municipalities. It stopped
  answering this machine after about four full development passes in an hour,
  so a refusal there is expected after repeated runs, not a layout change.
  Alcobaça, Óbidos and Porto de Mós are now also read from their own sites;
  Viral Agenda stays for the rest.
- **Portugal Running.** The one race calendar ([why](#why)). Breaks if the site starts
  refusing scripts, as GoTrail and Running.life did.
- **Joomla agendas (Alcanena, Entroncamento, Vila Nova da Barquinha).** One
  template, so one change breaks three. Entroncamento asks for a crawl delay of
  3; the collector reads one page of it. The lists open with events that have
  already begun, so the coming ones are further down the page than the top.
- **Theatres and cinemas (Torres Novas, Torres Vedras, Alcobaça, Caldas da
  Rainha).** Small pages, each one venue. The Caldas da Rainha centre's home
  page is the thinnest: titles with dates only on some, so an empty read is
  plausible and not a failure. Breaks when a venue moves to a ticketing service
  or hides the programme behind a script.
- **Torres Vedras music category.** Chosen over the municipality's `/agenda/`:
  that listing has 56 pages and its first page held two days of workshops. The
  music category is the part with concerts. The municipality's theatre and
  cinema categories were not fetched; the theatre's own page covers them.
- **Leiria.** First page of 128 only. The agenda's own site is separate from the
  municipality's; the municipal site was not used. Breaks if the list is
  loaded by script after the first page, which is why only page 1 is claimed.
- **Alcobaça home page.** Chosen over the municipality's agenda page, which is
  built by script and gives nothing to a plain request. The home page's agenda
  block is a fixed nine; the Cine-Teatro's own page covers its films.
- **Óbidos.** The agenda site (a separate address from the municipality's) was
  chosen over the municipality's own `/agenda` page. Few dated events;
  mostly permanent workshops.
- **Porto de Mós home page.** Chosen over the agenda page the site links to,
  which holds a 2020 listing. Breaks when the home page's agenda block moves.
- **Almeirim, Batalha, Nazaré, Peniche, Chamusca.** Municipal listings, one page
  each. Almeirim's list continues on a second page, Chamusca's behind a load-more
  button, Leiria's behind pagination: none is followed, by decision (one page
  per source). Peniche's page carries leftover markup, so its text is capped
  low and filtered. Nazaré is thin: titles such as "CINEMA" say little.
- **JSON sources (Ourém, Cadaval).** Ourém is a standard events plugin's API,
  steady. Cadaval's host name contains "stage" and may move; the
  town's own site would then show the new host in its scripts. Cadaval's event link,
  `https://www.cm-cadaval.pt/<id>/<slug>`, was inferred from a route of the
  site and answered 200 in the live run of 2026-10-20. Both are decoded by field, so a renamed field breaks them quietly: a
  run that reports zero items from either is worth a look.
- **Next.js sites (Bombarral, Lourinhã, Alenquer).** The events come from data
  embedded in the page, not from its visible text, which is empty. The decoding
  depends on the framework's embedding format and the name of the list inside
  it; a framework change breaks all three at once. Page 1 only, nine events:
  Lourinhã and Alenquer have a second page that is not read.
- **Supplementary agendas and Eventbrite.** As before: plain text, expect gaps.

# Not reachable

Sites tried on 2026-10-20 and not added. Municipality means the town the site
serves; the regional and national rows are there because they would have
covered several.

| Municipality | Site | Reason |
|---|---|---|
| Azambuja | cm-azambuja.pt agendas culturais | 404; the agendas are PDFs |
| Golegã | visitgolega.com/agenda | built by script, nothing to read |
| Alpiarça | cm-alpiarca.pt | the agenda is a news post whose address changes |
| Salvaterra de Magos | cm-salvaterrademagos.pt | not examined |
| Médio Tejo (region) | agenda.mediotejo.pt | built by script, empty to a plain request |
| Regional | Viral Agenda, other municipality pages | refusing this machine; slugs unverified |
| Santarém (regional) | O Mirante | HTTP 500 |
| National | Ticketline | no connection |
| Rio Maior | riomaiortv.pt | no connection |
| Rio Maior | Região de Rio Maior | stale since 2019 |
| Alentejo | Visit Alentejo | built by script |
| National | GoTrail, Running.life | 403 to this script |
| National | Racefinder | its robots.txt asks automated visitors off the listing by area |
| Any | Facebook, Instagram | need a login |
| Torres Vedras | theatre and cinema categories of the municipal agenda | not fetched |

Alpiarça has an agenda and only a stable address is missing; it is the most
likely to be worth a manual re-check. Golegã and the Médio Tejo agenda would
need a browser.

# Why

- **Every municipality within about 45 minutes that a plain GET can read.** The
  skill is for a person in Rio Maior; a town an hour away is out, and a source
  that needs a browser or a login is out, because the collector does not do
  either ([where it bends](rio-maior-events.md#it-is-not-a-pure-payload-and-where-it-bends)).
- **Own site before an aggregator.** Viral Agenda is one community's view and
  refuses repeated runs; a municipality's own listing is the primary, even when
  thin.
- **A source per page, no pagination.** Following page 2 would double the
  requests for a few more events and a politeness cost; the model is told which
  sources are cut at the first page.
- **One race calendar.** Race calendars list the same races, so the skill reads
  one. Portugal Running won: it lists road races, trails and walks months ahead
  with each race's town, and lets a script in. GoTrail and Running.life answer
  the script with a 403; Racefinder's only listing by area is a filter its
  robots.txt asks automated visitors not to use.
- **Viral Agenda's municipality pages, not its district pages.** A district page
  runs to towns over an hour away and a text cap cuts it after a few days; a
  municipality page is 3-5k characters and about two weeks.
- No municipal app or digital street screens were found online.
