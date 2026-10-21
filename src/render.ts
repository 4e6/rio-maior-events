// Port of the former render.py. Owned by T11. Event ids are sha1 of the same key as Python's, built with the exact
// casefold of T1 (foldKey), so they match Python's. Real dates are "YYYY-MM-DD" strings; they compare as strings.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./cli-args.ts";
import { cpCompare, foldKey, pyRepr, pyStrip } from "./py/str.ts";

type Doc = Record<string, any>;

const ASSETS = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "assets");

export const CATEGORIES: readonly string[] = [
  "music", "theatre", "cinema", "festival", "market", "sport",
  "exhibition", "kids", "food", "nature", "workshop", "other",
];
export const KINDS = ["single", "multi_day", "ongoing", "recurring"] as const;
export const MAX_PROBLEMS = 20;
const MAX_MULTI_DAY = 7;

export const EVENT_KEYS = [
  "title_pt", "title_en", "category", "kind", "start_date", "end_date",
  "start_time", "dates", "recurrence", "date_tbc", "venue", "town",
  "drive_min", "price", "kids", "description_en", "sources", "confidence",
  "caveat",
] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

// ---- small Python-semantics helpers shared with merge.ts and check_candidates.ts ----

export const isDict = (v: unknown): v is Doc => typeof v === "object" && v !== null && !Array.isArray(v);
export const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Python truthiness of a JSON value. */
export function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (isDict(v)) return Object.keys(v).length > 0;
  return true;
}

/** str(v) as used by "%s": None, True/False, strings as they are, containers as reprs. */
export function pyStr(v: unknown): string {
  return typeof v === "string" ? v : pyRepr(v);
}

/** json.dumps(v, ensure_ascii=False) for a scalar or small value. */
export function dumps(v: unknown): string {
  return JSON.stringify(v);
}

/** Days since 1970-01-01 of an ISO date already known to be real. */
export function dayNumber(iso: string): number {
  return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
}

export function normalise(text: string): string {
  return foldKey(text, "NFKD");
}

export function eventId(event: Doc): string {
  const key = normalise(event.title_pt) + "|" + event.start_date + "|" + normalise(event.town);
  return createHash("sha1").update(key, "utf8").digest("hex").slice(0, 10);
}

/** The date as "YYYY-MM-DD" when text is a real calendar date, else null. */
export function realDate(text: unknown): string | null {
  if (typeof text !== "string" || !DATE.test(text)) return null;
  const y = +text.slice(0, 4), m = +text.slice(5, 7), d = +text.slice(8, 10);
  if (y < 1 || m < 1 || m > 12 || d < 1) return null;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
  return d <= dim ? text : null;
}

export function realMonth(text: unknown): boolean {
  return typeof text === "string" && MONTH.test(text) && +text.slice(5, 7) >= 1 && +text.slice(5, 7) <= 12;
}

export function textOk(value: unknown): boolean {
  return typeof value === "string" && pyStrip(value) !== "";
}

export function checkEvent(e: Doc, window: readonly [string, string] | null = null): string[] {
  const bad: string[] = [];
  for (const key of EVENT_KEYS) if (!has(e, key)) bad.push("missing " + key);
  for (const key of Object.keys(e)) if (!(EVENT_KEYS as readonly string[]).includes(key) && key !== "id") bad.push("unknown field " + key);
  if (bad.length) return bad;
  for (const key of ["title_pt", "title_en", "town"]) {
    if (!textOk(e[key])) bad.push(key + " must be a non-empty string");
  }
  if (!CATEGORIES.includes(e.category)) bad.push("category must be one of " + CATEGORIES.join(", "));
  if (!(KINDS as readonly unknown[]).includes(e.kind)) bad.push("kind must be one of " + KINDS.join(", "));
  if (typeof e.date_tbc !== "boolean") bad.push("date_tbc must be true or false");
  if (e.start_time !== null && !(typeof e.start_time === "string" && TIME.test(e.start_time))) {
    bad.push("start_time must be HH:MM or null");
  }
  const tbc = e.date_tbc === true;
  const start = realDate(e.start_date);
  if (tbc) {
    if (!(realMonth(e.start_date) || start)) bad.push("start_date must be YYYY-MM or YYYY-MM-DD, got " + pyRepr(e.start_date));
    for (const key of ["end_date", "start_time", "dates"]) {
      if (e[key] !== null) bad.push(key + " must be null while date_tbc is true");
    }
    if (e.kind === "recurring") bad.push("a recurring event has dates; with date_tbc true use another kind");
    if (window && typeof e.start_date === "string" && (start || realMonth(e.start_date))) {
      const n = e.start_date.length;
      if (!(cpCompare(window[0].slice(0, n), e.start_date) <= 0 && cpCompare(e.start_date, window[1].slice(0, n)) <= 0)) {
        bad.push(`start_date ${e.start_date} is outside the window ${window[0]} to ${window[1]}`);
      }
    }
  } else {
    if (start === null) bad.push("start_date must be a real date YYYY-MM-DD, got " + pyRepr(e.start_date));
    const end = e.end_date !== null ? realDate(e.end_date) : null;
    if (e.end_date !== null && end === null) bad.push("end_date must be a real date YYYY-MM-DD or null, got " + pyRepr(e.end_date));
    const kind = e.kind;
    if (kind === "single" && e.end_date !== null) bad.push("a single event has end_date null");
    if (kind === "multi_day" && (end === null || (start && end <= start))) {
      bad.push("a multi_day event needs an end_date after start_date");
    } else if (kind === "multi_day" && start && dayNumber(end!) - dayNumber(start) >= MAX_MULTI_DAY) {
      bad.push(`a multi_day event spans at most ${MAX_MULTI_DAY} days; use ongoing`);
    }
    if (kind === "ongoing" && (end === null || (start && end < start))) {
      bad.push("an ongoing event needs an end_date, not before start_date");
    }
    if (kind === "recurring") {
      const dates = e.dates;
      if (dates !== null && !(Array.isArray(dates) && dates.every((d) => realDate(d)))) {
        bad.push("dates must be a list of real dates YYYY-MM-DD or null");
      }
      if (!truthy(dates) && !textOk(e.recurrence)) bad.push("a recurring event needs dates or a recurrence");
    } else if (e.dates !== null) {
      bad.push("dates is only for recurring events");
    }
    if (window && start && !((kind === "multi_day" || kind === "ongoing") && end === null)) {
      const last = end || start;
      if (last < window[0] || start > window[1]) {
        bad.push(`the event (${start} to ${last}) is entirely outside the window ${window[0]} to ${window[1]}; drop it`);
      }
      if (kind === "recurring" && Array.isArray(e.dates)) {
        for (const d of e.dates) {
          const day = realDate(d);
          if (day && !(window[0] <= day && day <= window[1])) {
            bad.push(`dates has ${d}, outside the window ${window[0]} to ${window[1]}`);
          }
        }
      }
    }
  }
  for (const key of ["venue", "description_en", "recurrence"]) {
    if (e[key] !== null && typeof e[key] !== "string") bad.push(key + " must be a string or null");
  }
  const d = e.drive_min;
  if (d !== null && !(typeof d === "number" && Number.isInteger(d) && d >= 0)) {
    bad.push("drive_min must be a whole number of minutes or null");
  }
  const p = e.price;
  if (p !== null && !(
    isDict(p) && Object.keys(p).length === 2 && has(p, "free") && has(p, "text")
    && typeof p.free === "boolean" && textOk(p.text)
  )) {
    bad.push("price must be null or {free: true/false, text: non-empty}");
  }
  if (typeof e.kids !== "boolean") bad.push("kids must be true or false");
  const s = e.sources;
  if (!(Array.isArray(s) && s.length)) {
    bad.push("sources needs at least one {name, url}");
  } else if (!s.every((x) => isDict(x) && textOk(x.name) && typeof x.url === "string")) {
    bad.push("every source needs a name and a url string");
  }
  if (e.confidence !== "high" && e.confidence !== "low") {
    bad.push("confidence must be high or low");
  } else if (e.confidence === "low" && !textOk(e.caveat)) {
    bad.push("low confidence needs a caveat saying what to check");
  } else if (e.caveat !== null && typeof e.caveat !== "string") {
    bad.push("caveat must be a string or null");
  }
  return bad;
}

export function check(data: unknown): string[] {
  if (!isDict(data)) return ["the file must hold one JSON object"];
  const problems: string[] = [];
  for (const key of ["generated_at", "window", "origin", "sources_checked", "events"]) {
    if (!has(data, key)) problems.push("missing " + key);
  }
  if (problems.length) return problems;
  if (!(typeof data.generated_at === "string" && STAMP.test(data.generated_at))) {
    problems.push("generated_at must be an ISO date and time, like 2026-10-20T08:15:00+01:00");
  }
  const w = data.window;
  const ws = isDict(w) ? realDate(w.start) : null;
  const we = isDict(w) ? realDate(w.end) : null;
  let window: [string, string] | null = null;
  if (ws === null || we === null) problems.push("window needs real start and end dates, YYYY-MM-DD");
  else if (we < ws) problems.push("window.end is before window.start");
  else window = [ws, we];
  if (!textOk(data.origin)) problems.push("origin must be a non-empty string");
  if (has(data, "note") && typeof data.note !== "string") problems.push("note must be a string");
  const sc = data.sources_checked;
  if (!Array.isArray(sc) || !sc.every((x) => isDict(x) && textOk(x.name) && typeof x.url === "string" && typeof x.ok === "boolean")) {
    problems.push("sources_checked must be a list of {name, url, ok}");
  }
  const events = data.events;
  if (!Array.isArray(events)) return [...problems, "events must be a list"];
  const seen = new Map<string, number>();
  events.forEach((e, i) => {
    if (!isDict(e)) { problems.push(`events[${i}]: must be an object`); return; }
    const label = `events[${i}] ${dumps(has(e, "title_pt") ? e.title_pt : "")}`;
    const found = checkEvent(e, window);
    for (const m of found) problems.push(label + ": " + m);
    if (!found.length) {
      const eid = eventId(e);
      if (seen.has(eid)) problems.push(`${label}: same event as events[${seen.get(eid)}] (same title, date and town); merge them`);
      seen.set(eid, i);
    }
  });
  return problems;
}

export function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : "";
}

export function pageData(data: Doc): Doc {
  const out: Doc = {};
  for (const k of ["generated_at", "window", "origin"]) out[k] = data[k];
  if (truthy(data.note)) out.note = data.note;
  out.sources_checked = data.sources_checked.map((s: Doc) => ({ ...s, url: safeUrl(s.url) }));
  out.events = data.events.map((e: Doc) => {
    const item: Doc = { id: eventId(e) };
    for (const k of EVENT_KEYS) item[k] = e[k];
    item.sources = e.sources.map((s: Doc) => ({ name: s.name, url: safeUrl(s.url) }));
    return item;
  });
  return out;
}

export function embed(data: Doc): string {
  return JSON.stringify(data, null, 1)
    .replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

/** html.escape(str(text), quote=True) */
export function x(text: unknown): string {
  return pyStr(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
}

function plainList(data: Doc): string {
  const rows: Doc[] = [...data.events];
  rows.sort((a, b) =>
    (Number(a.date_tbc) - Number(b.date_tbc)) || cpCompare(a.start_date, b.start_date)
    || cpCompare(a.start_time || "", b.start_time || "") || cpCompare(a.title_pt, b.title_pt));
  const items: string[] = [];
  for (const e of rows) {
    let when: string;
    if (e.date_tbc) when = "Date to be confirmed (" + e.start_date + ")";
    else if (e.kind === "recurring") when = truthy(e.recurrence) ? e.recurrence : e.dates.join(", ");
    else if (truthy(e.end_date)) when = e.start_date + " to " + e.end_date;
    else when = e.start_date;
    if (truthy(e.start_time)) when += " " + e.start_time;
    const title = x(e.title_pt) + (e.title_en === e.title_pt ? "" : " / " + x(e.title_en));
    const src = e.sources[0];
    const href = safeUrl(src.url);
    const link = href ? `<a href="${x(href)}">${x(src.name)}</a>` : x(src.name);
    items.push(`<li><strong>${x(when)}</strong> ${title}, ${x(e.town)}. ${link}</li>`);
  }
  return items.join("\n");
}

export function build(data: Doc, css: string, js: string): string {
  const values: Record<string, string> = {
    css,
    origin: x(data.origin),
    window: `${pyStr(data.window.start)} to ${pyStr(data.window.end)}`,
    plain: plainList(data),
    data: embed(pageData(data)),
    js,
  };
  return PAGE.replace(/\{(css|origin|window|plain|data|js)\}/g, (_m, k: string) => values[k]!);
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>What's on around Rio Maior</title>
<style>
{css}</style>
</head>
<body>
<noscript><div class="plain"><h1>What's on around {origin}</h1><p>{window}. This page draws its calendar with a script; the events are listed here by date. <a href="status.html">Build status</a>.</p><ul>
{plain}
</ul></div></noscript>
<div class="page">
  <header class="masthead">
    <div>
      <h1 id="title">What's on around {origin}</h1>
      <p class="meta" id="meta"></p>
    </div>
    <button class="theme-btn" id="theme-btn" type="button" aria-label="Colour theme"></button>
  </header>
  <div id="notice"></div>
  <div class="strip-wrap" id="strip-wrap"><nav class="strip" id="strip" aria-label="Jump to day"></nav></div>
  <div class="layout">
    <aside class="rail" id="rail" aria-label="Calendar"></aside>
    <main id="main">
      <section class="filters" id="filters" aria-label="Filters"></section>
      <div id="blocks"></div>
      <div id="list"></div>
      <div id="tbc"></div>
      <footer class="foot" id="foot"></footer>
    </main>
  </div>
</div>
<script type="application/json" id="events-data">
{data}
</script>
<script>
{js}</script>
</body>
</html>
`;

const USAGE = "usage: bun src/cli/render.ts [-h] path out";

export function main(argv: string[]): number {
  const args = parseArgs({
    prog: "bun src/cli/render.ts", usage: USAGE,
    positionals: [{ name: "path" }, { name: "out" }],
  }, argv);
  if (args === null) return 2;
  if (args.help) return 0;
  const [path, out] = args.positionals as [string, string];

  let css: string, js: string;
  try {
    css = readText(join(ASSETS, "page.css"));
    js = readText(join(ASSETS, "page.js"));
  } catch (error) {
    console.error("could not render: the page's own assets are missing (" + (error as Error).message + ")");
    return 2;
  }
  if (css.toLowerCase().includes("</style") || js.toLowerCase().includes("</script")) {
    console.error("could not render: an asset would close its own element");
    return 2;
  }
  let data: unknown;
  try {
    data = JSON.parse(readText(path));
  } catch (error) {
    console.error("could not read " + path + ": " + (error as Error).message);
    return 2;
  }
  const problems = check(data);
  if (problems.length) {
    console.error("could not render " + path + ": " + problems.length + " problems");
    for (const line of problems.slice(0, MAX_PROBLEMS)) console.error("  " + line);
    if (problems.length > MAX_PROBLEMS) console.error(`  ... and ${problems.length - MAX_PROBLEMS} more`);
    return 2;
  }
  const doc = data as Doc;
  try {
    writeFileSync(out, build(doc, css, js), "utf8");
  } catch (error) {
    console.error("could not write " + out + ": " + (error as Error).message);
    return 2;
  }
  console.log(`wrote ${out}: ${doc.events.length} events, from ${pyStr(doc.window.start)} to ${pyStr(doc.window.end)}`);
  return 0;
}

/** Strict UTF-8 read, like Path.read_text(encoding="utf-8"). */
export function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
}
