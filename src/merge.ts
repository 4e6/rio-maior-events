// Port of scripts/merge.py. Owned by T11. Documents are JSON objects; they stay loosely typed.
// Output is JSON.stringify(doc, null, 1) + "\n"; `$`-before-newline is fixed in the date regexes.
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "./cli-args.ts";
import { localIsoNow } from "./py/datetime.ts";
import { foldKey, pyRepr, pyStrip } from "./py/str.ts";
import * as render from "./render.ts";
import { dayNumber, isDict, pyStr, readText, truthy } from "./render.ts";

type Doc = Record<string, any>;

const ORIGIN = "Rio Maior";
const NOT_READ = "not read";
const MAX_DAYS_APART = 1;
const MIN_OVERLAP = 0.5;
const STOPWORDS = new Set(
  ("com das dos del como para por que uma uns umas aos nas nos pelo pela " + "este esta isto the and").split(" "),
);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** merge.normalise (NFKC + LOOKALIKES, NFKD, no combining marks, casefold, collapsed whitespace). */
export function normalise(text: string): string {
  return foldKey(text, "NFKD", true);
}

/** merge.tokens */
export function tokens(title: string): Set<string> {
  const words = normalise(title).match(/[a-z0-9]+/g) ?? [];
  return new Set(words.filter((w) => w.length >= 3 && !STOPWORDS.has(w)));
}

/** merge.full_date: the date as "YYYY-MM-DD" when it is a real one. */
export function fullDate(text: unknown): string | null {
  return typeof text === "string" && DATE.test(text) ? render.realDate(text) : null;
}

/** merge.town_names */
export function townNames(town: unknown): Set<string> {
  if (typeof town !== "string") return new Set();
  const names = new Set<string>([normalise(town), normalise(town.replace(/\([^\n]*?\)/g, " "))]);
  for (const m of town.matchAll(/\(([^\n]*?)\)/g)) names.add(normalise(m[1]!));
  names.delete("");
  return names;
}

/** merge.day_range: (first, last) day of an event, or null when its start is not a full date. */
export function dayRange(e: Doc): [string, string] | null {
  const first = fullDate(e.start_date);
  if (first === null) return null;
  const last = fullDate(e.end_date);
  return [first, last && last >= first ? last : first];
}

function load(path: string, problems: string[], what: string): Doc | null {
  let data: unknown;
  try {
    data = JSON.parse(readText(path));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") problems.push(`${what}: missing (${path})`);
    else problems.push(`${what}: cannot read ${path}: ${(err as Error).message}`);
    return null;
  }
  if (isDict(data)) return data;
  problems.push(`${what}: ${path} must hold one JSON object`);
  return null;
}

/** merge.possible_duplicates: index pairs (i, j), i < j, that may be one event listed twice. */
export function possibleDuplicates(events: Doc[]): [number, number][] {
  const keys = events.map((e) => {
    const ok = isDict(e);
    const title = ok ? e.title_pt : null;
    return {
      town: ok ? townNames(e.town) : new Set<string>(),
      days: ok ? dayRange(e) : null,
      words: typeof title === "string" ? tokens(title) : new Set<string>(),
    };
  });
  const pairs: [number, number][] = [];
  for (let i = 0; i < keys.length; i++) {
    const a = keys[i]!;
    if (!a.town.size || a.days === null || !a.words.size) continue;
    const [aFirst, aLast] = [dayNumber(a.days[0]), dayNumber(a.days[1])];
    for (let j = i + 1; j < keys.length; j++) {
      const b = keys[j]!;
      if (![...a.town].some((t) => b.town.has(t)) || b.days === null || !b.words.size) continue;
      const [bFirst, bLast] = [dayNumber(b.days[0]), dayNumber(b.days[1])];
      if (bFirst > aLast + MAX_DAYS_APART || aFirst > bLast + MAX_DAYS_APART) continue;
      let shared = 0;
      for (const w of a.words) if (b.words.has(w)) shared++;
      if (shared / Math.min(a.words.size, b.words.size) >= MIN_OVERLAP) pairs.push([i, j]);
    }
  }
  return pairs;
}

/** merge.describe */
export function describe(e: Doc): string {
  return `${pyStr(e.title_pt)} | ${pyStr(e.start_date)} | ${pyStr(e.town)}`;
}

function readGroup(candidates: string, group: string, stamp: unknown, problems: string[]): Doc | null {
  const data = load(join(candidates, group + ".json"), problems, "group " + group);
  if (data === null) return null;
  const hints = truthy(data.hints) ? data.hints : [];
  if (data.collected_at !== stamp) {
    problems.push(`group ${group}: stale, its collected_at is ${pyStr(data.collected_at)} but the index says ${pyStr(stamp)}`);
  } else if (data.group !== group) {
    problems.push(`group ${group}: the file says group ${pyStr(data.group)}`);
  } else if (!Array.isArray(data.events)) {
    problems.push(`group ${group}: events must be a list`);
  } else if (!(Array.isArray(hints) && hints.every(isDict))) {
    problems.push(`group ${group}: hints must be a list of events`);
  } else {
    return data;
  }
  return null;
}

/** merge.merge: (document, report lines) or (null, problems). `now` is injectable for tests. */
export function merge(collected: string, candidates: string, now?: Date, missingOk = false): [Doc | null, string[]] {
  const problems: string[] = [];
  const index = load(join(collected, "index.json"), problems, "index");
  if (index === null) return [null, problems];
  const groups = index.groups;
  const sources = index.sources;
  const window = index.window;
  const stamp = index.collected_at;
  if (!(isDict(groups) && Array.isArray(sources) && isDict(window) && truthy(stamp))) {
    return [null, ["index: needs collected_at, window, groups and sources"]];
  }

  const events: Doc[] = [];
  const origins: string[] = [];
  const hints: [string, Doc][] = [];
  const coverage: [string, string][] = [];
  const missing: string[] = [];
  const reasons = new Map<string, string>();
  for (const group of Object.keys(groups)) {
    const groupProblems: string[] = [];
    const data = readGroup(candidates, group, stamp, groupProblems);
    if (data === null) {
      if (missingOk) {
        missing.push(group);
        reasons.set(group, groupProblems.map((p) => { const k = p.indexOf(": "); return k === -1 ? p : p.slice(k + 2); }).join("; "));
      } else {
        problems.push(...groupProblems);
      }
      continue;
    }
    events.push(...data.events);
    for (let n = 0; n < data.events.length; n++) origins.push(group);
    for (const h of truthy(data.hints) ? data.hints : []) hints.push([group, h]);
    if (truthy(data.coverage)) coverage.push([group, pyStr(data.coverage)]);
  }

  const manualPath = join(candidates, "manual.json");
  const overrides = new Map<unknown, Doc>();
  if (existsSync(manualPath)) {
    const manual = load(manualPath, problems, "manual");
    if (manual !== null) {
      if (manual.collected_at !== stamp) {
        problems.push(`manual: stale, its collected_at is ${pyStr(manual.collected_at)} but the index says ${pyStr(stamp)}; ` +
          `delete ${manualPath} and read the failed sources again if you still need it`);
      } else {
        const manualEvents = truthy(manual.events) && Array.isArray(manual.events) ? manual.events : [];
        events.push(...manualEvents);
        for (let n = 0; n < manualEvents.length; n++) origins.push("manual");
        for (const o of (truthy(manual.sources) && Array.isArray(manual.sources) ? manual.sources : [])) {
          const name = isDict(o) ? o.name : null;
          if (!sources.some((s) => isDict(s) && s.name === name)) {
            problems.push(`manual: source ${pyRepr(name ?? null)} is not in the index`);
          } else {
            overrides.set(name, o);
          }
        }
      }
    }
  }
  const groupNames = Object.keys(groups);
  if (missingOk && groupNames.length && missing.length === groupNames.length) {
    problems.push("every group is missing: no events to merge");
    problems.push(...missing.map((g) => `missing group: ${g} (${reasons.get(g)})`));
  }
  if (problems.length) return [null, problems];

  const unread = new Set<unknown>();
  for (const group of missing) {
    const g = groups[group];
    const listed = isDict(g) ? g.sources : null;
    if (Array.isArray(listed)) for (const n of listed) unread.add(n);
    else for (const s of sources) if (s.group === group) unread.add(s.name);
  }
  const checked: Doc[] = [];
  for (const s of sources) {
    let o: Doc = overrides.has(s.name) ? overrides.get(s.name)! : s;
    const entry: Doc = { name: s.name, url: truthy(s.url) ? s.url : "", ok: truthy(o.ok) };
    if (unread.has(s.name) && !overrides.has(s.name)) {
      entry.ok = false;
      o = !truthy(o.ok) && truthy(o.error) ? o : { error: NOT_READ };
    }
    if (!entry.ok && truthy(o.error)) entry.error = o.error;
    checked.push(entry);
  }

  const doc: Doc = {
    generated_at: localIsoNow(now ?? new Date()),
    window,
    origin: ORIGIN,
    sources_checked: checked,
    events,
  };
  const lines = missing.map((group) => `missing group: ${group} (${reasons.get(group)})`);
  lines.push("hints:");
  for (const [group, h] of hints) lines.push(`  [${group}] ${describe(h)} | ${truthy(h.caveat) ? pyStr(h.caveat) : ""}`);
  lines.push("coverage:");
  for (const [group, text] of coverage) lines.push(`  ${group}: ${text}`);
  lines.push("problems:");
  for (let text of render.check(doc)) {
    const found = /^events\[(\d+)\]/.exec(text);
    if (found && +found[1]! < origins.length) text += ` [group ${origins[+found[1]!]}]`;
    lines.push("  " + text);
  }
  lines.push("possible duplicates:");
  for (const [i, j] of possibleDuplicates(events)) {
    lines.push(`  events[${i}] ${describe(events[i]!)}  <->  events[${j}] ${describe(events[j]!)}`);
  }
  return [doc, lines];
}

const MUNICIPAL_WORDS = ["municipio", "municipal", "camara"];

/** merge.municipal_or_venue: whether a source of an event is the municipality's or the venue's own. */
export function municipalOrVenue(source: Doc, event: Doc): boolean {
  const name = normalise(truthy(source.name) ? source.name : "");
  if (name.startsWith("cm-") || name.startsWith("mcr") || MUNICIPAL_WORDS.some((w) => name.includes(w))) return true;
  const venue = normalise(truthy(event.venue) ? event.venue : "");
  return venue !== "" && name !== "" && name.includes(venue);
}

/** merge.preference: higher is better: a start_time, then a single day, then a municipal or venue source. */
export function preference(e: Doc): [boolean, boolean, boolean] {
  return [e.start_time !== null, e.end_date === null, e.sources.some((s: Doc) => municipalOrVenue(s, e))];
}

const FILLED = ["venue", "price", "description_en", "drive_min"];

type Stats = { events: number; dropped: number; collapsed: number };

/** merge.finalize_document: [events file fixed so render.check passes, stats] or [null, problems]. */
export function finalizeDocument(doc: unknown): [Doc, Stats] | [null, string[]] {
  if (!isDict(doc) || !Array.isArray(doc.events)) return [null, ["the file must be a JSON object with an events list"]];
  let window: [string, string] | null = null;
  const w = doc.window;
  if (isDict(w)) {
    const ws = render.realDate(w.start), we = render.realDate(w.end);
    if (ws && we && ws <= we) window = [ws, we];
  }

  const dropped: string[] = [];
  const valid: Doc[] = [];
  for (const e of doc.events) {
    if (isDict(e) && !render.checkEvent(e, window).length) valid.push(e);
    else {
      const title = isDict(e) ? e.title_pt ?? null : null;
      const start = isDict(e) ? e.start_date ?? null : null;
      dropped.push(`${render.textOk(title) ? title : "untitled"} (${pyStr(start)})`);
    }
  }

  const byId = new Map<string, Doc[]>();
  for (const e of valid) {
    const eid = render.eventId(e);
    const list = byId.get(eid);
    if (list) list.push(e);
    else byId.set(eid, [e]);
  }
  const kept: Doc[] = [];
  for (const group of byId.values()) {
    // best first by each event's own sources (sort is stable: ties keep file order)
    const ranked = group.map((e) => ({ e, p: preference(e) }));
    ranked.sort((a, b) => {
      for (let k = 0; k < 3; k++) if (a.p[k] !== b.p[k]) return a.p[k] ? -1 : 1;
      return 0;
    });
    const best: Doc = { ...ranked[0]!.e, sources: [...ranked[0]!.e.sources] };
    for (const { e: other } of ranked.slice(1)) {
      for (const s of other.sources) {
        if (!best.sources.some((m: Doc) => s.name === m.name && s.url === m.url)) best.sources.push(s);
      }
      for (const key of FILLED) if (best[key] === null && other[key] !== null) best[key] = other[key];
    }
    kept.push(best);
  }
  const collapsed = valid.length - kept.length;

  const out: Doc = { ...doc, events: kept };
  let note = typeof out.note === "string" ? pyStrip(out.note) : "";
  if (!note) {
    const unread = (truthy(out.sources_checked) ? out.sources_checked : [])
      .filter((s: unknown) => isDict(s) && s.ok === false && s.error === NOT_READ && typeof s.name === "string")
      .map((s: Doc) => s.name);
    const parts: string[] = [];
    if (unread.length) parts.push(`Not read: ${unread.join(", ")}.`);
    parts.push("This agenda was put together automatically, without a final edit: " +
      "some listings may be missing or repeated, so check the source for anything that matters.");
    note = parts.join(" ");
  }
  if (dropped.length) note += ` Left out because they could not be shown: ${dropped.join("; ")}.`;
  out.note = note;
  const problems = render.check(out);
  if (problems.length) return [null, problems];
  return [out, { events: kept.length, dropped: dropped.length, collapsed }];
}

/** merge.finalize: in place on a file; exit code. */
export function finalize(path: string): number {
  let doc: unknown;
  try {
    doc = JSON.parse(readText(path));
  } catch (err) {
    console.log(`cannot read ${path}: ${(err as Error).message}`);
    return 2;
  }
  const [out, result] = finalizeDocument(doc);
  if (out === null) {
    console.log(`cannot finalize ${path}:`);
    for (const line of result.slice(0, render.MAX_PROBLEMS)) console.log("  " + line);
    return 2;
  }
  const tmp = path + ".tmp";
  try {
    writeFileSync(tmp, JSON.stringify(out, null, 1) + "\n", "utf8");
    renameSync(tmp, path);
  } catch (err) {
    console.log(`cannot write ${path}: ${(err as Error).message}`);
    return 2;
  }
  console.log(`finalized ${path}: ${result.events} events, ${result.dropped} dropped, ${result.collapsed} duplicates collapsed`);
  return 0;
}

const USAGE = "usage: merge.py [-h] [--missing-ok] [--finalize EVENTS_JSON] [collected] [candidates] [out]";

/** merge.main(argv, now): exit code. */
export function main(argv: string[], now?: Date): number {
  const args = parseArgs({
    prog: "merge.py", usage: USAGE,
    positionals: [{ name: "collected", optional: true }, { name: "candidates", optional: true }, { name: "out", optional: true }],
    flags: ["--missing-ok"],
    values: [{ name: "--finalize" }],
  }, argv);
  if (args === null) return 2;
  if (args.help) return 0;
  const [collected, candidates, out] = args.positionals;
  const fin = args.values.get("--finalize");
  const fail = (msg: string): number => { console.error(USAGE); console.error(`merge.py: error: ${msg}`); return 2; };
  if (fin) {
    if (collected || args.flags.has("--missing-ok")) return fail("--finalize takes no folders and no --missing-ok");
    return finalize(fin);
  }
  if (!(collected && candidates && out)) return fail("collected, candidates and out are required");
  const [doc, lines] = merge(collected, candidates, now, args.flags.has("--missing-ok"));
  if (doc === null) {
    for (const line of lines) console.log(line);
    return 2;
  }
  try {
    writeFileSync(out, JSON.stringify(doc, null, 1) + "\n", "utf8");
  } catch (err) {
    console.log(`cannot write ${out}: ${(err as Error).message}`);
    return 2;
  }
  console.log(`wrote ${out}: ${doc.events.length} events`);
  for (const line of lines) console.log(line);
  return 0;
}
