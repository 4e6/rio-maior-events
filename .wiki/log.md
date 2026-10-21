# Wiki Update Log

## 2026-10-21
* **Twice a week**: the build runs on Mondays and Thursdays at 05:17 Lisbon time instead of every morning; the workflow is now `build.yml` ([architecture](/architecture/rio-maior-events.md)).
* **Build status page**: the sources list moved from the bottom of the agenda to `status.html`, built by `src/status.ts` with timings, readers, usage and event counts ([architecture](/architecture/rio-maior-events.md)).
* **Initialization**: the project moved out of the repository it began in into its own, and was ported from Python scripts to TypeScript on Bun, run daily by a GitHub Actions workflow. The wiki came with it as [the architecture pages](/architecture/rio-maior-events.md), now pinned, plus [the one-commit rule](/conventions/a-change-and-its-wiki-are-one-commit.md) and two decisions: [runners and refusals](/decisions/0001-sources-must-answer-a-github-runner.md) and [Haiku readers](/decisions/0003-haiku-readers-and-a-sonnet-editor.md).
