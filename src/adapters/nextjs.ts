// Port of scripts/adapters/nextjs.py. Owned by T8. The JSON helpers it needs (a value-end scanner for
// raw_decode, a string-literal decoder allowing raw control characters) live here, not in src/py/json.ts.
import type { Adapter, Detail, MadeItem, Page, ParseResult, Request, Source, Window } from "./types.ts";
import {
  EXCERPT_CAP, TEXT_CAP, decode, extractDetail, isoDay, keepWindow, lisbonTime, makeItem, plain, stampOf, visibleText,
} from "./common.ts";
import { PY_WS, cpCompare, cpLen, pyStrip } from "../py/str.ts";
import { urljoin, urlsplit } from "../url.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const truthy = (v: unknown): boolean =>
  !(v === null || v === undefined || v === false || v === 0 || v === "" || Number.isNaN(v) ||
    (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0));

const WS = `[${PY_WS}]`;
const WS_RUNS = new RegExp(`${WS}+`, "gu");

// Python's `.` excludes only "\n"; JS's also excludes \r, U+2028 and U+2029.
const NEXT_CHUNK_RE = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\[^\n])*)"\]\)/g;

const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

/** json.loads('"%s"' % chunk, strict=False): the body of a string literal; raw control characters are allowed,
 *  a bad escape throws. */
export function decodeLenientString(body: string): string {
  let out = "";
  let at = 0;
  while (at < body.length) {
    const slash = body.indexOf("\\", at);
    if (slash < 0) return out + body.slice(at);
    out += body.slice(at, slash);
    const kind = body[slash + 1];
    if (kind === undefined) throw new Error("Unterminated string");
    if (kind === "u") {
      const hex = body.slice(slash + 2, slash + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error("Invalid \\uXXXX escape");
      out += String.fromCharCode(parseInt(hex, 16));
      at = slash + 6;
    } else {
      const ch = ESCAPES[kind];
      if (ch === undefined) throw new Error("Invalid \\escape");
      out += ch;
      at = slash + 2;
    }
  }
  return out;
}

/** The end of the JSON value that starts at `at` (json.JSONDecoder().raw_decode's end index). The value itself is
 *  then read by JSON.parse; a malformed value throws there. NaN/Infinity (a Python extension) are not read. */
export function scanValueEnd(text: string, at: number): number {
  const first = text[at];
  if (first === "{" || first === "[") {
    let depth = 0;
    for (let i = at; i < text.length; i++) {
      const c = text[i]!;
      if (c === '"') {
        i++;
        while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
        if (i >= text.length) throw new Error("Unterminated string");
      } else if (c === "{" || c === "[") {
        depth++;
      } else if (c === "}" || c === "]") {
        if (--depth === 0) return i + 1;
      }
    }
    throw new Error("Unterminated container");
  }
  if (first === '"') {
    let i = at + 1;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    if (i >= text.length) throw new Error("Unterminated string");
    return i + 1;
  }
  const m = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(at, at + 400));
  if (!m) throw new Error("Expecting value");
  return at + m[0].length;
}

/** raw_decode(data, at) after skipping whitespace as `lstrip` does: the value. */
function decodeValueAt(data: string, at: number): unknown {
  const rest = data.slice(at);
  at += rest.length - rest.replace(new RegExp(`^${WS}+`, "u"), "").length;
  return JSON.parse(data.slice(at, scanValueEnd(data, at)));
}

/** nextjs.payload: the page's streamed data as one string. */
function payload(page: string): string {
  let out = "";
  for (const m of page.matchAll(NEXT_CHUNK_RE)) out += decodeLenientString(m[1]!);
  return out;
}

/** nextjs.parse_nextjs: (items in window, note). */
export function parseNextjs(page: string, url: string, window: Window | null): { items: MadeItem[]; note: string | null } {
  const data = payload(page);
  let at = data.indexOf('"eventsList":');
  if (at < 0) throw new Error("no eventsList in the page data (layout may have changed)");
  at += '"eventsList":'.length;
  const value = decodeValueAt(data, at);
  const events = isObj(value) ? value["items"] : null;
  if (!Array.isArray(events)) throw new Error("eventsList has no items array");
  const parts = urlsplit(url);
  const site = `${parts.scheme}://${parts.netloc}/`;
  const items: MadeItem[] = [];
  for (const event of events) {
    if (!isObj(event) || !truthy(event["title"])) continue;
    const link = event["link"];
    items.push(makeItem(event["title"], isoDay(event["startDate"]), isoDay(event["endDate"]), event["location"],
      typeof link === "string" && link ? urljoin(site, link) : null));
  }
  let note: string | null = null;
  const pages = (value as Obj)["totalPages"];
  const count = (value as Obj)["count"];
  if (typeof pages === "number" && Number.isInteger(pages) && pages > 1) {
    note = `page 1 of ${pages}${typeof count === "number" && Number.isInteger(count) ? `, ${count} events in all` : ""}; later events are not in this file`;
  }
  return { items: window ? keepWindow(items, window) : items, note };
}

/** nextjs.module_data: the event object (the one with a `description`) of an event page's modules. */
function moduleData(page: string): Obj {
  const data = payload(page);
  const at = data.indexOf('"modules":');
  if (at < 0) throw new Error("no modules in the page data");
  const modules = decodeValueAt(data, at + '"modules":'.length);
  for (const module of Array.isArray(modules) ? modules : []) {
    const found = isObj(module) ? module["data"] : null;
    if (isObj(found) && hasOwn(found, "description")) return found;
  }
  throw new Error("no module with a description");
}

/** nextjs.resolve: a string value of the payload; a long one is streamed as a text row ("21:T615,<text>", the
 *  length in hex UTF-8 bytes) and the value is "$21". */
function resolve(data: string, value: unknown): unknown {
  const reference = typeof value === "string" ? /^\$([0-9a-f]+)$/.exec(value) : null;
  if (!reference) return value;
  const row = new RegExp(`(?:^|\\n)${reference[1]}:T([0-9a-f]+),`).exec(data);
  if (!row) return null;
  const bytes = new TextEncoder().encode(data.slice(row.index + row[0].length)).subarray(0, parseInt(row[1]!, 16));
  // decode("utf-8", "ignore"): a character cut by the length loses its partial bytes.
  let end = bytes.length;
  let lead = end - 1;
  while (lead >= 0 && (bytes[lead]! & 0xc0) === 0x80) lead--;
  if (lead >= 0) {
    const b = bytes[lead]!;
    const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    if (end - lead < need) end = lead;
  }
  return new TextDecoder("utf-8").decode(bytes.subarray(0, end));
}

const ISO_MOMENT_RE =
  /^([0-9]{4})-?([0-9]{2})-?([0-9]{2})(?:[T ]([0-9]{2})(?::?([0-9]{2}))?(?::?([0-9]{2})(?:[.,]([0-9]+))?)?(Z|[+-][0-9]{2}(?::?[0-9]{2}(?::?[0-9]{2})?)?)?)?$/;

/** datetime.fromisoformat (the forms the sites send) as epoch milliseconds in UTC; naive is read as UTC; null if bad. */
function isoMoment(value: string): number | null {
  const m = ISO_MOMENT_RE.exec(value.replaceAll("Z", "+00:00"));
  if (!m) return null;
  const [year, month, day] = [+m[1]!, +m[2]!, +m[3]!];
  const [hour, minute, second] = [+(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (year < 1 || month < 1 || month > 12 || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  let offset = 0;
  const tz = m[8];
  if (tz && tz !== "+00:00") {
    const t = /^([+-])([0-9]{2})(?::?([0-9]{2}))?(?::?([0-9]{2}))?$/.exec(tz)!;
    const [h, mi, s] = [+t[2]!, +(t[3] ?? 0), +(t[4] ?? 0)];
    if (h > 23 || mi > 59 || s > 59) return null;
    offset = (t[1] === "-" ? -1 : 1) * ((h * 60 + mi) * 60 + s) * 1000;
  }
  const date = new Date(Date.UTC(2000, month - 1, day, hour, minute, second));
  date.setUTCFullYear(year);
  return date.getTime() - offset;
}

/** nextjs.local_stamp: "YYYY-MM-DD HH:MM" Lisbon time of a UTC ISO moment, the day alone at local midnight;
 *  null if unreadable. */
export function localStamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = isoMoment(value);
  return ms === null ? null : stampOf(lisbonTime(ms));
}

const CLOCK = "([0-9]{1,2})(?:" + WS + "*(?:h|horas?)(?:" + WS + "*([0-9]{2}))?|:([0-9]{2}))";
const PREFIX = `((?:a partir d?as|[àa]s|das)${WS}+)?`;
const ONE_TIME_RE = new RegExp(`^${PREFIX}${CLOCK}\\.?$`, "iu");
const RANGE_RE = new RegExp(`^${PREFIX}${CLOCK}${WS}*(?:[àa]s|a|-|–)${WS}*${CLOCK}\\.?$`, "iu");
const EARLIEST_BARE_HOUR = 6;

/** nextjs.clocks: ["HH:MM"] or ["HH:MM", "HH:MM"] when the schedule says one time of day or a range of two and
 *  nothing else; [] for anything vaguer ("Todo o dia") or a bare duration ("2h", "1 hora"). A time of day has a
 *  prefix ("às", "das", "a partir das"), minutes ("15h30", "21:30") or an hour of 6 or more ("15 horas", "10h"). */
export function clocks(schedule: unknown): string[] {
  const text = typeof schedule === "string" ? pyStrip(schedule.replace(WS_RUNS, " ")) : "";
  const match = ONE_TIME_RE.exec(text) ?? RANGE_RE.exec(text);
  if (!match) return [];
  const found: string[] = [];
  for (let at = 2; at < match.length; at += 3) {
    const hour = +match[at]!;
    const minutes = match[at + 1] || match[at + 2];
    if (hour > 23 || +(minutes || 0) > 59) return [];
    if (!(match[1] || minutes || hour >= EARLIEST_BARE_HOUR)) return [];
    found.push(`${String(hour).padStart(2, "0")}:${String(+(minutes || 0)).padStart(2, "0")}`);
  }
  return found;
}

function withSchedule(start: string | null, end: string | null, schedule: string): [string | null, string | null] {
  const times = clocks(schedule);
  if (!times.length || !start || cpLen(start) !== 10 || (end && end.slice(0, 10) !== start)) return [start, end];
  if (times.length === 2 && (end === null || end === start)) end = `${start} ${times[1]}`;
  return [`${start} ${times[0]}`, end];
}

/** nextjs.excerpt_of: the description's text, cut at a space to about EXCERPT_CAP characters. */
export function excerptOf(description: unknown): string | null {
  if (typeof description !== "string") return null;
  let text = visibleText(description, Infinity).text;
  const cps = Array.from(text);
  if (cps.length > EXCERPT_CAP) {
    const head = cps.slice(0, EXCERPT_CAP);
    const cut = Math.max(head.lastIndexOf(" "), head.lastIndexOf("\n"));
    text = (cut > EXCERPT_CAP >> 1 ? head.slice(0, cut) : head).join("");
  }
  return pyStrip(text) || null;
}

function details(_source: Source, pages: Page[], _window: Window): Detail[] {
  const found: Detail[] = [];
  for (const page of pages) {
    try {
      const sourcePage = decode(page.body, page.contentType);
      const data = moduleData(sourcePage);
      let start = localStamp(data["startDate"]);
      let end = localStamp(data["endDate"]);
      if (end === start) end = null;
      const streamed = payload(sourcePage);
      const raw = resolve(streamed, data["schedule"]);
      const schedule = typeof raw === "string" ? pyStrip(raw.replace(WS_RUNS, " ")) : "";
      [start, end] = withSchedule(start, end, schedule);
      let excerpt = excerptOf(resolve(streamed, data["description"]));
      if (schedule) excerpt = `Horário: ${schedule}${excerpt ? "\n" + excerpt : ""}`;
      found.push({ url: page.url, title: plain(data["title"]), start, end, venue: null, excerpt });
    } catch {
      try {
        found.push(extractDetail(page));
      } catch {
        continue;
      }
    }
  }
  return found;
}

export const nextjs: Adapter = {
  parse(source: Source, pages: Page[], window: Window): ParseResult {
    const page = decode(pages[0]!.body, pages[0]!.contentType);
    const parsed = parseNextjs(page, source.url, window);
    const items = parsed.items;
    let note = parsed.note;
    const { text, truncated } = visibleText(page, source.cap ?? TEXT_CAP);
    if (!items.length) note = ["0 items in window", ...(note ? [note] : [])].join("; ");
    const follow: Request[] = items
      .map((item, i) => [item, i] as const)
      .sort((a, b) => cpCompare(a[0].start ?? "", b[0].start ?? "") || a[1] - b[1])
      .filter(([item]) => item.url)
      .map(([item]) => ({ url: item.url!, data: null }));
    return { items, text, truncated, past: [], note, follow };
  },
  details,
};
