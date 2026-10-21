# This directory is an OKF knowledge bundle

Durable knowledge about this project: why things are the way they are, what must
hold, and what bites people. A reason goes in the `# Why` section of the page it
explains; a `Decision` page is for a fork between alternatives that no single page
owns, and the user says yes to it first. **Not** documentation of the code.

**Invoke the `llm-wiki` skill before writing or editing anything here.** It
carries the frontmatter contract, the concept types, the half-life rule and the
index and lint steps.

Reading needs no skill. Start at `index.md` and drill down. If a page contradicts
the code, reality wins.

- `index.md` and `log.md` are reserved names, and `CLAUDE.md`, `CLAUDE.local.md`
  and `AGENTS.md` are instructions. Every other `.md` here is a concept and needs
  a `type`.
- Every edit is followed by `okf.py index --write` and `okf.py lint`. That script
  ships with the `llm-wiki` skill.
- A wiki change lands in the same commit as the change it describes.
