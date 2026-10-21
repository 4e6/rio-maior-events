// Port of scripts/adapters/santarem_rss.py. Owned by T7.
import type { Adapter, MadeItem } from "./types.ts";
import { AdapterError, keepWindow, makeItem, plain, toInt, xmlRoot } from "./common.ts";
import { parseIsoDate } from "../py/datetime.ts";
import { PY_WS, pyStrip } from "../py/str.ts";
import type { Element } from "../py/xml.ts";

interface Entry {
  title: string;
  first: string;
  last: string;
  link: string | null;
  venue: string;
  description: string;
  start: string | null;
  end: string | null;
}
interface Joined extends Entry { sessions: string[] }

/** A date from "YYYY-MM-DD"; null for "0000-00-00", empty or unreadable. */
function day(value: string): string | null {
  return parseIsoDate(pyStrip(value || ""));
}

function addDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d + 1);
  return `${String(t.getUTCFullYear()).padStart(4, "0")}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

const CLOCK_RE = new RegExp(`^[${PY_WS}]*(\\p{Nd}{1,2}):(\\p{Nd}{2})`, "u");

/** "HH:MM" from a time field; null for "00:00" or empty. */
function clock(value: string): string | null {
  const match = CLOCK_RE.exec(value || "");
  if (!match) return null;
  const hour = toInt(match[1]!);
  if (hour === 0 && match[2] === "00") return null;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function textOf(node: Element, name: string): string {
  const child = node.find(name);
  return child !== null && child.text ? child.text : "";
}

/** One feed entry, or null without a title or a date. */
function entryOf(item: Element): Entry | null {
  const event = item.find("santaremEvent");
  if (event === null) return null;
  let first = day(textOf(event, "singleDate"));
  let last = first;
  if (first === null) {
    first = day(textOf(event, "startDate"));
    last = day(textOf(event, "endDate")) ?? first;
  }
  const title = plain(textOf(item, "title"));
  if (first === null || !title) return null;
  return {
    title, first, last: last! > first ? last! : first,
    link: pyStrip(textOf(item, "link")) || null,
    venue: textOf(event, "eventPlace"), description: textOf(item, "description"),
    start: clock(textOf(event, "startTime")), end: clock(textOf(event, "endTime")),
  };
}

function session(entry: Entry): string | null {
  return entry.start && entry.end ? `${entry.start}–${entry.end}` : entry.start;
}

/** Entries with one link: touching periods become one (when at least one is a range), same-day sessions become
 *  one, separate dates stay apart. Each result carries its sessions. */
function join(entries: Entry[]): Joined[] {
  const joined: Joined[] = [];
  const sorted = entries.map((e, i) => ({ e, i })).sort((a, b) => {
    const ka = [a.e.first, a.e.start ?? ""], kb = [b.e.first, b.e.start ?? ""];
    return ka[0]! < kb[0]! ? -1 : ka[0]! > kb[0]! ? 1 : ka[1]! < kb[1]! ? -1 : ka[1]! > kb[1]! ? 1 : a.i - b.i;
  });
  for (const { e } of sorted) {
    const s = session(e);
    const entry: Joined = { ...e, sessions: s ? [s] : [] };
    const last = joined[joined.length - 1];
    if (last && entry.first === last.first && entry.last === last.last) {
      last.sessions.push(...entry.sessions);
    } else if (last && entry.first === addDay(last.last) && (last.first !== last.last || entry.first !== entry.last)) {
      last.last = entry.last;
      for (const x of entry.sessions) if (!last.sessions.includes(x)) last.sessions.push(x);
      last.start = last.end = null;
    } else {
      joined.push(entry);
    }
  }
  return joined;
}

function toItem(entry: Joined): MadeItem {
  const sessions = entry.sessions;
  let description = plain(entry.description) || "";
  let start: string, end: string | null, label: string;
  if (entry.first === entry.last) {
    const d = entry.first;
    start = entry.start ? `${d} ${entry.start}` : d;
    end = entry.start && entry.end ? `${d} ${entry.end}` : null;
    const others = sessions.slice(1).filter((s) => s !== sessions[0]);
    label = others.length ? "Outras sessões: " + others.join(", ") : "";
  } else {
    start = entry.first;
    end = entry.last;
    label = sessions.length ? "Horário diário: " + [...new Set(sessions)].join(", ") : "";
  }
  if (label) description = pyStrip(label + ". " + description);
  return makeItem(entry.title, start, end, entry.venue, entry.link, null, description);
}

/** santarem_rss.map_feed */
export function mapFeed(body: Uint8Array): MadeItem[] {
  const root = xmlRoot(body);
  if (root.tag !== "rss" || root.find("channel") === null) throw new AdapterError("feed has no rss channel");
  const byLink = new Map<string | number, Entry[]>();
  const order: (string | number)[] = [];
  root.findall("./channel/item").forEach((node, number) => {
    const entry = entryOf(node);
    if (entry) {
      const key = entry.link ?? number;
      if (!byLink.has(key)) {
        byLink.set(key, []);
        order.push(key);
      }
      byLink.get(key)!.push(entry);
    }
  });
  return order.flatMap((key) => join(byLink.get(key)!).map(toItem));
}

export const santarem_rss: Adapter = {
  parse(_source, pages, window) {
    const items = keepWindow(mapFeed(pages[0]!.body), window);
    return { items, text: null, truncated: false, past: [], note: items.length ? null : "0 items in window" };
  },
};
