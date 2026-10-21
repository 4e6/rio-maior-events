// Port of scripts/adapters/cadaval_api.py. Owned by T7.
import type { Adapter, MadeItem } from "./types.ts";
import { isoDay, keepWindow, makeItem } from "./common.ts";
import { isObject, loadJsonBody, truthy } from "./json-body.ts";
import { urljoin } from "../url.ts";

/** cadaval_api.map_events */
export function mapEvents(data: unknown, base: string): MadeItem[] {
  const events = isObject(data) ? data["items"] : null;
  if (!Array.isArray(events)) throw new Error("expected an object with an items array");
  const items: MadeItem[] = [];
  for (const event of events) {
    if (!isObject(event) || !truthy(event["title"])) continue;
    let link = event["link"];
    link = isObject(link) ? link["url"] : link;
    const url = typeof link === "string" && link ? urljoin(base + "/", link) : base + "/";
    items.push(makeItem(event["title"], isoDay(event["date"]), isoDay(event["datef"]), null, url));
  }
  return items;
}

export const cadaval_api: Adapter = {
  parse(source, pages, window) {
    const data = loadJsonBody(pages[0]!.body);
    const items = keepWindow(mapEvents(data, source.options!["site"]), window);
    return { items, text: null, truncated: false, past: [], note: items.length ? null : "0 items in window" };
  },
};
