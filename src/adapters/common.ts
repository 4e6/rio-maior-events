// What every adapter shares. Port of scripts/adapters/common.py. Owned by T6 (xmlRoot's guards and the
// decode wrapper are small; T6 does them too). Lengths and caps count code points (src/py/str.ts).
//
// Regex translation rules used below (research-port.md 1.8): Python `\s` is PY_WS; `\w` is [\p{L}\p{N}_] and
// `\b` is written as a lookaround on that class; `\d` is \p{Nd}; `$` matches only at the very end.
import type { Detail, JsonLdItem, MadeItem, Page, Source, Window } from "./types.ts";
import { AdapterError } from "./types.ts";
import { lisbonTime as lisbonTimeOf, type LisbonTime } from "../py/datetime.ts";
import { XmlParseError, fromString, type Element } from "../py/xml.ts";
import { HTMLParser, type Attr } from "../py/htmlparser.ts";
import { latin1, pyDecode } from "../py/codecs.ts";
import { unescape } from "../py/html_unescape.ts";
import { PY_WS, casefold, cpCompare, cpLen, cpSlice, firstCp, isalnum, isdigit, lastCp, pyStrip } from "../py/str.ts";
import { bareHost, cleanUrl, unquote, urlsplit } from "../url.ts";

export { AdapterError } from "./types.ts";
export type { Page, Request } from "./types.ts";
export { cleanUrl, sameSite } from "../url.ts";
export { lisbonTime } from "../py/datetime.ts";

export const TEXT_CAP = 30000;
export const DESCRIPTION_CAP = 300;
export const MIN_TEXT = 200;
export const EXCERPT_CAP = 800;
/** common.MARK: U+E000 starts a marker line while the text is built. */
export const MARK = "";

const SKIP_TAGS = new Set(["script", "style", "noscript", "svg", "template"]);
// Page chrome, dropped unless inside an article or main, where a card keeps its title and date in a header.
const CHROME_TAGS = new Set(["nav", "header", "footer"]);
const CONTENT_TAGS = new Set(["article", "main"]);
// Inline tags that can mark up part of a word or number: they part two words only when one ends and the next
// begins at once.
const PHRASING_TAGS = new Set(["b", "strong", "i", "em", "u", "sup", "sub", "small", "mark", "abbr", "s"]);
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "source", "track", "wbr"]);
const BLOCK_TAGS = new Set(["address", "article", "aside", "blockquote", "br", "dd", "div", "dl",
  "dt", "fieldset", "figcaption", "figure", "form", "h1", "h2", "h3",
  "h4", "h5", "h6", "hr", "li", "main", "ol", "p", "pre", "section",
  "table", "td", "th", "tr", "ul"]);

// Python `\s` (str patterns) and `\w`, as pieces of a character class.
const S = PY_WS;
const W = "\\p{L}\\p{N}_";
const WS_RUNS = new RegExp(`[${S}]+`, "gu");

function hasOwn(o: object, key: string): boolean { return Object.prototype.hasOwnProperty.call(o, key); }

type Anchor = { index: number; url: string; title: string };

class TextParser extends HTMLParser {
  anchor: Anchor | null = null;
  skip = 0;
  content = 0;
  chrome: boolean[] = [];
  parts: string[] = [];
  gap = false;
  closed = false;

  constructor(readonly base: string | null | undefined, readonly links: RegExp | null | undefined) {
    super({ convertCharrefs: true });
  }

  override handle_starttag(tag: string, attrs: Attr[]): void {
    if (VOID_TAGS.has(tag)) {
      if (BLOCK_TAGS.has(tag)) this.parts.push("\n");
      return;
    }
    if (CONTENT_TAGS.has(tag)) this.content += 1;
    if (CHROME_TAGS.has(tag)) {
      this.chrome.push(!this.content);
      this.skip += this.content ? 0 : 1;
    } else if (SKIP_TAGS.has(tag)) {
      this.skip += 1;
    } else if (tag === "a" && this.links != null) {
      // dict(attrs).get: the last duplicate wins
      let href: string | null | undefined;
      let title: string | null | undefined;
      for (const [k, v] of attrs) {
        if (k === "href") href = v;
        if (k === "title") title = v;
      }
      this.openAnchor(href, title);
    }
    this.boundary(tag);
  }

  private openAnchor(href: string | null | undefined, title: string | null | undefined): void {
    this.closeAnchor();
    const url = cleanUrl(this.base, href);
    if (this.skip || !url || bareHost(url) !== bareHost(this.base || "")) return;
    const parts = urlsplit(url);
    if (this.links!.test(parts.path + (parts.query ? "?" + parts.query : ""))) {
      this.anchor = { index: this.parts.length, url, title: pyStrip((title || "").replace(WS_RUNS, " ")) };
    }
  }

  /** Writes the marker of the open anchor before its text. An anchor with no text or only digits is marked only
   *  when it has a title attribute, which is written on the line after the marker. */
  closeAnchor(): void {
    if (this.anchor === null) return;
    const { index, url, title } = this.anchor;
    this.anchor = null;
    const label = this.parts.slice(index).join("").replace(WS_RUNS, "");
    if (label && !isdigit(label)) {
      this.parts.splice(index, 0, "\n", MARK + url, "\n");
    } else if (title) {
      this.parts.splice(index, 0, "\n", MARK + url, "\n", title.replaceAll(MARK, ""), "\n");
    }
  }

  override handle_startendtag(tag: string, _attrs: Attr[]): void {
    if (BLOCK_TAGS.has(tag)) this.parts.push("\n");
  }

  override handle_endtag(tag: string): void {
    if (CONTENT_TAGS.has(tag)) this.content = Math.max(0, this.content - 1);
    if (CHROME_TAGS.has(tag)) {
      if (this.chrome.length && this.chrome.pop()) this.skip = Math.max(0, this.skip - 1);
    } else if (SKIP_TAGS.has(tag)) {
      this.skip = Math.max(0, this.skip - 1);
    } else if (tag === "a") {
      this.closeAnchor();
    }
    this.boundary(tag, true);
  }

  private boundary(tag: string, end = false): void {
    if (BLOCK_TAGS.has(tag)) this.parts.push("\n");
    else if (!PHRASING_TAGS.has(tag) || (this.closed && !end)) this.gap = true;
    this.closed = end;
  }

  override handle_data(data: string): void {
    if (this.skip || !data) return;
    // Another inline element starts a new field ("2026" then "dom"): keep a space between two letters or
    // digits, but not before "," or ":".
    if (this.gap && this.parts.length && isalnum(lastCp(this.parts[this.parts.length - 1]!)) && isalnum(firstCp(data))) {
      this.parts.push(" ");
    }
    this.gap = this.closed = false;
    this.parts.push(data.replaceAll(MARK, ""));
  }
}

const TAGLIKE_RE = new RegExp(
  `^<([!?]|/?[A-Za-z][${W}:.-]*([${S}]|/?>|$))` +
  `|(?<![${W}])[${W}]+="[^"]*"[${S}]+[${W}]+="|="[^"]*"/?>$`, "u");

/** common._markup_line: a line that is leftover markup (Office XML, say). "<18 anos" is text. */
export function markupLine(line: string): boolean {
  return TAGLIKE_RE.test(line) || line.includes("mso-") || line.includes("w:Lsd") || line.includes("UnhideWhenUsed=");
}

/** common.visible_text_links: (text, truncated, urls). `links` is a RegExp tested on an href's path + query. */
export function visibleTextLinks(page: string, cap: number = TEXT_CAP, base?: string | null, links?: RegExp | null):
  { text: string; truncated: boolean; urls: string[] } {
  const parser = new TextParser(base, links);
  parser.feed(page);
  parser.close();
  parser.closeAnchor();
  const lines: string[] = [];
  const marks: [number, string][] = [];
  let offset = 0; // sum(len(l) + 1 for l in lines), in code points
  for (let line of parser.parts.join("").split("\n")) {
    if (line.startsWith(MARK)) {
      line = "<" + pyStrip(line.slice(1)) + ">";
      if (lines.length && lines[lines.length - 1] === line) continue;
      marks.push([offset, line.slice(1, -1)]);
      lines.push(line);
      offset += cpLen(line) + 1;
      continue;
    }
    line = pyStrip(unescape(line).replace(/[ \t\r\f\v]+/g, " "));
    if (line && !markupLine(line)) {
      lines.push(line);
      offset += cpLen(line) + 1;
    }
  }
  const text = lines.join("\n");
  const truncated = cpLen(text) > cap;
  const urls: string[] = [];
  for (const [at, url] of marks) {
    if (at + cpLen(url) + 2 <= cap && !urls.includes(url)) urls.push(url);
  }
  return { text: truncated ? cpSlice(text, 0, cap) : text, truncated, urls };
}

/** common.visible_text: (text, truncated). */
export function visibleText(page: string, cap: number = TEXT_CAP): { text: string; truncated: boolean } {
  const { text, truncated } = visibleTextLinks(page, cap);
  return { text, truncated };
}

const JSONLD_RE = new RegExp(
  `<script[^>]*type[${S}]*=[${S}]*["']application/ld\\+json["'][^>]*>(.*?)</script>`, "gisu");

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function* flatten(node: unknown): Generator<Obj> {
  if (Array.isArray(node)) {
    for (const child of node) yield* flatten(child);
  } else if (isObj(node)) {
    yield node;
    for (const key of ["@graph", "itemListElement", "item"]) {
      if (hasOwn(node, key)) yield* flatten(node[key]);
    }
  }
}

function hasEventType(node: Obj): boolean {
  let kinds = node["@type"];
  if (typeof kinds === "string") kinds = [kinds];
  // `kinds or []`: a falsy non-list is empty; a non-list truthy value (number, object) would raise in Python.
  return Array.isArray(kinds) && kinds.some((k) => typeof k === "string" && k.endsWith("Event"));
}

function first(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? first(value[0]) : null;
  return value;
}

function eventItem(node: Obj): JsonLdItem {
  const location = first(node["location"]);
  let place: string | null = null;
  let locality: string | null = null;
  if (isObj(location)) {
    place = (location["name"] ?? null) as string | null;
    const address = first(location["address"]);
    if (isObj(address)) locality = (address["addressLocality"] ?? null) as string | null;
    else if (typeof address === "string") locality = address;
  } else if (typeof location === "string") {
    place = location;
  }
  const offers = first(node["offers"]);
  let price: unknown = null;
  if (isObj(offers)) price = hasOwn(offers, "price") ? offers["price"] : (offers["lowPrice"] ?? null);
  let description = (node["description"] ?? null) as string | null;
  if (typeof description === "string") {
    description = cpSlice(pyStrip(unescape(description.replace(WS_RUNS, " "))), 0, DESCRIPTION_CAP);
  }
  const url = node["url"];
  return {
    name: typeof node["name"] === "string" ? pyStrip(unescape(node["name"])) : null,
    startDate: node["startDate"] ?? null,
    endDate: node["endDate"] ?? null,
    location: place,
    addressLocality: locality,
    url: typeof url === "string" ? url : null,
    price,
    description,
  };
}

const ISO_DAY_RE = /^\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}/u;

/** common.iso_day: "YYYY-MM-DD" prefix of a string that starts with one, else null. */
export function isoDay(value: unknown): string | null {
  if (typeof value === "string" && ISO_DAY_RE.test(value)) return cpSlice(value, 0, 10);
  return null;
}

/** common.in_window: true unless the dates are readable and outside the window. An event that began before the
 *  window but ends inside it is kept. */
export function inWindow(start: unknown, end: unknown, window: Window | null | undefined): boolean {
  const from = isoDay(start);
  const to = isoDay(end);
  if (window == null || from === null) return true;
  const last = to ?? from;
  return cpCompare(from, window[1]) <= 0 && cpCompare(last, window[0]) >= 0;
}

/** Python json.loads accepts NaN, Infinity and -Infinity; JSON.parse does not. A block that holds one is
 *  retried with the bare token replaced by null (so the rest of its events survive; see the known differences). */
function loadJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const patched = text.replace(/("(?:[^"\\]|\\[^])*")|(?<![\p{L}\p{N}_$])(?:-?Infinity|NaN)(?![\p{L}\p{N}_$])/gu,
      (m, str) => (str ? m : "null"));
    if (patched === text) throw error;
    return JSON.parse(patched);
  }
}

/** common.extract_jsonld_events: schema.org events of a page's JSON-LD blocks; bad blocks are skipped. */
export function extractJsonldEvents(page: string, window?: Window | null): JsonLdItem[] {
  const events: JsonLdItem[] = [];
  for (const m of page.matchAll(JSONLD_RE)) {
    const block = m[1]!;
    let data: unknown;
    try {
      data = loadJson(block.includes("&quot;") ? unescape(block) : block);
    } catch {
      continue;
    }
    for (const node of flatten(data)) {
      if (hasEventType(node)) {
        const item = eventItem(node);
        if (inWindow(item.startDate, item.endDate, window)) events.push(item);
      }
    }
  }
  return events;
}

/** common.plain: text of a string that may hold entities and tags, on one line; null if not a string or empty. */
export function plain(value: unknown, cap?: number): string | null {
  if (typeof value !== "string") return null;
  let v = unescape(unescape(value).replace(/<[^>]*>/g, " "));
  v = pyStrip(v.replace(WS_RUNS, " "));
  if (cap) v = cpSlice(v, 0, cap);
  return v || null;
}

function falsy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "" || Number.isNaN(v)) return true;
  if (Array.isArray(v)) return v.length === 0;
  return isObj(v) && Object.keys(v).length === 0;
}

/** common.make_item. */
export function makeItem(title: unknown, start: string | null, end: string | null, venue: unknown = null,
  url: string | null = null, price: unknown = null, description: unknown = null): MadeItem {
  return {
    title: plain(title), start, end, venue: plain(venue), url,
    price: (falsy(price) ? null : price) as MadeItem["price"],
    description: plain(description, DESCRIPTION_CAP),
  };
}

/** common.keep_window: items whose start/end are in the window. */
export function keepWindow<T extends { start: unknown; end?: unknown }>(items: T[], window: Window): T[] {
  return items.filter((i) => inWindow(i.start, i.end, window));
}

const CHARSET_RE = new RegExp(`charset=([${W}-]+)`, "iu");

/** common.decode(body, content_type): charset from the header strict, then utf-8 strict, then latin-1.
 *  A leading BOM is kept, as Python's decode keeps it. */
export function decode(body: Uint8Array, contentType: string | null | undefined): string {
  const match = CHARSET_RE.exec(contentType || "");
  for (const charset of [match ? match[1]! : null, "utf-8"]) {
    if (charset) {
      try {
        return pyDecode(body, charset);
      } catch {
        // UnicodeDecodeError, LookupError: try the next one
      }
    }
  }
  return latin1(body);
}

/** common.xml_root: guards (NUL/UTF-16, DOCTYPE/ENTITY) then py/xml.fromString; throws AdapterError. */
export function xmlRoot(body: Uint8Array): Element {
  if (body.includes(0) || (body.length >= 2 && ((body[0] === 0xff && body[1] === 0xfe) || (body[0] === 0xfe && body[1] === 0xff)))) {
    throw new AdapterError("feed is UTF-16 or UTF-32, not ASCII-compatible; not read");
  }
  if (/<!(DOCTYPE|ENTITY)/i.test(latin1(body))) {
    throw new AdapterError("feed has a DOCTYPE or ENTITY declaration; not read");
  }
  try {
    return fromString(body);
  } catch (error) {
    if (error instanceof XmlParseError) throw new AdapterError("feed is not valid XML");
    throw error;
  }
}

// An event page's own fields: the title, when it says more than a category; the start, end and venue from the
// page's structured data; and its first text.
const PLACEHOLDERS = new Set([
  "concerto", "cinema", "teatro", "danca", "exposicao", "musica", "evento", "eventos",
  "espetaculo", "espectaculo", "conferencia", "workshop", "desporto", "festa", "feira",
  "formacao", "literatura", "humor", "outros"]);
const NOT_W = `(?<![${W}])`;
const NOT_W_AFTER = `(?![${W}])`;
const ATC_RE = new RegExp(
  `<([${W}]+)[^>]*${NOT_W}class[${S}]*=[${S}]*["'][^"']*${NOT_W}atc_(date_start|date_end|location)${NOT_W_AFTER}[^"']*["'][^>]*>` +
  `(.*?)</\\1[${S}]*>`, "gsu");
const ICAL_RE = new RegExp(`href[${S}]*=[${S}]*["']data:text/calendar[^,"']*,([^"']*)["']`, "giu");
const TITLE_RE = /<title[^>]*>(.*?)<\/title>/is;
const OG_TITLE_RE = new RegExp(`<meta[${S}][^>]*?${NOT_W}property[${S}]*=[${S}]*["']og:title["'][^>]*>`, "giu");
const CONTENT_RE = new RegExp(`${NOT_W}content[${S}]*=[${S}]*("([^"]*)"|'([^']*)')`, "iu");

/** Lower case without accents, to compare a title with a category word. */
function fold(value: string): string {
  return pyStrip(casefold(value.normalize("NFD").replace(/[̀-ͯ]/g, "")));
}

function placeholder(value: string | null): boolean {
  return !value || PLACEHOLDERS.has(fold(value));
}

/** common._stamp (imported by nextjs.py): "YYYY-MM-DD HH:MM", or the day alone without a time or at 00:00. */
export function stamp(date: string, clock: string | null): string {
  if (clock === null) return date;
  const head = cpSlice(clock, 0, 5);
  return head === "00:00" || head === "" ? date : `${date} ${head}`;
}

/** common._local + _stamp on a Lisbon moment, as nextjs.local_stamp uses them. */
export function stampOf(local: LisbonTime): string {
  return stamp(local.date, local.time);
}

const LOCAL_RE = new RegExp(
  "^(\\p{Nd}{4})-?(\\p{Nd}{2})-?(\\p{Nd}{2})(?:[T ](\\p{Nd}{2}):?(\\p{Nd}{2})(?::?(\\p{Nd}{2}))?)?(Z)?", "u");

/** int() of a string of decimal digits of any script. */
export function toInt(digits: string): number {
  let n = 0;
  for (const ch of digits) {
    let cp = ch.codePointAt(0)!;
    // Decimal digits come in runs of ten from a zero: count from the start of the contiguous run.
    if (cp > 0x7f) {
      let start = cp;
      while (start > 0 && /^\p{Nd}$/u.test(String.fromCodePoint(start - 1))) start--;
      cp = 0x30 + ((cp - start) % 10);
    }
    n = n * 10 + (cp - 0x30);
  }
  return n;
}

/** (date, "HH:MM" or null) from an ISO date or time, an atc value or an iCal one; a trailing Z is UTC and
 *  becomes Lisbon time. */
function local(value: string | null | undefined): [string | null, string | null] {
  const match = LOCAL_RE.exec(pyStrip(value || ""));
  if (!match) return [null, null];
  const [, year, month, day, hour, minute, , utc] = match;
  if (hour === undefined) return [`${year}-${month}-${day}`, null];
  if (utc) {
    const [y, mo, d, h, mi] = [toInt(year!), toInt(month!), toInt(day!), toInt(hour), toInt(minute!)];
    const probe = new Date(0);
    probe.setUTCFullYear(y, mo - 1, d);
    // datetime(...) raises ValueError on an impossible date or time
    if (y < 1 || mo < 1 || mo > 12 || d < 1 || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d || h > 23 || mi > 59) {
      throw new RangeError("invalid date");
    }
    probe.setUTCHours(h, mi, 0, 0);
    const moment = lisbonTimeOf(probe.getTime());
    return [moment.date, moment.time];
  }
  return [`${year}-${month}-${day}`, `${hour}:${minute}`];
}

type Span = [start: string | null, end: string | null, venue: string | null];

/** The pieces of one source as (start, end, venue); start null when unreadable. */
function span(start: string | null | undefined, end: string | null | undefined, venue: string | null | undefined): Span {
  const [firstDay, clock] = local(start);
  if (firstDay === null) return [null, null, null];
  const from = stamp(firstDay, clock);
  const [last, closing] = local(end);
  let finish = last ? stamp(last, closing) : null;
  if (finish === from) finish = null;
  return [from, finish, placeholder(venue ?? null) ? null : venue!];
}

function jsonldSpan(page: string): Span {
  for (const event of extractJsonldEvents(page)) {
    const found = span(event.startDate as string, event.endDate as string, event.location);
    if (found[0]) return found;
  }
  return [null, null, null];
}

function atcSpan(page: string): Span {
  const fields: Record<string, string | null> = {};
  for (const m of page.matchAll(ATC_RE)) fields[m[2]!] = plain(m[3]);
  return span(fields["date_start"], fields["date_end"], fields["location"]);
}

function icalSpan(page: string): Span {
  for (const m of page.matchAll(ICAL_RE)) {
    let text = unquote(unescape(m[1]!));
    text = text.replace(new RegExp(`\\r?\\n[ \\t]`, "g"), "");
    const fields: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      const at = line.indexOf(":");
      const name = at < 0 ? line : line.slice(0, at);
      const value = at < 0 ? "" : line.slice(at + 1);
      const key = pyStrip(name.split(";")[0]!).toUpperCase();
      if (!hasOwn(fields, key)) fields[key] = pyStrip(value);
    }
    const venue = pyStrip((fields["LOCATION"] ?? "").replace(/\\([^\n])/g, "$1"));
    const found = span(fields["DTSTART"], fields["DTEND"], venue);
    if (found[0]) return found;
  }
  return [null, null, null];
}

/** (og:title or <title>, the <title> line) as plain text; empty strings if none. */
function pageTitle(page: string): [string, string] {
  const tag = TITLE_RE.exec(page);
  const line = tag ? plain(tag[1]) : null;
  for (const m of page.matchAll(OG_TITLE_RE)) {
    const content = CONTENT_RE.exec(m[0]);
    const value = content ? pyStrip(unescape(content[2] || content[3] || "")) : "";
    if (value) return [value, line || ""];
  }
  if (line) return [pyStrip(line.split(/ \| | ‹ | — /)[0]!), line];
  return ["", ""];
}

/** Whether the lines after `at` read as a mini calendar or a menu: at least half of the next 12 non-empty
 *  lines are 3 characters or fewer (a day, a weekday abbreviation). */
function inCalendar(text: string, at: number): boolean {
  const lines: string[] = [];
  const rest = text.slice(at).split("\n");
  for (let i = 1; i < rest.length && lines.length < 12; i++) {
    const line = pyStrip(rest[i]!);
    if (line) lines.push(line);
  }
  return lines.length >= 6 && lines.filter((l) => cpLen(l) <= 3).length * 2 >= lines.length;
}

/** About EXCERPT_CAP characters of text from the first mention of the title after the <title> line (or of its
 *  part before " - ", " | ", " ‹ ") that does not lead into a mini calendar, else from the start of the text
 *  after that line. A first line that starts with the title and is followed by a line that starts with the
 *  title's first 20 characters is dropped, so the title is not said twice. */
function excerpt(text: string, title: string, head: string): string | null {
  let start = 0;
  if (head && text.startsWith(head)) start = head.length;
  const needles = [title];
  const part = title.split(/ - | \| | ‹ /)[0]!;
  if (part !== title) needles.push(part);
  for (const needle of needles) {
    const firstAt = needle ? text.indexOf(needle, start) : -1;
    if (firstAt >= 0) {
      let found = firstAt;
      while (found >= 0 && inCalendar(text, found)) found = text.indexOf(needle, found + needle.length);
      start = found >= 0 ? found : firstAt;
      break;
    }
  }
  let chunk = pyStrip(text.slice(start));
  const lines = chunk.split("\n");
  if (title && lines.length > 1 && lines[0]!.startsWith(title) && lines[1]!.startsWith(cpSlice(title, 0, 20))) {
    chunk = pyStrip(chunk.slice(lines[0]!.length + 1));
  }
  if (cpLen(chunk) > EXCERPT_CAP) {
    const cps = Array.from(chunk).slice(0, EXCERPT_CAP);
    const cut = Math.max(cps.lastIndexOf(" "), cps.lastIndexOf("\n"));
    chunk = (cut > EXCERPT_CAP >> 1 ? cps.slice(0, cut) : cps).join("");
  }
  return pyStrip(chunk) || null;
}

/** common.extract_detail: an event page's own fields. `page.url` is the final URL. */
export function extractDetail(page: Page): Detail {
  const source = decode(page.body, page.contentType);
  const [title, head] = pageTitle(source);
  let start: string | null = null;
  let end: string | null = null;
  let venue: string | null = null;
  // Python builds the tuple of all three spans first, so an error in any of them fails the page.
  for (const found of [jsonldSpan(source), atcSpan(source), icalSpan(source)]) {
    if (start === null) [start, end] = [found[0], found[1]];
    venue = venue || found[2];
    if (start && venue) break;
  }
  const { text } = visibleTextLinks(source, Infinity);
  return { url: page.url, title: placeholder(title) ? null : title, start, end, venue, excerpt: excerpt(text, title, head) };
}

/** common.default_details: extractDetail for each followed page; an unreadable page is left out. */
export function defaultDetails(_source: Source, pages: Page[], _window: Window): Detail[] {
  const details: Detail[] = [];
  for (const page of pages) {
    try {
      details.push(extractDetail(page));
    } catch {
      continue;
    }
  }
  return details;
}

const CAL_YEAR_RE = /<input[^>]*\bname="year_ajax"[^>]*\bvalue="(\d{4})"|<input[^>]*\bvalue="(\d{4})"[^>]*\bname="year_ajax"/i;
const CAL_MONTH_RE = /<input[^>]*\bname="month_ajax"[^>]*\bvalue="(\d{1,2})"|<input[^>]*\bvalue="(\d{1,2})"[^>]*\bname="month_ajax"/i;
const CAL_CELL_RE = /<td\b[^>]*\bmod_eb_mincalendar_event\b[^>]*>(.*?)<\/td>/gis;
const CAL_LINK_RE = /<a\b([^>]*)>\s*<span\b[^>]*>\s*(\d{1,2})\s*<\/span>/is;

function attrOf(tag: string, name: string): string | null {
  const m = new RegExp(`(?:^|[\\s"'])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? unescape(m[1] ?? m[2] ?? "") : null;
}

/** Events of a Joomla "Event Booking" mini calendar (a table whose cells with an event hold a link around the day
 *  number). The month and year come from the calendar's hidden month_ajax and year_ajax fields; the day from the
 *  cell. A link to a day's list (several events, "N Eventos", "layout=daily") is not an event page and gives
 *  nothing. The calendar marks an event on its first day only, so an event shown on several cells gets the
 *  earliest as `start` and no end. `read` is false when no calendar could be read: no month and year, or no linked
 *  cell although the page has event markers (`hasMarkers`). */
export function miniCalendarItems(page: string, base: string | null | undefined, window: Window,
  hasMarkers = false): { items: MadeItem[]; read: boolean } {
  const y = CAL_YEAR_RE.exec(page);
  const mo = CAL_MONTH_RE.exec(page);
  if (!y || !mo) return { items: [], read: false };
  const year = Number(y[1] ?? y[2]);
  const month = Number(mo[1] ?? mo[2]);
  if (month < 1 || month > 12) return { items: [], read: false };
  const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const found = new Map<string, { title: string; days: number[] }>();
  let cells = 0;
  for (const cell of page.matchAll(CAL_CELL_RE)) {
    const link = CAL_LINK_RE.exec(cell[1]!);
    if (!link) continue;
    cells++;
    const href = attrOf(link[1]!, "href");
    const title = pyStrip((attrOf(link[1]!, "title") ?? "").replace(WS_RUNS, " "));
    if (!href || !title || /[?&;]layout=daily\b/.test(href) || /^\d+ eventos?$/i.test(title)) continue;
    const url = cleanUrl(base, href);
    const day = Number(link[2]);
    if (!url || day < 1 || day > monthDays) continue;
    const entry = found.get(url) ?? { title, days: [] };
    entry.days.push(day);
    found.set(url, entry);
  }
  const items: MadeItem[] = [];
  for (const [url, { title, days }] of found) {
    const first = Math.min(...days);
    // makeItem would unescape the title again and strip what looks like a tag.
    items.push({ ...makeItem(null, `${year}-${String(month).padStart(2, "0")}-${String(first).padStart(2, "0")}`, null, null, url), title });
  }
  return { items: keepWindow(items, window), read: cells > 0 || !hasMarkers };
}
