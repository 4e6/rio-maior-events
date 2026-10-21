// Port of scripts/adapters/riomaior_calendar.py. Owned by T7.
import type { Adapter, Request, RioMaiorItem, Window } from "./types.ts";
import { lisbonTime } from "./common.ts";
import { loadJsonBody, truthy } from "./json-body.ts";
import { parseIsoDatetime } from "../py/datetime.ts";
import { unescape } from "../py/html_unescape.ts";
import { pyStrip } from "../py/str.ts";
import { urlencode, urljoin, urlsplit } from "../url.ts";

/** riomaior_calendar.CM_NOTE */
export const CM_NOTE =
  "start is UTC as sent; local_start and date are mainland Portugal time. " +
  "An all-day item can show 00:00 or 01:00 local: check it against the event page";

/** riomaior_calendar.request_body: form-encoded catid[] ... as ASCII bytes. */
export function requestBody(categories: string[]): Uint8Array {
  const fields: [string, string][] = categories.map((c) => ["catid[]", String(c)]);
  fields.push(["description_length", "100"], ["show_child_category_articles", "0"], ["moduleId", "223"]);
  return new TextEncoder().encode(urlencode(fields));
}

/** `value or ""` of a field that must be a string when set. */
function text(value: unknown): string {
  if (!truthy(value)) return "";
  if (typeof value !== "string") throw new TypeError("expected a string");
  return value;
}

/** riomaior_calendar.parse_items: items inside the window, sorted by start. */
export function parseItems(raw: Uint8Array, window: Window, base: string): RioMaiorItem[] {
  const data = loadJsonBody(raw);
  if (!Array.isArray(data)) throw new Error("expected a JSON array");
  const items: RioMaiorItem[] = [];
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new TypeError("expected an object");
    const start = text(entry["start"]);
    const moment = parseIsoDatetime(start);
    if (moment === null) continue;
    const local = lisbonTime(moment.ms);
    const date = local.date;
    if (!(window[0] <= date && date <= window[1])) continue;
    const url = text(entry["url"]);
    items.push({
      title: pyStrip(unescape(text(entry["title"]))),
      start,
      local_start: local.isoMinutes,
      date,
      url: url ? urljoin(base + "/", url) : null,
      description: pyStrip(unescape(text(entry["description"]))),
    });
  }
  return items.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

export const riomaior_calendar: Adapter = {
  requests(source): Request[] {
    return [{ url: source.url, data: requestBody(source.options!["categories"]) }];
  },
  parse(source, pages, window) {
    const parts = urlsplit(source.url);
    const items = parseItems(pages[0]!.body, window, `${parts.scheme}://${parts.netloc}`);
    const note = items.length ? CM_NOTE : "0 items in window; " + CM_NOTE;
    return { items, text: null, truncated: false, past: [], note };
  },
};
