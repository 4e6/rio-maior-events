# Wiki Update Log

## 2026-10-22
* **ops-watch, round two**: ops-watch also counts down the `4e6.github.io` certificate (`rme-tls`) and reads `build.yml` runs on `main` only; moving the page off GitHub Pages means re-pointing its three page checks ([architecture](/architecture/rio-maior-events.md)).
* **Credentials and monitoring**: the Claude token's rotation and what ops-watch checks on this project (token age, build, page, `status.json`), including the link between the 192-hour overdue threshold and the cron in `build.yml` ([architecture](/architecture/rio-maior-events.md)).

## 2026-10-21
* **Once a week**: the build runs on Mondays only at 05:17 Lisbon time, at the user's request ([architecture](/architecture/rio-maior-events.md)).
* **Proxy fallback**: sites that refuse a direct request are read through a residential proxy in CI (`FALLBACK_PROXY_URL`), as in [the decision](/decisions/0004-a-residential-proxy-for-the-sites-that-refuse-github-runners.md) and [the architecture](/architecture/rio-maior-events.md); collect became a workflow step of its own so the secret stays out of the process that runs claude.
* **Decision removed**: "a source must answer a GitHub runner, and a refusal is not routed around" is withdrawn by the user, ahead of a proxy fallback for the sites that refuse GitHub's runners.
* **Twice a week**: the build runs on Mondays and Thursdays at 05:17 Lisbon time instead of every morning; the workflow is now `build.yml` ([architecture](/architecture/rio-maior-events.md)).
* **Build status page**: the sources list moved from the bottom of the agenda to `status.html`, built by `src/status.ts` with timings, readers, usage and event counts ([architecture](/architecture/rio-maior-events.md)).
* **Initialization**: the project moved out of the repository it began in into its own, and was ported from Python scripts to TypeScript on Bun, run daily by a GitHub Actions workflow. The wiki came with it as [the architecture pages](/architecture/rio-maior-events.md), now pinned, plus [the one-commit rule](/conventions/a-change-and-its-wiki-are-one-commit.md) and two decisions: runners and refusals (removed later the same day) and [Haiku readers](/decisions/0003-haiku-readers-and-a-sonnet-editor.md).
