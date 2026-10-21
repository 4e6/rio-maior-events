// The unattended daily build: collect, read (six `claude -p` readers), merge,
// edit (one more `claude -p`), finalize, render. Writes <work>/_site/index.html.
//
//   bun src/build.ts [--work DIR] [--collected DIR]
//
// --collected skips the collect step and uses that folder (tests, reruns).
// Environment: CLAUDE_BIN (default claude), PYTHON (python3), READ_MODEL (opus),
// EDIT_MODEL (READ_MODEL), MAX_TURNS (40), AGENT_TIMEOUT_MS (20 min), MIN_GROUPS (4),
// BUILD_DEADLINE_MIN (75: no agent runs past it minus DEADLINE_MARGIN_MIN, default 5,
// kept for finalize and render), KILL_GRACE_MS (10000), COLLECT_SCRIPT (scripts/collect.py).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const env = process.env;
const CLAUDE = env.CLAUDE_BIN || "claude";
const PYTHON = env.PYTHON || "python3";
const READ_MODEL = env.READ_MODEL || "opus";
const EDIT_MODEL = env.EDIT_MODEL || READ_MODEL;
const MAX_TURNS = env.MAX_TURNS || "40";
const TIMEOUT_MS = Number(env.AGENT_TIMEOUT_MS || 20 * 60 * 1000);
const MIN_GROUPS = Number(env.MIN_GROUPS || 4);
const STARTED = Date.now();
const DEADLINE = STARTED + Number(env.BUILD_DEADLINE_MIN || 75) * 60_000;
const MARGIN_MS = Number(env.DEADLINE_MARGIN_MIN || 5) * 60_000;
const GRACE_MS = Number(env.KILL_GRACE_MS || 10_000);
const COLLECT_SCRIPT = env.COLLECT_SCRIPT || join(ROOT, "scripts", "collect.py");
const ATTEMPTS = 2;
const EDIT_ROUNDS = 2;

type Json = Record<string, any>;
type Run = { ok: boolean; reason: string; log: Json };
const summary: { started: string; readers: Json[]; editor: Json[]; groups_read: string[]; groups_failed: string[]; result: string } = {
  started: new Date().toISOString(), readers: [], editor: [], groups_read: [], groups_failed: [], result: "",
};

function parseArgs(argv: string[]) {
  const out = { work: join(env.RUNNER_TEMP || ".", "work"), collected: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--work") out.work = argv[++i] ?? "";
    else if (argv[i] === "--collected") out.collected = argv[++i] ?? "";
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return { work: resolve(out.work), collected: out.collected ? resolve(out.collected) : "" };
}

/** Run a command; stdout and stderr to the console unless `capture`. Returns exit code and stdout. */
async function run(cmd: string[], opts: { cwd?: string; capture?: boolean } = {}) {
  const proc = Bun.spawn(cmd, { cwd: opts.cwd, stdout: opts.capture ? "pipe" : "inherit", stderr: opts.capture ? "pipe" : "inherit" });
  const [stdout, stderr] = opts.capture
    ? await Promise.all([new Response(proc.stdout as ReadableStream).text(), new Response(proc.stderr as ReadableStream).text()])
    : ["", ""];
  return { code: await proc.exited, stdout, stderr };
}

const py = (script: string, ...args: string[]) => run([PYTHON, join(ROOT, "scripts", script), ...args], { capture: true });

// --- the one place that runs claude -------------------------------------------------

/** argv for a confined `claude -p`: file tools only, one file it may edit, no prompts, no MCP. */
export function claudeArgs(editable: string, model: string): string[] {
  return [
    "-p",
    "--tools", "Read,Write,Edit",
    "--allowedTools", `Edit(${editable})`,
    "--permission-mode", "dontAsk",
    "--permission-prompts", "none",
    "--disallowedTools", "mcp__*",
    "--strict-mcp-config",
    "--setting-sources", "",
    "--max-turns", MAX_TURNS,
    "--model", model,
    "--output-format", "json",
  ];
}

/** Time an agent may still take: its own limit, or what is left before the deadline minus the margin. */
function budgetMs(): number {
  return Math.min(TIMEOUT_MS, DEADLINE - Date.now() - MARGIN_MS);
}

const running = new Set<number>();
/** Signal a whole process group (claude and anything it started). */
function killGroup(pid: number, signal: NodeJS.Signals) {
  try { process.kill(-pid, signal); } catch { /* already gone */ }
}
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { for (const pid of running) killGroup(pid, "SIGKILL"); process.exit(1); });
}

/** Read a stream to the end, or give up with what is missing when `giveUp` settles. */
async function drain(stream: ReadableStream, giveUp: Promise<string>): Promise<string> {
  return Promise.race([new Response(stream).text().catch(() => ""), giveUp]);
}

/**
 * Run claude in `cwd` with the prompt on stdin, in its own process group so a timeout can kill
 * everything it started (SIGTERM, then SIGKILL after a grace period; reads are abandoned then too).
 * ok means exit 0, a successful result and no permission denials.
 */
async function runClaude(label: string, cwd: string, editable: string, model: string, prompt: string): Promise<Run> {
  const started = Date.now();
  const log: Json = { label };
  const budget = budgetMs();
  let reason = "";
  if (budget <= 0) {
    log.reason = reason = "no time left";
    console.log(JSON.stringify(log));
    return { ok: false, reason, log };
  }
  try {
    const proc = Bun.spawn([CLAUDE, ...claudeArgs(editable, model)], {
      cwd, stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe", env, detached: true,
    });
    running.add(proc.pid);
    let giveUp!: (v: string) => void;
    const abandoned = new Promise<string>((resolve) => { giveUp = resolve; });
    const timer = setTimeout(() => {
      reason = "timeout";
      killGroup(proc.pid, "SIGTERM");
      setTimeout(() => { killGroup(proc.pid, "SIGKILL"); giveUp(""); }, GRACE_MS);
    }, budget);
    const exited = Promise.race([proc.exited, abandoned.then(() => -1)]);
    const [out, err, code] = await Promise.all([
      drain(proc.stdout as ReadableStream, abandoned), drain(proc.stderr as ReadableStream, abandoned), exited,
    ]);
    clearTimeout(timer);
    killGroup(proc.pid, "SIGKILL"); // stragglers that outlived claude
    running.delete(proc.pid);
    const result = parseResult(out);
    Object.assign(log, {
      exit_code: code, is_error: result?.is_error, subtype: result?.subtype, num_turns: result?.num_turns,
      total_cost_usd: result?.total_cost_usd, usage: result?.usage, modelUsage: result?.modelUsage,
      permission_denials: result?.permission_denials?.length ?? null,
    });
    if (!reason) reason = failure(code, result);
    if (reason) log.stderr = err.trim().slice(-500);
  } catch (error) {
    reason = `could not run ${CLAUDE}: ${(error as Error).message}`;
  }
  log.duration_s = Math.round((Date.now() - started) / 100) / 10;
  log.reason = reason || "ok";
  console.log(JSON.stringify(log));
  return { ok: !reason, reason, log };
}

function parseResult(stdout: string): Json | null {
  try {
    const data = JSON.parse(stdout);
    const list = Array.isArray(data) ? data : [data];
    return list.reverse().find((m) => m?.type === "result") ?? null;
  } catch {
    return null;
  }
}

function failure(code: number, result: Json | null): string {
  if (code !== 0) return `exit ${code}`;
  if (!result) return "no JSON result";
  if (result.is_error) return `is_error (${result.subtype})`;
  if (result.subtype && result.subtype !== "success") return `subtype ${result.subtype}`;
  if (result.permission_denials?.length) return `${result.permission_denials.length} permission denials`;
  return "";
}

// --- steps ---------------------------------------------------------------------------

async function collect(work: string, given: string): Promise<boolean> {
  const dir = join(work, "rio-maior-collected");
  if (given) {
    cpSync(given, dir, { recursive: true });
    return true;
  }
  const { code } = await run([PYTHON, COLLECT_SCRIPT, dir]);
  if (code !== 0) console.error(`collect.py exited ${code}`);
  return code === 0 || existsSync(join(dir, "index.json"));
}

function readerPrompt(work: string, window: Json, group: string): string {
  const refs = join(work, "references");
  return [
    `Read ${refs}/reading.md first and follow it. The window is ${window.start} to ${window.end}.`,
    `Then read ${refs}/sources.md, ${refs}/towns.md and ${refs}/events-schema.json (the format your events follow),`,
    `then your group file ${work}/rio-maior-collected/${group}.json, and write your candidates file`,
    `${work}/rio-maior-candidates/${group}.json as reading.md describes (use Write to create it).`,
    "Work only from these files; do not look for anything else.",
  ].join("\n");
}

async function checkCandidates(work: string, group: string): Promise<string> {
  const file = join(work, "rio-maior-candidates", `${group}.json`);
  if (!existsSync(file)) return "no candidates file";
  const { code, stdout } = await py("check_candidates.py", file, "--index", join(work, "rio-maior-collected", "index.json"), "--group", group);
  return code === 0 ? "" : `invalid candidates: ${stdout.trim().split("\n").slice(0, 3).join(" | ")}`;
}

/** One reader, with one retry; the stale file is deleted before each attempt. */
async function readGroup(work: string, window: Json, group: string, sources: Json[]): Promise<boolean> {
  if (!sources.some((s) => s.group === group && s.ok)) {
    console.error(`group ${group}: no source was read, no reader started`);
    summary.readers.push({ group, attempt: 0, reason: "no source read" });
    return false;
  }
  const file = join(work, "rio-maior-candidates", `${group}.json`);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    rmSync(file, { force: true });
    const r = await runClaude(`reader ${group}`, work, `./rio-maior-candidates/${group}.json`, READ_MODEL, readerPrompt(work, window, group));
    let reason = r.reason || (await checkCandidates(work, group));
    summary.readers.push({ group, attempt, ...r.log, reason: reason || "ok" });
    if (!reason) return true;
    console.error(`reader ${group} attempt ${attempt}: ${reason}`);
  }
  rmSync(file, { force: true });
  return false;
}

async function editorRound(work: string, window: Json, renderOutput: string): Promise<void> {
  const prompt = [
    `Read ${work}/references/editing.md first and follow it.`,
    `The window is ${window.start} to ${window.end}. The merge report is ${work}/merge-report.txt.`,
    `The events file, the only file you may edit, is ${work}/rio-maior-events.json.`,
    `The readers' candidates (for hints) are in ${work}/rio-maior-candidates/, the references in ${work}/references/.`,
    "Work only from these files.",
    ...(renderOutput ? ["", "Building the page failed. Fix exactly these problems in the events file:", renderOutput] : []),
  ].join("\n");
  const r = await runClaude("editor", work, "./rio-maior-events.json", EDIT_MODEL, prompt);
  summary.editor.push({ round: summary.editor.length + 1, ...r.log });
}

/** Render to a throwaway file; "" when the page can be built, else the problems. */
async function renderProblems(events: string, out: string): Promise<string> {
  const { code, stdout, stderr } = await py("render.py", events, out);
  return code === 0 ? "" : (stderr + stdout).trim();
}

function parses(file: string): boolean {
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return data !== null && typeof data === "object" && !Array.isArray(data);
  } catch {
    return false;
  }
}

/** The editor, then a render check, then one more round if render complained. Never throws, never fatal. */
async function edit(work: string, window: Json): Promise<void> {
  const events = join(work, "rio-maior-events.json");
  const probe = join(work, "probe.html");
  let problems = "";
  for (let round = 1; round <= EDIT_ROUNDS; round++) {
    if (budgetMs() <= 0) {
      console.error(`no time left for editor round ${round}`);
      return;
    }
    try {
      await editorRound(work, window, problems);
      problems = parses(events) ? await renderProblems(events, probe) : "the file is not valid JSON";
    } catch (error) {
      console.error(`editor round ${round}: ${(error as Error).message}`);
      return;
    }
    if (!problems) return;
    console.error(`render problems after editor round ${round}:\n${problems}`);
  }
}

/** merge.py --finalize on the editor's file if it parses, else on the saved raw merge output. */
async function finalize(work: string): Promise<boolean> {
  const events = join(work, "rio-maior-events.json");
  const raw = join(work, "rio-maior-events.raw.json");
  if (parses(events) && (await py("merge.py", "--finalize", events)).code === 0) return true;
  console.error("finalizing the editor's file did not work; falling back to the merge output");
  copyFileSync(raw, events);
  const { code, stdout } = await py("merge.py", "--finalize", events);
  console.log(stdout.trim());
  return code === 0;
}

function finish(work: string, code: number, result: string): number {
  summary.result = result;
  writeFileSync(join(work, "run-summary.json"), JSON.stringify(summary, null, 1) + "\n");
  console.log(result);
  return code;
}

export async function main(argv: string[]): Promise<number> {
  const { work, collected } = parseArgs(argv);
  for (const dir of ["rio-maior-collected", "rio-maior-candidates", "references", "_site"]) rmSync(join(work, dir), { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  if (!(await collect(work, collected))) return finish(work, 1, "collect failed; nothing deployed");
  cpSync(join(ROOT, "references"), join(work, "references"), { recursive: true });
  mkdirSync(join(work, "rio-maior-candidates"));
  const index: Json = JSON.parse(readFileSync(join(work, "rio-maior-collected", "index.json"), "utf8"));

  const groups = Object.keys(index.groups);
  const done = await Promise.all(groups.map((g) => readGroup(work, index.window, g, index.sources)));
  summary.groups_read = groups.filter((_, i) => done[i]);
  summary.groups_failed = groups.filter((_, i) => !done[i]);
  const need = Math.min(MIN_GROUPS, groups.length);
  if (summary.groups_read.length < need) {
    return finish(work, 1, `only ${summary.groups_read.length} of ${groups.length} groups read; nothing deployed`);
  }

  const events = join(work, "rio-maior-events.json");
  const merged = await py("merge.py", join(work, "rio-maior-collected"), join(work, "rio-maior-candidates"), events, "--missing-ok");
  writeFileSync(join(work, "merge-report.txt"), merged.stdout + merged.stderr);
  if (merged.code !== 0) return finish(work, 1, "merge failed; nothing deployed");
  copyFileSync(events, join(work, "rio-maior-events.raw.json"));

  await edit(work, index.window);
  if (!(await finalize(work))) return finish(work, 1, "could not make a valid events file; nothing deployed");

  mkdirSync(join(work, "_site"));
  const page = await py("render.py", events, join(work, "_site", "index.html"));
  if (page.code !== 0) return finish(work, 1, `render failed: ${page.stderr}${page.stdout}`);
  return finish(work, 0, page.stdout.trim());
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
