import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const FAKE = join(import.meta.dir, "fake-claude.ts");
const COLLECTED = join(import.meta.dir, "fixtures", "collected");
const GROUPS = ["rio-maior", "oeste-norte", "oeste-sul", "ribatejo", "medio-tejo", "regional"];
const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

type Plan = { readers?: Record<string, string>; editor?: string };

async function build(plan: Plan = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "rme-"));
  dirs.push(tmp);
  const log = join(tmp, "calls.jsonl");
  const planFile = join(tmp, "plan.json");
  writeFileSync(planFile, JSON.stringify({ ...plan, log }));
  const work = join(tmp, "work");
  const proc = Bun.spawn(["bun", join(ROOT, "src", "build.ts"), "--work", work, "--collected", COLLECTED], {
    cwd: ROOT, stdout: "pipe", stderr: "pipe",
    env: { ...process.env, CLAUDE_BIN: FAKE, FAKE_PLAN: planFile, READ_MODEL: "opus", MAX_TURNS: "7" },
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  const calls: any[] = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const page = join(work, "_site", "index.html");
  const summary = existsSync(join(work, "run-summary.json")) ? JSON.parse(readFileSync(join(work, "run-summary.json"), "utf8")) : null;
  return { code, stdout, stderr, calls, work, summary, html: existsSync(page) ? readFileSync(page, "utf8") : null };
}

const forGroup = (calls: any[], g: string) => calls.filter((c) => c.role === g);

describe("daily build", () => {
  test("all good: six readers, an editor, a page", async () => {
    const r = await build();
    expect(r.code).toBe(0);
    expect(r.html).toContain("Concerto rio-maior");
    expect(r.html).toContain("Edited by the fake editor.");
    expect(r.summary.groups_read).toEqual(GROUPS);
    expect(r.summary.readers).toHaveLength(6);
    expect(r.summary.readers[0].num_turns).toBe(3);
    expect(r.summary.readers[0].total_cost_usd).toBe(0.01);
    expect(existsSync(join(r.work, "merge-report.txt"))).toBe(true);
    expect(r.calls.filter((c) => c.role === "editor")).toHaveLength(1);
  });

  test("claude gets exactly the confinement flags", async () => {
    const r = await build();
    const call = forGroup(r.calls, "oeste-sul")[0];
    expect(call.argv).toEqual([
      "-p", "--tools", "Read,Write,Edit",
      "--allowedTools", "Edit(./rio-maior-candidates/oeste-sul.json)",
      "--permission-mode", "dontAsk", "--permission-prompts", "none",
      "--disallowedTools", "mcp__*", "--strict-mcp-config",
      "--max-turns", "7", "--model", "opus", "--output-format", "json",
    ]);
    expect(call.argv).not.toContain("--bare");
    expect(call.cwd).toEndWith("/work");
    for (const path of ["reading.md", "sources.md", "towns.md", "events-schema.json", "rio-maior-collected/oeste-sul.json", "rio-maior-candidates/oeste-sul.json"]) {
      expect(call.prompt).toContain(`${r.work}/`);
      expect(call.prompt).toContain(path);
    }
    expect(call.prompt).toContain("2026-10-20 to 2026-11-15");
    const editor = r.calls.find((c) => c.role === "editor");
    expect(editor.argv).toContain("Edit(./rio-maior-events.json)");
    expect(editor.prompt).toContain("editing.md");
    expect(editor.prompt).toContain("merge-report.txt");
  });

  test("a group that fails twice is retried once and named not read", async () => {
    const r = await build({ readers: { ribatejo: "fail" } });
    expect(r.code).toBe(0);
    expect(forGroup(r.calls, "ribatejo")).toHaveLength(2);
    expect(r.summary.groups_failed).toEqual(["ribatejo"]);
    expect(r.html).toContain("Concerto rio-maior");
    expect(r.html).not.toContain("Concerto ribatejo");
    expect(readFileSync(join(r.work, "merge-report.txt"), "utf8")).toContain("missing group: ribatejo");
    expect(r.html).toContain("not read");
  });

  test("permission denials and invalid files count as failures", async () => {
    const r = await build({ readers: { regional: "denied", "medio-tejo": "garbage" } });
    expect(r.code).toBe(0);
    expect(r.summary.groups_failed.sort()).toEqual(["medio-tejo", "regional"]);
    expect(r.summary.readers.find((x: any) => x.group === "regional").reason).toContain("permission denials");
  });

  test("a retry starts without the stale file", async () => {
    const r = await build({ readers: { "oeste-norte": "once-garbage" } });
    const calls = forGroup(r.calls, "oeste-norte");
    expect(calls).toHaveLength(2);
    expect(calls[1].existed).toBe(false);
    expect(r.summary.groups_read).toContain("oeste-norte");
    expect(r.html).toContain("Concerto oeste-norte");
  });

  test("three of six failing means no page and exit 1", async () => {
    const r = await build({ readers: { ribatejo: "fail", regional: "fail", "oeste-sul": "fail" } });
    expect(r.code).toBe(1);
    expect(r.html).toBeNull();
    expect(r.calls.some((c) => c.role === "editor")).toBe(false);
    expect(r.summary.result).toContain("3 of 6");
  });

  test("two of six failing still builds", async () => {
    const r = await build({ readers: { ribatejo: "fail", regional: "fail" } });
    expect(r.code).toBe(0);
  });

  test("editor failing still yields a page through finalize", async () => {
    const r = await build({ editor: "fail" });
    expect(r.code).toBe(0);
    expect(r.html).toContain("put together automatically");
    expect(r.html).toContain("Concerto rio-maior");
  });

  test("editor leaving broken JSON falls back to the merge output", async () => {
    const r = await build({ editor: "corrupt" });
    expect(r.code).toBe(0);
    expect(r.html).toContain("put together automatically");
  });

  test("render problems after the editor get a second round with render's output", async () => {
    const r = await build({ editor: "badthenfix" });
    expect(r.code).toBe(0);
    const rounds = r.calls.filter((c) => c.role === "editor");
    expect(rounds).toHaveLength(2);
    expect(rounds[1].prompt).toContain("category must be one of");
    expect(r.html).not.toContain("Broken");
  });
});
