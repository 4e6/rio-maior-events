import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const FAKE = join(import.meta.dir, "fake-claude.ts");
const COLLECTED = join(import.meta.dir, "fixtures", "collected");
const GROUPS = ["rio-maior", "oeste-norte", "oeste-sul", "ribatejo", "medio-tejo", "regional"];
setDefaultTimeout(60_000);
const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

type Plan = { readers?: Record<string, string>; editor?: string };

type Opts = { env?: Record<string, string>; deadAfter?: string[]; collect?: string };

/** Run build.ts against the fixture. deadAfter lists groups whose sources all failed in the index. */
async function build(plan: Plan = {}, opts: Opts = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "rme-"));
  dirs.push(tmp);
  const log = join(tmp, "calls.jsonl");
  const planFile = join(tmp, "plan.json");
  writeFileSync(planFile, JSON.stringify({ ...plan, log }));
  const work = join(tmp, "work");
  let collected = COLLECTED;
  if (opts.deadAfter) {
    collected = join(tmp, "collected");
    cpSync(COLLECTED, collected, { recursive: true });
    const index = JSON.parse(readFileSync(join(collected, "index.json"), "utf8"));
    for (const s of index.sources) if (opts.deadAfter.includes(s.group)) { s.ok = false; s.error = "refused"; }
    writeFileSync(join(collected, "index.json"), JSON.stringify(index));
  }
  const source = opts.collect ? [] : ["--collected", collected];
  const started = Date.now();
  const proc = Bun.spawn(["bun", join(ROOT, "src", "build.ts"), "--work", work, ...source], {
    cwd: ROOT, stdout: "pipe", stderr: "pipe",
    env: {
      ...process.env, CLAUDE_BIN: FAKE, FAKE_PLAN: planFile, READ_MODEL: "opus", MAX_TURNS: "7",
      ...(opts.collect ? { COLLECT_SCRIPT: join(import.meta.dir, "fixtures", opts.collect) } : {}), ...opts.env,
    },
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  const calls: any[] = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const page = join(work, "_site", "index.html");
  const summary = existsSync(join(work, "run-summary.json")) ? JSON.parse(readFileSync(join(work, "run-summary.json"), "utf8")) : null;
  const seconds = (Date.now() - started) / 1000;
  return { seconds, code, stdout, stderr, calls, work, summary, html: existsSync(page) ? readFileSync(page, "utf8") : null };
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
      "--disallowedTools", "mcp__*", "--strict-mcp-config", "--setting-sources", "",
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

  test("an editor file that parses but cannot be finalized falls back to the merge output", async () => {
    const r = await build({ editor: "unfixable" });
    expect(r.code).toBe(0);
    expect(r.html).toContain("Concerto rio-maior");
    expect(r.html).toContain("put together automatically");
    expect(r.stderr).toContain("falling back");
  });

  test("a group with no readable source gets no reader and does not count", async () => {
    const r = await build({}, { deadAfter: ["regional", "ribatejo"] });
    expect(r.code).toBe(0);
    expect(forGroup(r.calls, "regional")).toHaveLength(0);
    expect(forGroup(r.calls, "ribatejo")).toHaveLength(0);
    expect(r.summary.groups_failed.sort()).toEqual(["regional", "ribatejo"]);
    expect(r.html).not.toContain("Concerto regional");
  });

  test("three groups with nothing to read means no page", async () => {
    const r = await build({}, { deadAfter: ["regional", "ribatejo", "oeste-sul"] });
    expect(r.code).toBe(1);
    expect(r.html).toBeNull();
    expect(r.summary.readers.filter((x: any) => x.attempt === 0)).toHaveLength(3);
  });

  test("collect failing without an index stops the build", async () => {
    const r = await build({}, { collect: "collect-fail.ts" });
    expect(r.code).toBe(1);
    expect(r.html).toBeNull();
    expect(r.calls).toHaveLength(0);
  });

  test("collect failing after writing an index carries on", async () => {
    const r = await build({}, { collect: "collect-partial.ts" });
    expect(r.code).toBe(0);
    expect(r.html).toContain("Concerto rio-maior");
  });

  describe("hung agents", () => {
    const quick = { AGENT_TIMEOUT_MS: "1500", KILL_GRACE_MS: "500" };

    test("a hanging reader is killed on time and retried once", async () => {
      const r = await build({ readers: { ribatejo: "hang" } }, { env: quick });
      expect(r.code).toBe(0);
      expect(forGroup(r.calls, "ribatejo")).toHaveLength(2);
      const attempts = r.summary.readers.filter((x: any) => x.group === "ribatejo");
      expect(attempts.map((x: any) => x.reason)).toEqual(["timeout", "timeout"]);
      expect(r.summary.groups_failed).toEqual(["ribatejo"]);
      expect(r.seconds).toBeLessThan(15);
    });

    test("a reader that ignores SIGTERM is killed after the grace period", async () => {
      const r = await build({ readers: { ribatejo: "hang-term" } }, { env: quick });
      expect(r.code).toBe(0);
      expect(r.summary.groups_failed).toEqual(["ribatejo"]);
      expect(r.seconds).toBeLessThan(15);
    });

    test("a child holding the pipes cannot stall the build", async () => {
      const r = await build({ readers: { ribatejo: "hang-child" } }, { env: quick });
      expect(r.code).toBe(0);
      const attempts = r.summary.readers.filter((x: any) => x.group === "ribatejo");
      expect(attempts.every((x: any) => x.duration_s < 10)).toBe(true);
      expect(r.seconds).toBeLessThan(15);
    });

    test("a hanging editor does not keep the page from being built", async () => {
      const r = await build({ editor: "hang" }, { env: quick });
      expect(r.code).toBe(0);
      expect(r.html).toContain("put together automatically");
      expect(r.summary.editor[0].reason).toBe("timeout");
    });

    test("the whole build stays under its deadline", async () => {
      // 12 s in all, 3 s kept back: the editor gets what is left (about 8 s), not its 60 s.
      const env = { AGENT_TIMEOUT_MS: "60000", BUILD_DEADLINE_MIN: "0.2", DEADLINE_MARGIN_MIN: "0.05", KILL_GRACE_MS: "300" };
      const r = await build({ editor: "hang" }, { env });
      expect(r.code).toBe(0);
      expect(r.html).not.toBeNull();
      expect(r.summary.editor[0].duration_s).toBeLessThan(10);
      expect(r.seconds).toBeLessThan(20);
    });

    test("with no time left the editor does not start", async () => {
      const env = { BUILD_DEADLINE_MIN: "0.05", DEADLINE_MARGIN_MIN: "0.05" };
      const r = await build({}, { env });
      expect(r.code).toBe(1); // no reader had time either, so the gate holds
      expect(r.calls).toHaveLength(0);
    });
  });
});
