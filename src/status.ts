// The build status page: which sources were read and what they gave, how long each step took, what the
// readers and the editor did, and how many events survived each step. Built from the run's own files and
// its in-memory summary (build.ts), never from the readers' or the editor's output text; static HTML, no scripts
// beyond reading the stored colour theme.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { safeUrl, x } from "./render.ts";

type Json = Record<string, any>;

export type StatusInput = {
  /** The collected folder's index.json. */
  index: Json;
  /** sources.json: labels and group titles. */
  config: Json;
  /** Source id -> truncated, from the group files. */
  truncated: Record<string, boolean>;
  /** Candidates files by reading-unit id (manual.json left out). */
  candidates: Record<string, Json>;
  /** build.ts's in-memory summary. */
  summary: Json;
  mergeStats: Json | null;
  finalizeStats: Json | null;
  /** The events file the page was drawn from (its note and event count). */
  page: { events: number; note: string | null };
  env: Record<string, string | undefined>;
  now: Date;
};

// --- small helpers ---------------------------------------------------------------------------

/** A short one-line piece of text that is safe to show: no control characters, no absolute paths. */
export function scrubPaths(text: unknown): string {
  const s = String(text ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return s.replace(/(^|[\s("'=,;])(?:[A-Za-z]:)?[\\/][^\s"')]*[\\/][^\s"')]*/g, "$1…");
}

/** scrubPaths, cut to `max` characters. */
export function scrub(text: unknown, max = 90): string {
  const s = scrubPaths(text);
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/** The word for why a reader attempt did not succeed: fixed words only, never its output or stderr. */
export function outcomeWord(reason: unknown): string {
  const r = String(reason ?? "");
  if (r === "ok" || r === "timeout" || r === "no time left" || r === "no source read") return r;
  const exit = /^exit (-?\d+)$/.exec(r);
  if (exit) return `exit ${exit[1]}`;
  if (r.startsWith("invalid candidates") || r === "no candidates file") return "invalid candidates";
  return "failed";
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "-";
  if (seconds < 0.5) return "<1 s";
  const s = Math.round(seconds);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

const fmtNum = (n: number): string => n.toLocaleString("en-GB");
const fmtChars = (n: number): string => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const cents = (n: number): number => Math.round(n * 100) / 100;
const usd = (n: number): string => `$${n.toFixed(2)}`;
const plural = (n: number, one: string, many = one + "s"): string => `${fmtNum(n)} ${n === 1 ? one : many}`;

/** "Wed 21 Oct 2026, 08:21" in Lisbon time. */
export function lisbonTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((q) => [q.type, q.value]));
  return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
}

function httpUrl(url: unknown): string {
  return typeof url === "string" ? safeUrl(url) : "";
}

/** Links to the commit and the Actions run, from GitHub's own variables; nothing when they look odd. */
function links(env: StatusInput["env"]): { sha: string | null; commit_url: string; run_url: string } {
  const sha = /^[0-9a-f]{7,40}$/i.test(env.GITHUB_SHA ?? "") ? env.GITHUB_SHA!.toLowerCase() : null;
  const server = /^https:\/\/[\w.-]+$/.test(env.GITHUB_SERVER_URL ?? "") ? env.GITHUB_SERVER_URL! : "";
  const repo = /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? "") ? env.GITHUB_REPOSITORY! : "";
  const runId = /^\d+$/.test(env.GITHUB_RUN_ID ?? "") ? env.GITHUB_RUN_ID! : "";
  return {
    sha,
    commit_url: server && repo && sha ? `${server}/${repo}/commit/${sha}` : "",
    run_url: server && repo && runId ? `${server}/${repo}/actions/runs/${runId}` : "",
  };
}

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}(-\d{2})?$/.test(s);

/** The furthest day an event shows: its start, or for an ongoing or multi-day one its end or the window's end, whichever is earlier. */
function lastDay(e: Json, windowEnd: unknown): string | null {
  const start = isDate(e.start_date) ? e.start_date : null;
  if ((e.kind === "ongoing" || e.kind === "multi_day") && isDate(e.end_date) && e.end_date.length === 10) {
    const cap = isDate(windowEnd) && windowEnd < e.end_date ? windowEnd : e.end_date;
    return start && start > cap ? start : cap;
  }
  return start;
}

// --- the data ---------------------------------------------------------------------------------

export type SourceRow = {
  id: string; label: string; url: string; town: string; group: string;
  state: "ok" | "failed" | "not read"; error: string | null; refused: boolean;
  /** Read through the fallback proxy (the direct request was refused). */
  via_proxy: boolean;
  events: number | null; reaches: string | null;
  list_items: number; event_pages: number; chars: number; truncated: boolean;
};

/** The run's fallback-proxy use from the collected index: numbers and a short reason only, null when it was off. */
function proxyOf(p: unknown): { bytes: number; max_bytes: number; dead: string | null } | null {
  if (typeof p !== "object" || p === null) return null;
  const q = p as Json;
  return { bytes: Number(q.bytes) || 0, max_bytes: Number(q.max_bytes) || 0, dead: typeof q.dead === "string" ? scrub(q.dead, 60) : null };
}

export function buildStatus(input: StatusInput): Json {
  const { index, config, summary, env } = input;
  const configured = new Map<string, Json>((config.sources ?? []).map((s: Json) => [s.name, s] as [string, Json]));
  const timings: Json = summary.timings ?? {};
  const units: Json[] = Array.isArray(summary.units) ? summary.units : [];
  const entries: Json[] = Array.isArray(summary.readers) ? summary.readers : [];

  // readers, one row per unit
  const readerRows = units.map((u) => {
    const mine = entries.filter((e) => e.group === u.id);
    const last = mine[mine.length - 1];
    return {
      id: String(u.id), group: String(u.group ?? u.id), sources: Array.isArray(u.sources) ? u.sources.length : 0,
      attempts: mine.filter((e) => (e.attempt ?? 0) > 0).length,
      outcome: last ? outcomeWord(last.reason) : "not started",
      duration_s: Math.round(mine.reduce((n, e) => n + (Number(e.duration_s) || 0), 0) * 10) / 10,
    };
  });
  const failedUnits = new Set(readerRows.filter((r) => r.outcome !== "ok").map((r) => r.id));
  const unitOf = new Map<string, string>();
  for (const u of units) for (const n of u.sources ?? []) unitOf.set(n, u.id);

  // events per source: the candidates of every unit, before any dedup
  const keyOf = (s: string) => s.trim().toLowerCase();
  const lookup = new Map<string, string>();
  for (const s of index.sources ?? []) lookup.set(keyOf(s.name), s.name);
  for (const s of index.sources ?? []) {
    const label = configured.get(s.name)?.label;
    if (label) lookup.set(keyOf(label), s.name);
  }
  const counts = new Map<string, number>();
  const reach = new Map<string, string>();
  const unattributed = new Map<string, number>();
  let candidateEvents = 0, hints = 0;
  const coverage: { id: string; text: string }[] = [];
  for (const [id, file] of Object.entries(input.candidates)) {
    const events: Json[] = Array.isArray(file.events) ? file.events : [];
    candidateEvents += events.length;
    hints += Array.isArray(file.hints) ? file.hints.length : 0;
    if (typeof file.coverage === "string" && file.coverage.trim()) coverage.push({ id, text: scrubPaths(file.coverage) });
    for (const e of events) {
      const seen = new Set<string>();
      for (const src of Array.isArray(e?.sources) ? e.sources : []) {
        const name = typeof src?.name === "string" ? src.name : "";
        const id2 = lookup.get(keyOf(name));
        if (id2) {
          if (seen.has(id2)) continue;
          seen.add(id2);
          counts.set(id2, (counts.get(id2) ?? 0) + 1);
          const last = lastDay(e, index.window?.end);
          if (last && (reach.get(id2) ?? "") < last) reach.set(id2, last);
        } else {
          const shown = scrub(name || "(no name)", 60);
          if (!seen.has("?" + shown)) { seen.add("?" + shown); unattributed.set(shown, (unattributed.get(shown) ?? 0) + 1); }
        }
      }
    }
  }

  const sources: SourceRow[] = (index.sources ?? []).map((s: Json) => {
    const failed = s.ok !== true;
    const unread = !failed && failedUnits.has(unitOf.get(s.name) ?? "");
    return {
      id: String(s.name), label: scrub(configured.get(s.name)?.label ?? s.label ?? s.name, 80), url: httpUrl(s.url),
      town: scrub(s.town ?? "", 40), group: String(s.group ?? ""),
      state: failed ? "failed" : unread ? "not read" : "ok",
      error: failed ? scrub(s.error || (s.status ? `HTTP ${s.status}` : "failed")) : null,
      refused: failed && s.refused === true,
      via_proxy: s.via === "proxy",
      events: failed || unread ? null : counts.get(s.name) ?? 0,
      reaches: failed || unread ? null : reach.get(s.name) ?? null,
      list_items: Number(s.items) || 0, event_pages: Number(s.details) || 0, chars: Number(s.chars) || 0,
      truncated: input.truncated[s.name] === true,
    } satisfies SourceRow;
  });
  const groupIds = [...new Set<string>([...Object.keys(index.groups ?? {}), ...sources.map((s) => s.group)])];
  const groups = groupIds.map((id) => {
    const title = String(config.groups?.[id] ?? id).split(":")[0]!.trim();
    return { id, title: scrub(title, 60) };
  });

  // timings and usage
  const readerLogs = entries.filter((e) => (e.attempt ?? 0) > 0);
  const slowest = readerRows.reduce((m, r) => Math.max(m, r.duration_s), 0);
  const readSum = readerRows.reduce((n, r) => n + r.duration_s, 0);
  const editorRounds = (Array.isArray(summary.editor) ? summary.editor : []).map((e: Json, i: number) => ({
    round: e.round ?? i + 1, outcome: outcomeWord(e.reason), duration_s: Number(e.duration_s) || 0,
  }));
  const cost = (list: Json[]) => list.reduce((n, e) => n + (Number(e.total_cost_usd) || 0), 0);
  const readerCost = cost(readerLogs), editorCost = cost(Array.isArray(summary.editor) ? summary.editor : []);

  // the result line, built from counts
  const editorState = editorRounds.length === 0 ? "no editor round ran"
    : editorRounds[editorRounds.length - 1]!.outcome === "ok" ? "editor ok" : "the editor did not finish cleanly";
  const fromRaw = summary.finalize_input === "merge";
  const result = {
    events: input.page.events,
    line: `Deployed: ${plural(input.page.events, "event")}. ` +
      (fromRaw ? "The editor's file could not be used, so the page is the merge's raw output, finalized." :
        editorRounds.length === 0 ? "No editor round ran; the page is the merge output, finalized."
          : editorState === "editor ok" ? "Editor ok, finalized." : "The editor did not finish cleanly; its file was finalized as it was."),
    degraded: fromRaw || editorState !== "editor ok",
  };

  const l = links(env);
  const m = input.mergeStats, f = input.finalizeStats;
  // ops-watch's rme-status-json reads built_at, result.{events,degraded}, sources[].state
  // ("ok" | "failed" | "not read"), readers.{read,units,rows} and proxy.{bytes,max_bytes,dead}:
  // renaming one makes that check blind, so change it there too.
  return {
    built_at: input.now.toISOString(),
    built_at_lisbon: lisbonTime(input.now),
    window: index.window ?? null,
    result,
    commit: l.sha ? { sha: l.sha, short: l.sha.slice(0, 7), url: l.commit_url } : null,
    run_url: l.run_url || null,
    claude_code: env.CLAUDE_CODE_VERSION && /^[\w.+-]{1,32}$/.test(env.CLAUDE_CODE_VERSION) ? env.CLAUDE_CODE_VERSION : null,
    models: { reader: summary.models?.reader == null ? null : scrub(summary.models.reader, 40), editor: summary.models?.editor == null ? null : scrub(summary.models.editor, 40) },
    split_chars: Number(summary.split_chars) || 0,
    timings: {
      total_s: timings.total_s ?? null, collect_s: timings.collect_s ?? null,
      reading: { wall_s: timings.read_s ?? null, slowest_s: Math.round(slowest * 10) / 10, sum_s: Math.round(readSum * 10) / 10 },
      editing: editorRounds, merge_s: timings.merge_s ?? null, finalize_s: timings.finalize_s ?? null, render_s: timings.render_s ?? null,
    },
    usage_usd: { readers: cents(readerCost), editor: cents(editorCost), total: cents(readerCost + editorCost) },
    groups, sources,
    proxy: proxyOf(index.proxy),
    unattributed: [...unattributed].map(([name, events]) => ({ name, events })),
    readers: { rows: readerRows, units: readerRows.length, read: readerRows.filter((r) => r.outcome === "ok").length },
    totals: {
      candidates: m?.candidates ?? candidateEvents, collapsed_before_report: m?.collapsed ?? null, after_merge: m?.events ?? null,
      editor_file: summary.editor_events ?? null, finalize_dropped: f?.dropped ?? null, finalize_collapsed: f?.collapsed ?? null,
      after_finalize: f?.events ?? null, on_page: input.page.events, hints,
    },
    coverage,
    note: input.page.note === null ? null : scrubPaths(input.page.note),
  };
}

/** What gets published as status.json: the data without the readers' and the editor's free text. */
export function publicJson(data: Json): Json {
  const { coverage: _c, note: _n, ...rest } = data;
  return rest;
}

// --- reading the run's files ---------------------------------------------------------------------

function readJson(path: string): Json | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** The files status.ts reads from a work folder. */
export function readRunFiles(work: string, configPath: string): Pick<StatusInput, "index" | "config" | "truncated" | "candidates" | "mergeStats" | "finalizeStats"> {
  const collected = join(work, "rio-maior-collected");
  const index = readJson(join(collected, "index.json")) ?? { sources: [], groups: {} };
  const truncated: Record<string, boolean> = {};
  for (const g of Object.keys(index.groups ?? {})) {
    for (const s of readJson(join(collected, `${g}.json`))?.sources ?? []) truncated[s.name] = s.truncated === true;
  }
  const dir = join(work, "rio-maior-candidates");
  const candidates: Record<string, Json> = {};
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith(".json") || f === "manual.json") continue;
      const data = readJson(join(dir, f));
      if (data) candidates[f.slice(0, -5)] = data;
    }
  }
  return {
    index, config: readJson(configPath) ?? {}, truncated, candidates,
    mergeStats: readJson(join(work, "merge-stats.json")), finalizeStats: readJson(join(work, "finalize-stats.json")),
  };
}

// --- the page ---------------------------------------------------------------------------------

const link = (url: string, text: string): string => (url ? `<a href="${x(url)}">${x(text)}</a>` : x(text));

function sourcesTable(d: Json): string {
  const rows: string[] = [];
  for (const g of d.groups as Json[]) {
    const mine = (d.sources as SourceRow[]).filter((s) => s.group === g.id);
    if (!mine.length) continue;
    const ok = mine.filter((s) => s.state === "ok").length;
    const events = mine.reduce((n, s) => n + (s.events ?? 0), 0);
    rows.push(`<tr class="grp"><th colspan="7" scope="colgroup">${x(g.title)} <span class="sub">${ok} of ${mine.length} read, ${fmtNum(events)} events read</span></th></tr>`);
    for (const s of mine) {
      const chars = s.chars ? fmtChars(s.chars) + (s.truncated ? ", cut" : "") : "-";
      const detail = [s.town, s.list_items ? `${s.list_items} items` : "", s.event_pages ? `${s.event_pages} pages` : "", s.chars ? (s.truncated ? `${fmtChars(s.chars)} chars, cut` : `${chars} chars`) : ""].filter(Boolean).join(" · ");
      const events = s.state === "ok"
        ? `<td class="num">${fmtNum(s.events ?? 0)}${s.via_proxy ? ' <span class="pill">proxy</span>' : ""}</td>`
        : `<td class="bad">${x(s.state === "not read" ? "not read" : s.error ?? "failed")}${s.refused ? ' <span class="pill">refused</span>' : ""}${s.via_proxy ? ' <span class="pill">proxy</span>' : ""}</td>`;
      rows.push(
        `<tr><th scope="row">${link(s.url, s.label)}<span class="sub phone">${x(detail)}</span></th>${events}` +
        `<td class="when">${x(s.reaches ?? "")}</td><td class="wide">${x(s.town)}</td><td class="num wide">${s.list_items}</td>` +
        `<td class="num wide">${s.event_pages}</td><td class="num wide">${x(chars)}</td></tr>`);
    }
  }
  if ((d.unattributed as Json[]).length) {
    rows.push(`<tr class="grp"><th colspan="7" scope="colgroup">Not matched to a source <span class="sub">names on events that are no source's label or id</span></th></tr>`);
    for (const u of d.unattributed as Json[]) rows.push(`<tr><th scope="row">${x(u.name)}</th><td class="num">${fmtNum(u.events)}</td><td></td><td class="wide"></td><td class="wide"></td><td class="wide"></td><td class="wide"></td></tr>`);
  }
  return `<div class="tablebox"><table class="sources"><thead><tr><th scope="col">Source</th><th scope="col" class="num">Events read</th><th scope="col">Reaches</th>` +
    `<th scope="col" class="wide">Town</th><th scope="col" class="num wide">List items</th><th scope="col" class="num wide">Event pages</th><th scope="col" class="num wide">Text</th></tr></thead><tbody>\n${rows.join("\n")}\n</tbody></table></div>`;
}

function proxyLine(p: Json, sources: SourceRow[]): string {
  const mb = (n: number) => (n / 1048576).toFixed(1);
  const n = sources.filter((s) => s.via_proxy).length;
  return `${plural(n, "source")} read that way, about ${mb(p.bytes)} MB of ${mb(p.max_bytes)} MB${p.dead ? `; ${p.dead}` : ""}`;
}

function timingsList(d: Json): string {
  const t = d.timings as Json;
  const items: [string, string][] = [
    ["Total", fmtDuration(t.total_s)],
    ["Collecting", fmtDuration(t.collect_s)],
    ...(d.proxy ? [["Fallback proxy", proxyLine(d.proxy as Json, d.sources as SourceRow[])] as [string, string]] : []),
    ["Reading", `${fmtDuration(t.reading.wall_s)} (slowest reader ${fmtDuration(t.reading.slowest_s)}, all readers together ${fmtDuration(t.reading.sum_s)})`],
  ];
  for (const r of t.editing as Json[]) items.push([`Editing, round ${r.round}`, `${fmtDuration(r.duration_s)}${r.outcome === "ok" ? "" : ` (${r.outcome})`}`]);
  items.push(["Merge", fmtDuration(t.merge_s)], ["Finalize", fmtDuration(t.finalize_s)], ["Render", fmtDuration(t.render_s)]);
  return `<dl class="facts">${items.map(([k, v]) => `<dt>${x(k)}</dt><dd>${x(v)}</dd>`).join("")}</dl>`;
}

function readersSection(d: Json): string {
  const r = d.readers as Json;
  const rows = r.rows as Json[];
  const slowest = (d.timings as Json).reading.slowest_s;
  const trouble = rows.filter((u) => u.outcome !== "ok" || u.attempts > 1);
  const summary = `${r.read} of ${plural(r.units, d.split_chars ? "piece" : "group")} read${rows.length ? `, slowest ${fmtDuration(slowest)}` : ""}.`;
  const list = trouble.length
    ? `<ul class="plainlist">${trouble.map((u) => `<li><b>${x(u.id)}</b>: ${x(u.outcome === "ok" ? "read on the second attempt" : u.outcome)}${u.attempts > 1 && u.outcome !== "ok" ? ` after ${u.attempts} attempts` : ""}</li>`).join("")}</ul>` : "";
  const table = `<div class="tablebox"><table><thead><tr><th scope="col">Reader</th><th scope="col" class="num">Sources</th><th scope="col" class="num">Attempts</th><th scope="col">Outcome</th><th scope="col" class="num">Time</th></tr></thead><tbody>` +
    rows.map((u) => `<tr><th scope="row">${x(u.id)}</th><td class="num">${u.sources}</td><td class="num">${u.attempts}</td><td${u.outcome === "ok" ? "" : ' class="bad"'}>${x(u.outcome)}</td><td class="num">${x(fmtDuration(u.duration_s))}</td></tr>`).join("") +
    `</tbody></table></div>`;
  const cov = (d.coverage as Json[]).length
    ? `<details><summary>What the readers say they covered</summary><ul class="plainlist">${(d.coverage as Json[]).map((c) => `<li><b>${x(c.id)}</b>: ${x(c.text)}</li>`).join("")}</ul></details>` : "";
  const note = d.note ? `<details><summary>The page's note</summary><p>${x(d.note)}</p></details>` : "";
  return `<p>${x(summary)}</p>${list}<details><summary>All readers</summary>${table}</details>${cov}${note}`;
}

function totalsList(d: Json): string {
  const t = d.totals as Json;
  const rows: [string, string][] = [["Candidate events from the readers", fmtNum(t.candidates)]];
  if (t.after_merge !== null) rows.push(["After merging identical listings", `${fmtNum(t.after_merge)} (${fmtNum(t.collapsed_before_report ?? 0)} merged)`]);
  if (t.editor_file !== null) rows.push(["In the editor's file", fmtNum(t.editor_file)]);
  if (t.after_finalize !== null) rows.push(["After the final checks", `${fmtNum(t.after_finalize)} (${fmtNum(t.finalize_dropped ?? 0)} dropped by the checks, ${fmtNum(t.finalize_collapsed ?? 0)} duplicates collapsed)`]);
  rows.push(["On the page", fmtNum(t.on_page)], ["Hints passed to the editor", fmtNum(t.hints)]);
  return `<dl class="facts">${rows.map(([k, v]) => `<dt>${x(k)}</dt><dd>${x(v)}</dd>`).join("")}</dl>`;
}

export function renderStatus(d: Json, css: string, statusCss: string): string {
  const ok = (d.sources as SourceRow[]).filter((s) => s.state === "ok").length;
  const n = (d.sources as SourceRow[]).length;
  const win = d.window ? `${x(d.window.start)} to ${x(d.window.end)}` : "";
  const facts: [string, string][] = [];
  if (d.commit) facts.push(["Commit", link(d.commit.url, d.commit.short)]);
  if (d.run_url) facts.push(["Actions run", link(d.run_url, "open")]);
  facts.push(["Claude Code", x(d.claude_code ?? "unknown")]);
  facts.push(["Reader model", x(d.models.reader ?? "unknown")], ["Editor model", x(d.models.editor ?? "unknown")]);
  facts.push(["Reading", d.split_chars ? `pieces of at most ${fmtNum(d.split_chars)} characters` : "one reader per group"]);
  const u = d.usage_usd as Json;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Build status - what's on around Rio Maior</title>
<script>try{var t=JSON.parse(localStorage.getItem("rmagenda:theme"));if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>
<style>
${css}${statusCss}</style>
</head>
<body>
<div class="page status">
  <header class="masthead">
    <div>
      <p class="back"><a href="index.html">&larr; What's on</a></p>
      <h1>Build status</h1>
      <p class="meta">Built ${x(d.built_at_lisbon)}, Lisbon time${win ? ` · window ${win}` : ""}</p>
    </div>
  </header>
  <p class="result${d.result.degraded ? " warn-box" : ""}">${x(d.result.line)}</p>
  <section>
    <h2>Build</h2>
    <dl class="facts">${facts.map(([k, v]) => `<dt>${x(k)}</dt><dd>${v}</dd>`).join("")}</dl>
  </section>
  <section>
    <h2>Time</h2>
    ${timingsList(d)}
    <p class="meta">About ${x(usd(u.total))} at list price (${x(usd(u.readers))} readers, ${x(usd(u.editor))} editor); the subscription is not billed per use.</p>
  </section>
  <section>
    <h2>Sources <span class="sub">${ok} of ${n} read</span></h2>
    ${sourcesTable(d)}
    <p class="meta">Events read counts the events the readers wrote that name the source, before any duplicates were merged. An event can name several sources, so the column adds up to more than the ${fmtNum(d.totals.candidates)} candidate events. Reaches is the latest start date among them.</p>
  </section>
  <section>
    <h2>Readers</h2>
    ${readersSection(d)}
  </section>
  <section>
    <h2>Events</h2>
    ${totalsList(d)}
  </section>
</div>
</body>
</html>
`;
}

/** A page for a build whose status could not be worked out, so the link from the agenda still lands somewhere. */
export function renderStatusUnavailable(css: string, statusCss: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Build status - what's on around Rio Maior</title>
<script>try{var t=JSON.parse(localStorage.getItem("rmagenda:theme"));if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>
<style>
${css}${statusCss}</style>
</head>
<body>
<div class="page status">
  <header class="masthead"><div><p class="back"><a href="index.html">&larr; What's on</a></p><h1>Build status</h1></div></header>
  <p class="result warn-box">The status of this build could not be worked out. The agenda itself was built.</p>
</div>
</body>
</html>
`;
}
