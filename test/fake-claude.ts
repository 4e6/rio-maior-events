#!/usr/bin/env bun
// A stand-in for `claude -p` in tests. The prompt arrives on stdin, argv is
// recorded, and FAKE_PLAN (a JSON file) says how each role behaves:
//   { "log": "<file>", "readers": { "<group>": "ok|fail|garbage|denied|once-garbage|hang|hang-child|hang-term" },
//     "editor": "ok|fail|corrupt|unfixable|badthenfix|hang" }
// Anything not named behaves "ok". The log gets one JSON line per call.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const plan = JSON.parse(readFileSync(process.env.FAKE_PLAN!, "utf8"));
const prompt = await new Response(Bun.stdin.stream()).text();
const isEditor = prompt.includes("editing.md");
const group = prompt.match(/rio-maior-candidates\/([\w-]+)\.json/)?.[1] ?? "";
const output = isEditor ? "rio-maior-events.json" : `rio-maior-candidates/${group}.json`;

const calls = existsSync(plan.log) ? readFileSync(plan.log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const attempt = calls.filter((c) => c.role === (isEditor ? "editor" : group)).length + 1;
appendFileSync(plan.log, JSON.stringify({
  role: isEditor ? "editor" : group, attempt, argv: process.argv.slice(2), cwd: process.cwd(),
  existed: existsSync(output), prompt, sawToken: Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN),
}) + "\n");

async function hang(mode: string): Promise<never> {
  if (mode === "hang-child") Bun.spawn(["sleep", "30"], { stdout: "inherit", stderr: "inherit" });
  if (mode === "hang-term") process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
  await new Promise(() => {});
  process.exit(0);
}

const result = (extra = {}) => JSON.stringify({
  type: "result", subtype: "success", is_error: false, num_turns: 3, total_cost_usd: 0.01,
  usage: { input_tokens: 10, output_tokens: 20 }, modelUsage: { fake: {} }, permission_denials: [], result: "done", ...extra,
});

function event(title: string, start: string) {
  return {
    title_pt: title, title_en: title, category: "music", kind: "single", start_date: start, end_date: null,
    start_time: null, dates: null, recurrence: null, date_tbc: false, venue: null, town: "Rio Maior", drive_min: 0,
    price: null, kids: false, description_en: null, sources: [{ name: "src-" + group, url: "https://example.org/" + group }],
    confidence: "high", caveat: null,
  };
}

if (isEditor) {
  const mode = plan.editor ?? "ok";
  if (mode.startsWith("hang")) await hang(mode);
  const doc = JSON.parse(readFileSync(output, "utf8").trim() || "{}");
  if (mode === "fail") { console.log(result({ is_error: true, subtype: "error_max_turns" })); process.exit(1); }
  if (mode === "corrupt") writeFileSync(output, "{ not json");
  else if (mode === "unfixable") writeFileSync(output, JSON.stringify({ events: "x" }));
  else if (mode === "badthenfix") {
    if (prompt.includes("Building the page failed")) {
      doc.events = doc.events.filter((e: any) => e.category !== "bogus");
      writeFileSync(output, JSON.stringify(doc));
    } else {
      doc.events.push({ ...doc.events[0], title_pt: "Broken", category: "bogus" });
      writeFileSync(output, JSON.stringify(doc));
    }
  } else {
    doc.note = "Edited by the fake editor.";
    writeFileSync(output, JSON.stringify(doc));
  }
  console.log(result());
  process.exit(0);
}

const mode = plan.readers?.[group] ?? "ok";
if (mode.startsWith("hang")) await hang(mode);
const input = prompt.match(/your group file (\S+\.json),/)?.[1] ?? `rio-maior-collected/${group}.json`;
const collected = JSON.parse(readFileSync(input, "utf8"));
const good = { collected_at: collected.collected_at, group: collected.group, events: [event("Concerto " + group, "2026-10-25")], hints: [], coverage: group + " ok; reaches 2026-11-10" };
if (mode === "fail") { console.log(result({ is_error: true, subtype: "error_during_execution" })); process.exit(1); }
if (mode === "garbage" || (mode === "once-garbage" && attempt === 1)) writeFileSync(output, "garbage");
else writeFileSync(output, JSON.stringify(good));
console.log(result(mode === "denied" ? { permission_denials: [{ tool_name: "Write" }] } : {}));
