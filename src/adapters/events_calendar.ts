// Port of scripts/adapters/events_calendar.py. Owned by T7.
import type { Adapter, MadeItem, Request, Source, Window } from "./types.ts";
import { keepWindow, makeItem } from "./common.ts";
import { isObject, loadJsonBody, truthy } from "./json-body.ts";
import { urlencode } from "../url.ts";

/** events_calendar.request_url: source.url plus the window in the query. */
export function requestUrl(source: Source, window: Window): string {
  const names: string[] = source.options!["window_params"];
  const joiner = source.url.includes("?") ? "&" : "?";
  const [start, end] = window;
  const values = [start, end + " 23:59:59"];
  const pairs: [string, string][] = [];
  for (let i = 0; i < Math.min(names.length, values.length); i++) pairs.push([names[i]!, values[i]!]);
  return source.url + joiner + urlencode(pairs);
}

/** events_calendar.map_events */
export function mapEvents(data: unknown): MadeItem[] {
  const events = isObject(data) ? data["events"] : null;
  if (!Array.isArray(events)) throw new Error("expected an object with an events array");
  const items: MadeItem[] = [];
  for (const event of events) {
    if (!isObject(event) || !truthy(event["title"])) continue;
    const venue = event["venue"];
    const name = isObject(venue) ? venue["venue"] : null;
    items.push(makeItem(event["title"], (event["start_date"] ?? null) as string | null,
      (event["end_date"] ?? null) as string | null, name, (event["url"] ?? null) as string | null,
      event["cost"], event["description"]));
  }
  return items;
}

export const events_calendar: Adapter = {
  requests(source, window): Request[] {
    return [{ url: requestUrl(source, window), data: null }];
  },
  parse(_source, pages, window) {
    const items = keepWindow(mapEvents(loadJsonBody(pages[0]!.body)), window);
    return { items, text: null, truncated: false, past: [], note: items.length ? null : "0 items in window" };
  },
};
