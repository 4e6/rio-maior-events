# rio-maior-events

An [Agent Skill](https://agentskills.io) that gathers what is on in and around
Rio Maior, Portugal — up to about 45 minutes away: Caldas da Rainha, Óbidos,
Santarém, Alcobaça, Porto de Mós and the villages of the Serra dos Candeeiros —
and lays it out as one page you can plan your free time from.

## What you get

- **An agenda list** grouped into This week, This weekend, Next week and Later,
  each event with its time, town, drive time from Rio Maior, price where known,
  and a link to where it was listed. Titles are in English with the Portuguese
  original beneath, so you can match them to posters and tickets.
- **A month calendar** beside it (a day strip on a phone) with a dot for each
  event; tap a day to jump the list to it.
- **Exhibitions and other long runs** in their own section rather than on every
  day, and **weekly markets** under Regulars.
- **Filters** by category, distance (≤20 min, ≤45 min), free, weekend (Friday to Sunday), and a
  search box.
- **Your picks**: star events and they stay starred when the page is made again;
  events new since your last visit are marked.
- **Add to calendar**: an .ics file for any event.
- **"Check source"** on anything the sources disagree on or that looks stale.

The page is one self-contained HTML file, light and dark, with nothing fetched
when it opens.

## Where the events come from

About 33 list pages a run, each read once, then up to about 180 event pages of the sites whose cards lack a time or a venue (a few minutes in all). The event page is cited as the source where there is one:

- **Municipal agendas** of Rio Maior, Santarém, Caldas da Rainha, Torres Novas,
  Cartaxo, Torres Vedras, Alcobaça, Óbidos, Porto de Mós, Alcanena,
  Entroncamento, Vila Nova da Barquinha, Almeirim, Batalha, Nazaré, Peniche,
  Chamusca, Ourém, Cadaval, Bombarral, Lourinhã and Alenquer, and Leiria's
  agenda site, and Santarém's culture programme.
- **Theatres and cinemas**: the Cineteatro de Rio Maior, Teatro Virgínia
  (Torres Novas), Teatro-Cine (Torres Vedras), Cine-Teatro de Alcobaça and the
  Centro Cultural e de Congressos in Caldas da Rainha.
- **The race calendar** of Portugal Running, for road races and trails.

Gaps: Facebook and Instagram are not read, and the Cineteatro now announces
mostly there. Azambuja, Alpiarça, Salvaterra de Magos, Golegã and Tomar have no
source. Only the first page of a long list is read (Lourinhã and Alenquer have a
second page; Leiria's list runs to 128). No municipal app or digital street
screens were found online.

Most agendas list only the next few weeks, so weeks further ahead rest on fewer
sources, and the page says so at the top.

## Requirements

Web access. Python 3.9 or newer makes the full page; without it you get the
events as a list in the reply.

## Usage

Ask, for example:

- "What's on around Rio Maior?"
- "Anything for the kids this weekend near Rio Maior?"
- "Concerts in Caldas or Santarém in November?"

Ask again any time to refresh it; your starred events stay where you opened the
page before.
