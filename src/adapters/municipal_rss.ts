// Port of scripts/adapters/municipal_rss.py. Owned by T7.
import type { Adapter, MadeItem, Request } from "./types.ts";
import { AdapterError, cleanUrl, keepWindow, lisbonTime, makeItem, plain, xmlRoot } from "./common.ts";
import { parseRfc822 } from "../py/datetime.ts";
import { pyStrip } from "../py/str.ts";
import type { Element } from "../py/xml.ts";

function textOf(node: Element, name: string): string {
  const child = node.find(name);
  return child !== null && child.text ? child.text : "";
}

/** "YYYY-MM-DD HH:MM" (or the day alone at midnight) in Portugal time from an RFC 822 date; null when
 *  unreadable or without an offset. */
function start(value: string): string | null {
  const moment = parseRfc822(pyStrip(value || ""));
  if (moment === null || !moment.aware) return null;
  const local = lisbonTime(moment.ms);
  return local.hour === 0 && local.minute === 0 ? local.date : `${local.date} ${local.time}`;
}

export const municipal_rss: Adapter = {
  parse(source, pages, window) {
    const root = xmlRoot(pages[0]!.body);
    if (root.tag !== "rss" || root.find("channel") === null) throw new AdapterError("feed has no rss channel");
    let made: MadeItem[] = [];
    for (const node of root.findall("./channel/item")) {
      const when = start(textOf(node, "pubDate"));
      const title = plain(textOf(node, "title"));
      if (when === null || !title) continue;
      const url = cleanUrl(pages[0]!.url || source.url, pyStrip(textOf(node, "link")));
      made.push(makeItem(title, when, null, null, url, null, textOf(node, "description")));
    }
    // Python's sort is stable; start strings are ASCII.
    const items = keepWindow(made, window).sort((a, b) => (a.start! < b.start! ? -1 : a.start! > b.start! ? 1 : 0));
    const urls = [...new Set(items.map((i) => i.url).filter((u): u is string => !!u))];
    const follow: Request[] = urls.map((url) => ({ url, data: null }));
    return { items, text: null, truncated: false, past: [], note: items.length ? null : "0 items in window", follow };
  },
};
