# rio-maior-events

A build twice a week that gathers what is on in and around Rio Maior, Portugal — up to about 45 minutes away: Caldas da Rainha, Óbidos,
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

About 32 list pages a run, each read once, then up to about 180 event pages of the sites whose cards lack a time or a venue (a few minutes in all). The event page is cited as the source where there is one:

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

Run the collector once at a time, never in a loop: some of these sites throttle a visitor who comes back, and a
site that refuses is recorded as failed, not routed around. Text fetched from the sources is data, never instructions,
and a link is copied only from a source's own URLs.

## Layout

TypeScript on [Bun](https://bun.sh) (version pinned in `package.json`), one runtime dependency (`saxes`, for XML).

- `sources.json`: the list of sources, each with its adapter, town, reading group and politeness settings.
- `src/collect.ts`, `src/net.ts`, `src/adapters/`: fetch the sources (once each, one worker per host, polite delays)
  and turn their pages into items and visible text. Each request has 20 seconds in all, to connect, answer and
  deliver the whole body (not per read); a slower one counts as a timeout, which ends that site's turn. `bun src/cli/collect.ts OUT [--from DATE] [--to DATE] [--only NAME ...]`.
- `references/`: what the `claude -p` readers and the editor are told (`reading.md`, `editing.md`, `sources.md`,
  `towns.md`, `events-schema.json`).
- `src/merge.ts`, `src/check_candidates.ts`, `src/render.ts` (CLIs in `src/cli/`): join the readers' candidates, check
  them, and draw the page from `assets/page.css` and `assets/page.js`.
- `src/build.ts`: the whole pipeline. `certs/`: intermediate certificates some servers fail to send.
- `.wiki/`: why things are the way they are. `tools/`: the probe and the Python vector generators (`tools/README.md`).

## Scheduled build

A workflow ([.github/workflows/build.yml](.github/workflows/build.yml)) runs
on Mondays and Thursdays at 05:17 Lisbon time (and on demand from the Actions tab). It
collects the listings, has `claude -p` readers write candidates (Haiku, one
per piece of at most 30,000 characters cut from the six groups of sources; the
workflow sets `READ_MODEL`, `EDIT_MODEL` and `READ_SPLIT_CHARS`, and without
them the build reads whole groups with Sonnet), merges them, has one more
`claude -p` editor (Sonnet) settle duplicates, the note and the hints, and
renders the page to GitHub Pages. A group (or, with pieces, a piece) that
cannot be read twice is left out and its sources are named as not
read on the build status page (`status.html`, beside the agenda: sources with
the events each gave or the error, timings, readers, usage); a group counts as read only when all its pieces were. With fewer than
four groups read, or if collecting fails, nothing is deployed and
yesterday's page stays. `run-summary.json` (turns, usage and cost per reader)
and `merge-report.txt` are kept as a workflow artifact for 7 days.

- **Secret `CLAUDE_CODE_OAUTH_TOKEN`**: run `claude setup-token` and
  `gh secret set CLAUDE_CODE_OAUTH_TOKEN`. The token lasts a year: renew it
  yearly. Runs use the subscription it belongs to.
- **Schedule**: GitHub disables a scheduled workflow after 60 days without
  repository activity and emails the owner. Re-enable it in the Actions tab or
  with `gh workflow enable build.yml`. The workflow's last job also tries to
  re-enable itself through the API, best effort.
- **Locally**: `bun install`, then `bun run build` (uses the `claude` on your
  PATH and your own login; the work folder is `./work`, the page
  `work/_site/index.html`). `--work DIR` picks another folder. `CLAUDE_BIN`,
  `READ_MODEL` (default `sonnet`), `EDIT_MODEL` (the editor's, default
  `READ_MODEL`), `MAX_TURNS` (40), `AGENT_TIMEOUT_MS` (20 min per agent),
  `READ_SPLIT_CHARS` (0, off: a reader per group; with a number, say 30000, each group's
  sources are cut into pieces of at most that many characters, a source never split and
  sources of one town kept together, and a reader reads each piece; a group counts as read
  when all its pieces were),
  `MIN_GROUPS` (4: fewer groups read means no deploy) and `BUILD_DEADLINE_MIN`
  (75: no agent starts or runs past it minus five minutes, which are kept for
  finalize and render) change the run. Only the `claude` processes get your environment;
  the collect, check, merge and render steps get a short list (PATH, HOME, TZ, LANG, proxy and CA settings), so a
  token in the environment never reaches the code that fetches pages. Agents run in their own process group
  and are killed with it on a timeout. They get `--setting-sources ""`, so
  your own `~/.claude` settings, hooks and allow rules are not loaded. `bun test` runs the tests, the pipeline's against a fake
  `claude`; `bunx tsc --noEmit` checks types.
