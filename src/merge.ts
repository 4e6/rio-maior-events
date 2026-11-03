// Port of the former merge.py. Owned by T11. Documents are JSON objects; they stay loosely typed.
// Output is JSON.stringify(doc, null, 1) + "\n"; `$`-before-newline is fixed in the date regexes.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "./cli-args.ts";
import { localIsoNow } from "./py/datetime.ts";
import { foldKey, pyRepr, pyStrip } from "./py/str.ts";
import * as render from "./render.ts";
import { dayNumber, isDict, pyStr, readText, truthy } from "./render.ts";
import { readSplit } from "./split.ts";

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

// Words that name a kind of event, not the event: they never make two titles "the same name".
const GENERIC = new Set(
  ("concerto concertos espetaculo espetaculos teatro cinema exposicao musica festa festas festival feira " +
    "dia dias noite noites show oficina workshop visita danca filme sessao mostra encontro ciclo nacional internacional edicao").split(" "),
);
const FESTIVALISH = /\b(festival|feira|festa|festas|mostra|certame|semana|jornadas)\b/;
const TOWN_DAY = /\bdia d[aeo]s? [a-z0-9]+|\bstands?\b/;
const MAX_START_GAP = 7;

// Edition numbers and years ("2026", "45a") never tell two events apart either.
const distinctive = (words: Set<string>) => new Set([...words].filter((w) => !GENERIC.has(w) && !/\d/.test(w)));

/** The title's words in order, accents and case folded, for the word-prefix test. */
function wordList(title: unknown): string[] {
  return typeof title === "string" ? normalise(title).match(/[a-z0-9]+/g) ?? [] : [];
}

/**
 * merge.possible_duplicates, extended: [i, j, likely] with i < j for events that may be one event listed twice.
 * Rules (any one pairs; `likely` marks a same-day, same-town title that continues the other, unless both
 * events state different start times; the fourth element names the rules that fired):
 * - same town, day ranges overlapping or a day apart, half of the shorter title's words shared (the old rule);
 * - same town, starts at most 7 days apart, every distinctive word of the shorter title in the other;
 * - a festival (a multi-day range, with festival, feira, festa, mostra... in the title) and an event that starts inside it, in any town, when the event's title shares
 *   at least two of the festival's distinctive words, or names a "dia de/do <town>" or a stand and shares one of
 *   them with a festival-like title.
 */
export function duplicatePairs(events: Doc[]): [number, number, boolean, string[]][] {
  const keys = events.map((e) => {
    const ok = isDict(e);
    const title = ok ? e.title_pt : null;
    const words = typeof title === "string" ? tokens(title) : new Set<string>();
    // the event's own town never tells it apart from another event: "Peniche 2026" is in every title there
    const townWords = new Set(typeof e?.town === "string" ? normalise(e.town).match(/[a-z0-9]+/g) ?? [] : []);
    return {
      town: ok ? townNames(e.town) : new Set<string>(),
      days: ok ? dayRange(e) : null,
      words,
      sig: new Set([...distinctive(words)].filter((w) => !townWords.has(w))),
      list: wordList(title),
      folded: typeof title === "string" ? normalise(title) : "",
      time: ok && typeof e.start_time === "string" ? e.start_time : null,
    };
  });
  type Key = (typeof keys)[number];
  const sameTown = (a: Key, b: Key) => [...a.town].some((t) => b.town.has(t));
  const num = (k: Key) => [dayNumber(k.days![0]), dayNumber(k.days![1])] as const;

  const nearTitle = (a: Key, b: Key): boolean => {
    const [small, big] = a.sig.size <= b.sig.size ? [a, b] : [b, a];
    return small.sig.size > 0 && [...small.sig].every((w) => big.sig.has(w));
  };
  const festival = (f: Key, g: Key): boolean => {
    const [fFirst, fLast] = num(f);
    if (fLast <= fFirst || !FESTIVALISH.test(f.folded)) return false; // a long exhibition or market is not a festival
    const gFirst = num(g)[0];
    if (gFirst < fFirst || gFirst > fLast) return false;
    const shared = [...f.sig].filter((w) => g.words.has(w)).length;
    if (shared > 0 && shared >= Math.min(2, f.sig.size)) return true;
    return shared > 0 && TOWN_DAY.test(g.folded);
  };
  const continues = (a: Key, b: Key): boolean => {
    const [small, big] = a.list.length <= b.list.length ? [a.list, b.list] : [b.list, a.list];
    return small.length > 0 && small.every((w, n) => big[n] === w);
  };

  const pairs: [number, number, boolean, string[]][] = [];
  for (let i = 0; i < keys.length; i++) {
    const a = keys[i]!;
    if (a.days === null || !a.words.size) continue;
    const [aFirst, aLast] = num(a);
    for (let j = i + 1; j < keys.length; j++) {
      const b = keys[j]!;
      if (b.days === null || !b.words.size) continue;
      const [bFirst, bLast] = num(b);
      const rules: string[] = [];
      let likely = false;
      if (a.town.size && b.town.size && sameTown(a, b)) {
        if (!(bFirst > aLast + MAX_DAYS_APART || aFirst > bLast + MAX_DAYS_APART)) {
          let shared = 0;
          for (const w of a.words) if (b.words.has(w)) shared++;
          if (shared / Math.min(a.words.size, b.words.size) >= MIN_OVERLAP) rules.push("overlap");
        }
        if (Math.abs(aFirst - bFirst) <= MAX_START_GAP && nearTitle(a, b)) rules.push("near-title");
        if (aFirst === bFirst && continues(a, b)) {
          rules.push("continues");
          // two stated, different times on one day are two showings, not one event listed twice
          likely = !(a.time !== null && b.time !== null && a.time !== b.time);
        }
      }
      if (festival(a, b) || festival(b, a)) rules.push("festival");
      if (rules.length) pairs.push([i, j, likely, rules]);
    }
  }
  return pairs;
}

/** merge.possible_duplicates: index pairs (i, j), i < j, that may be one event listed twice. */
export function possibleDuplicates(events: Doc[]): [number, number][] {
  return duplicatePairs(events).map(([i, j]) => [i, j] as [number, number]);
}

const TOWNS_FILE = resolve(import.meta.dir, "..", "references", "towns.md");

/** Minutes from Rio Maior by normalised town name, from the table in references/towns.md. */
export function loadTowns(file = TOWNS_FILE): Map<string, number> {
  const out = new Map<string, number>();
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch { return out; }
  for (const line of text.split("\n")) {
    const m = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*$/.exec(line);
    if (m) out.set(normalise(m[1]!), +m[3]!);
  }
  return out;
}

// Names that more than one place bears: never filled from the table.
const AMBIGUOUS = new Set(["atalaia", "pedrogao", "sao jorge", "sao bento", "sao gregorio"].map(normalise));

/** Fill a null drive_min from the table when the event's town is a listed, unambiguous one, written plainly. */
function fillDrive(e: Doc, minutes: Map<string, number>): void {
  // a town with a parenthetical names its municipality: that is for the reader to judge, not for a name lookup
  if (typeof e.town !== "string" || /[()]/.test(e.town)) return;
  const name = normalise(e.town);
  if (AMBIGUOUS.has(name)) return;
  const found = minutes.get(name);
  if (found !== undefined) e.drive_min = found;
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

/** Whether an event or hint starts after `nearEnd`: by day, or by the month/day prefix its start_date has (as checkEvent compares a date_tbc one). */
export function startsAfter(e: Doc, nearEnd: string): boolean {
  const start = e.start_date;
  if (typeof start !== "string" || !(render.realDate(start) || render.realMonth(start))) return false;
  return start > nearEnd.slice(0, start.length);
}

/**
 * Where a candidate starts against `nearEnd`: "within" (on or before it), "after", or "unknown" when merge cannot
 * tell: not an object, no real start_date, or only a month (date_tbc "YYYY-MM") that is near_end's own month and runs
 * past it. The race cut drops "unknown" as well as "after" (fail closed): an invalid date is otherwise only reported,
 * and the editor's repair of it is held to near_end again only by finalize's name match (farRaces), which a race
 * citing a name no source row has escapes.
 */
export function placeStart(e: unknown, nearEnd: string): "within" | "after" | "unknown" {
  if (!isDict(e) || typeof e.start_date !== "string") return "unknown";
  const start: string = e.start_date;
  if (render.realDate(start)) return start > nearEnd ? "after" : "within";
  if (!render.realMonth(start)) return "unknown";
  const month = nearEnd.slice(0, 7);
  if (start !== month) return start > month ? "after" : "within";
  // the month runs past near_end unless near_end is its last day
  const next = new Date(Date.UTC(+nearEnd.slice(0, 4), +nearEnd.slice(5, 7) - 1, +nearEnd.slice(8, 10) + 1));
  return next.getUTCDate() === 1 ? "within" : "unknown";
}

/** The most dates a recurring event keeps that begin after the coming weeks (it is Further ahead from its first date on). */
export const FAR_RECURRING_DATES = 4;

/**
 * A recurring event lists its dates only up to near_end, with the rest in `recurrence`: a weekly market over six
 * months would otherwise carry about 26 dates into the readers' output and the editor's input. One that starts after
 * near_end keeps its first FAR_RECURRING_DATES distinct dates. Trimmed only when `recurrence` has text to hold the
 * rest: without it the page shows the dates themselves, and a cut list would end the event at near_end with nothing
 * saying it goes on. Not trimmed either when a date is not a string (left for the check to report). Returns whether
 * it trimmed. start_date and end_date are left as they are: the page places a recurring event by its dates,
 * render.checkEvent ties neither to them, and the kept dates are the earliest, so the span the event states (to
 * end_date, with the rest in `recurrence`) still holds.
 */
export function trimRecurring(e: Doc, nearEnd: string): boolean {
  if (e.kind !== "recurring" || e.date_tbc === true || !Array.isArray(e.dates)) return false;
  if (!render.textOk(e.recurrence)) return false;
  if (!e.dates.every((d: unknown) => typeof d === "string")) return false;
  const dates = [...new Set<string>(e.dates)].sort();
  const near = dates.filter((d) => d <= nearEnd);
  const kept = near.length ? near : dates.slice(0, FAR_RECURRING_DATES);
  if (kept.length === dates.length) return false;
  e.dates = kept;
  return true;
}

export type MergeOptions = {
  /** A folder written by split.ts: the candidates files are then one per piece, not one per group. */
  split?: string;
  /** Minutes by town, to fill `drive_min` when it is null (default: references/towns.md). */
  towns?: Map<string, number>;
  /** Called with the counts of the merge: candidates read, collapsed before the report, events written. */
  onStats?: (stats: MergeStats) => void;
};

export type MergeStats = { candidates: number; collapsed: number; events: number };

/** merge.merge: (document, report lines) or (null, problems). `now` is injectable for tests. */
export function merge(
  collected: string, candidates: string, now?: Date, missingOk = false, opts: MergeOptions = {},
): [Doc | null, string[]] {
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

  // The coming weeks end at window.near_end (the window end when there is none, or a bad one: nothing is left out then).
  const nearDay = render.realDate(window.near_end), endDay = render.realDate(window.end);
  const nearEnd = nearDay && endDay && nearDay < endDay ? nearDay : null;
  const horizonNear = new Set<unknown>(sources.filter((s: unknown) => isDict(s) && s.horizon === "near").map((s: Doc) => s.name));

  let events: Doc[] = [];
  let origins: string[] = [];
  const hints: [string, Doc][] = [];
  const coverage: [string, string][] = [];
  const missing: string[] = [];
  const reasons = new Map<string, string>();
  const pieces = opts.split ? readSplit(opts.split) : null;
  if (opts.split && pieces === null) return [null, [`split: cannot read ${join(opts.split, "index.json")}`]];
  // the units that were read: the groups, or their pieces when the groups were split
  const units: { id: string; sources: string[] | null }[] = pieces
    ? pieces.map((p) => ({ id: p.id, sources: p.sources }))
    : Object.keys(groups).map((g) => ({ id: g, sources: isDict(groups[g]) && Array.isArray(groups[g].sources) ? groups[g].sources : null }));
  const unitSources = new Map(units.map((u) => [u.id, u.sources]));
  const partOf = new Map((pieces ?? []).map((p) => [p.id, `part of ${p.group}: ${p.sources.join(", ")}; `]));
  for (const { id: group } of units) {
    const groupProblems: string[] = [];
    const data = readGroup(candidates, group, stamp, groupProblems);
    if (data === null) {
      if (missingOk) {
        missing.push(group);
        reasons.set(group, (partOf.get(group) ?? "") + groupProblems.map((p) => { const k = p.indexOf(": "); return k === -1 ? p : p.slice(k + 2); }).join("; "));
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
  if (missingOk && units.length && missing.length === units.length) {
    problems.push("every group is missing: no events to merge");
    problems.push(...missing.map((g) => `missing group: ${g} (${reasons.get(g)})`));
  }
  if (problems.length) return [null, problems];

  const unread = new Set<unknown>();
  for (const group of missing) {
    const listed = unitSources.get(group);
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
    // for finalize's race backstop (farRaces): the index row's label, the name readers write on an event, and its horizon
    if (isDict(s) && render.textOk(s.label)) entry.label = s.label;
    if (isDict(s) && s.horizon === "near") entry.horizon = "near";
    checked.push(entry);
  }

  // What the coming weeks hold, deterministically, before anything else sees the candidates.
  const cut = { hints: 0, races: [] as string[], unplaced: [] as string[], recurring: 0, units: [] as string[] };
  let keptHints = hints;
  if (nearEnd) {
    // Races. This is where the rule that Portugal Running's races stop at the coming weeks is enforced: a candidate from a
    // unit whose sources are ALL horizon "near" and that starts after near_end is left out, by the unit it came from (not by
    // any source name or label the reader wrote). The collector's card filter only saves reading cost and noise, and
    // this still holds when the site changes its card layout and the filter finds nothing to cut. The same race
    // from its town's own unit is a separate candidate and stays. It fails closed: a candidate it cannot place before
    // near_end is left out too, and so is a far one from a unit whose sources it cannot tell (reported, never silent).
    // manual.json is a person's own hand-written list, not a reader's unit, and is not cut.
    const sourceNames = new Set<unknown>(sources.filter(isDict).map((s: Doc) => s.name));
    const nearOnly = new Map<string, boolean>();
    const isNearOnly = (unit: string): boolean => {
      if (!nearOnly.has(unit)) {
        const listed = unitSources.get(unit);
        // a piece always lists its sources (split.ts); a group without a list falls back to the index rows of that group
        const names: unknown[] = Array.isArray(listed) ? listed : sources.filter((s: Doc) => isDict(s) && s.group === unit).map((s: Doc) => s.name);
        const unknown = names.filter((n) => !sourceNames.has(n));
        const near = names.filter((n) => horizonNear.has(n));
        let held = names.length > 0 && near.length === names.length;
        if (!names.length || unknown.length) {
          held = true;
          cut.units.push(`${unit}: ${names.length ? `lists sources not in the index (${unknown.map(pyStr).join(", ")})` : "lists no sources"}; ` +
            "held to the coming weeks as if all were horizon near");
        } else if (near.length && !held) {
          cut.units.push(`${unit}: mixes horizon-near sources (${near.map(pyStr).join(", ")}) with others; its candidates are not held to the coming weeks`);
        }
        nearOnly.set(unit, held);
      }
      return nearOnly.get(unit)!;
    };
    const keepEvents: Doc[] = [];
    const keepOrigins: string[] = [];
    events.forEach((e, i) => {
      const place = origins[i] !== "manual" && isNearOnly(origins[i]!) ? placeStart(e, nearEnd) : "within";
      if (place === "after") {
        cut.races.push(describe(e));
        return;
      }
      if (place === "unknown") {
        cut.unplaced.push(isDict(e) ? describe(e) : `not an object: ${pyRepr(e)}`);
        return;
      }
      keepEvents.push(e);
      keepOrigins.push(origins[i]!);
    });
    events = keepEvents;
    origins = keepOrigins;
    // Hints stay on the coming weeks: the yearly table in sources.md is a hand-kept list.
    keptHints = hints.filter(([, h]) => !startsAfter(h, nearEnd));
    cut.hints = hints.length - keptHints.length;
    for (const e of events) if (isDict(e) && trimRecurring(e, nearEnd)) cut.recurring++;
  }

  const townMinutes = opts.towns ?? loadTowns();
  for (const e of events) if (isDict(e) && e.drive_min === null) fillDrive(e, townMinutes);
  const wStart = render.realDate(window.start), wEnd = render.realDate(window.end);
  const candidateCount = events.length + cut.races.length + cut.unplaced.length;
  const collapsed = collapseDuplicates(events, origins, wStart && wEnd && wStart <= wEnd ? [wStart, wEnd] : null, true);
  events = collapsed.events;
  opts.onStats?.({ candidates: candidateCount, collapsed: collapsed.collapsed, events: events.length });
  origins = collapsed.origins;

  const doc: Doc = {
    generated_at: localIsoNow(now ?? new Date()),
    window,
    origin: ORIGIN,
    sources_checked: checked,
    events,
  };
  const lines = missing.map((group) => `missing group: ${group} (${reasons.get(group)})`);
  if (collapsed.collapsed) {
    lines.push(`already merged: ${collapsed.collapsed} listing(s) with the same title, date and town (the events below are one each):`);
    for (const t of collapsed.titles) lines.push(`  ${t}`);
  }
  if (cut.races.length) {
    lines.push(`races left out (after the coming weeks, ${nearEnd}): ${cut.races.length}`);
    for (const t of cut.races) lines.push(`  ${t}`);
  }
  if (cut.unplaced.length) {
    lines.push(`races left out (no start_date that places them on or before ${nearEnd}: none that is real, or only its month): ${cut.unplaced.length}`);
    for (const t of cut.unplaced) lines.push(`  ${t}`);
  }
  for (const t of cut.units) lines.push(`near-end attribution: ${t}`);
  if (cut.recurring) lines.push(`recurring events with their dates cut to the coming weeks (the rest is in recurrence): ${cut.recurring}`);
  if (cut.hints) lines.push(`hints left out (expected after the coming weeks, ${nearEnd}): ${cut.hints}`);
  lines.push("hints:");
  for (const [group, h] of keptHints) lines.push(`  [${group}] ${describe(h)} | ${truthy(h.caveat) ? pyStr(h.caveat) : ""}`);
  lines.push("coverage:");
  for (const [group, text] of coverage) lines.push(`  ${group}: ${text}`);
  lines.push("problems:");
  for (let text of render.check(doc)) {
    const found = /^events\[(\d+)\]/.exec(text);
    if (found && +found[1]! < origins.length) text += ` [group ${origins[+found[1]!]}]`;
    lines.push("  " + text);
  }
  lines.push("possible duplicates:");
  for (const [i, j, likely] of duplicatePairs(events)) {
    lines.push(`  events[${i}] ${describe(events[i]!)}  <->  events[${j}] ${describe(events[j]!)}${likely ? "  (very likely the same event)" : ""}`);
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

/** One event from events that share an id: the best by preference, the others' sources added and nulls filled.
 *  Returns it with the position (in `group`) of the event that won. */
function collapseGroup(group: Doc[]): [Doc, number] {
  // best first by each event's own sources (sort is stable: ties keep file order)
  const ranked = group.map((e, at) => ({ e, p: preference(e), at }));
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
  return [best, ranked[0]!.at];
}

/**
 * Collapse events with the same id (normalised title | start_date | normalised town) into one, in place of the
 * first of them. An event that fails the page's check is left as it is. `origins` (one entry per event, optional)
 * follows the winners.
 */
export function collapseDuplicates(
  events: Doc[], origins: string[], window: [string, string] | null = null, keepTimes = false,
): { events: Doc[]; origins: string[]; collapsed: number; titles: string[] } {
  const slots: ({ solo: Doc; origin: string } | { id: string })[] = [];
  const byId = new Map<string, { items: Doc[]; origins: string[] }>();
  events.forEach((e, i) => {
    const origin = origins[i] ?? "";
    if (!(isDict(e) && !render.checkEvent(e, window).length)) { slots.push({ solo: e, origin }); return; }
    const id = render.eventId(e);
    const bucket = byId.get(id);
    if (bucket) { bucket.items.push(e); bucket.origins.push(origin); } else {
      byId.set(id, { items: [e], origins: [origin] });
      slots.push({ id });
    }
  });
  const out: Doc[] = [];
  const outOrigins: string[] = [];
  const titles: string[] = [];
  for (const slot of slots) {
    if ("solo" in slot) { out.push(slot.solo); outOrigins.push(slot.origin); continue; }
    const bucket = byId.get(slot.id)!;
    // with keepTimes, listings that state different start times are two showings: left for the editor
    const times = new Set(bucket.items.map((e) => e.start_time).filter((t) => t !== null));
    if (keepTimes && times.size > 1) {
      bucket.items.forEach((e, k) => { out.push(e); outOrigins.push(bucket.origins[k]!); });
      continue;
    }
    const [best, at] = collapseGroup(bucket.items);
    if (bucket.items.length > 1) titles.push(describe(best));
    out.push(best);
    outOrigins.push(bucket.origins[at]!);
  }
  return { events: out, origins: outOrigins, collapsed: events.length - out.length, titles };
}

/** `races`: events left out by farRaces (after the coming weeks, every source horizon near); not in `dropped`. */
type Stats = { events: number; dropped: number; collapsed: number; races: number };

/** A source name or label as finalize matches it: its words, accents, case and punctuation folded ("-" for "–"). */
const sourceKey = (text: unknown): string => typeof text === "string" ? (normalise(text).match(/[a-z0-9]+/g) ?? []).join(" ") : "";

/**
 * finalize's race backstop, the last one: whether an event is a race the coming weeks hold that the editor (or anything
 * after merge) put back. Merge leaves those out by the unit a candidate came from; finalize has only the file, so it
 * goes by the names on the event: every one of its `sources[].name` is the name or the label of a `sources_checked`
 * row with horizon "near" (and of no other row), and placeStart does not put it on or before near_end (it fails closed,
 * as merge's does). Weaker than merge's unit attribution, but in the safe direction: a race its town's source lists too
 * cites that source and stays, and so does an event naming a source no row has. Null (nothing is cut) when the window
 * has no near_end before its end or no row carries a horizon: an old file, or one whose sources_checked lost it.
 */
export function farRaces(doc: Doc): ((e: Doc) => boolean) | null {
  const w = doc.window;
  const ne = isDict(w) ? render.realDate(w.near_end) : null, we = isDict(w) ? render.realDate(w.end) : null;
  if (!(ne && we && ne < we) || !Array.isArray(doc.sources_checked)) return null;
  const near = new Set<string>(), other = new Set<string>();
  for (const s of doc.sources_checked) {
    if (!isDict(s)) continue;
    for (const k of [sourceKey(s.name), sourceKey(s.label)]) if (k) (s.horizon === "near" ? near : other).add(k);
  }
  for (const k of other) near.delete(k);
  if (!near.size) return null;
  return (e) => Array.isArray(e.sources) && e.sources.length > 0 &&
    e.sources.every((s: unknown) => isDict(s) && near.has(sourceKey(s.name))) && placeStart(e, ne) !== "within";
}

/** merge.finalize_document: [events file fixed so render.check passes, stats, report lines] or [null, problems]. */
export function finalizeDocument(doc: unknown): [Doc, Stats, string[]] | [null, string[]] {
  if (!isDict(doc) || !Array.isArray(doc.events)) return [null, ["the file must be a JSON object with an events list"]];
  let window: [string, string] | null = null;
  const w = doc.window;
  if (isDict(w)) {
    const ws = render.realDate(w.start), we = render.realDate(w.end);
    if (ws && we && ws <= we) window = [ws, we];
  }

  const dropped: string[] = [];
  const races: string[] = [];
  const isFarRace = farRaces(doc);
  const valid: Doc[] = [];
  for (const e of doc.events) {
    if (isDict(e) && !render.checkEvent(e, window).length) {
      if (isFarRace?.(e)) races.push(describe(e));
      else valid.push(e);
    } else {
      const title = isDict(e) ? e.title_pt ?? null : null;
      const start = isDict(e) ? e.start_date ?? null : null;
      dropped.push(`${render.textOk(title) ? title : "untitled"} (${pyStr(start)})`);
    }
  }
  const report: string[] = [];
  if (races.length) {
    report.push(`races left out (every source horizon near, and not on or before the coming weeks' end, ${pyStr((w as Doc).near_end)}): ${races.length}`);
    for (const t of races) report.push(`  ${t}`);
  }

  const kept = collapseDuplicates(valid, [], window).events;
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
  return [out, { events: kept.length, dropped: dropped.length, collapsed, races: races.length }, report];
}

/** The counts file is only for the status page: a failed write is a warning, never a failed merge. */
function writeStats(path: string, stats: object): void {
  try {
    writeFileSync(path, JSON.stringify(stats) + "\n", "utf8");
  } catch (err) {
    console.error(`warning: cannot write ${path}: ${(err as Error).message}`);
  }
}

/** merge.finalize: in place on a file; exit code. */
export function finalize(path: string, statsPath?: string): number {
  let doc: unknown;
  try {
    doc = JSON.parse(readText(path));
  } catch (err) {
    console.log(`cannot read ${path}: ${(err as Error).message}`);
    return 2;
  }
  const [out, result, report] = finalizeDocument(doc);
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
  if (statsPath) writeStats(statsPath, result);
  console.log(`finalized ${path}: ${result.events} events, ${result.dropped} dropped, ${result.collapsed} duplicates collapsed, ${result.races} far races left out`);
  for (const line of report!) console.log(line);
  return 0;
}

const USAGE = "usage: bun src/cli/merge.ts [-h] [--missing-ok] [--split DIR] [--finalize EVENTS_JSON] [--stats FILE] [collected] [candidates] [out]";

/** merge.main(argv, now): exit code. */
export function main(argv: string[], now?: Date): number {
  const args = parseArgs({
    prog: "bun src/cli/merge.ts", usage: USAGE,
    positionals: [{ name: "collected", optional: true }, { name: "candidates", optional: true }, { name: "out", optional: true }],
    flags: ["--missing-ok"],
    values: [{ name: "--finalize" }, { name: "--split" }, { name: "--stats" }],
  }, argv);
  if (args === null) return 2;
  if (args.help) return 0;
  const [collected, candidates, out] = args.positionals;
  const fin = args.values.get("--finalize");
  const fail = (msg: string): number => { console.error(USAGE); console.error(`bun src/cli/merge.ts: error: ${msg}`); return 2; };
  if (fin) {
    if (collected || args.flags.has("--missing-ok") || args.values.get("--split")) return fail("--finalize takes no folders, no --missing-ok and no --split");
    return finalize(fin, args.values.get("--stats"));
  }
  if (!(collected && candidates && out)) return fail("collected, candidates and out are required");
  const split = args.values.get("--split");
  let stats: MergeStats | null = null;
  const [doc, lines] = merge(collected, candidates, now, args.flags.has("--missing-ok"), { ...(split ? { split } : {}), onStats: (s) => { stats = s; } });
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
  const statsPath = args.values.get("--stats");
  if (statsPath && stats) writeStats(statsPath, stats);
  console.log(`wrote ${out}: ${doc.events.length} events`);
  for (const line of lines) console.log(line);
  return 0;
}
