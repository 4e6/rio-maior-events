// Port of scripts/adapters/nextjs.py. Owned by T8. The JSON helpers it needs (a value-end scanner for
// raw_decode, a string-literal decoder allowing raw control characters) live here, not in src/py/json.ts.
import type { Adapter, Detail, MadeItem, Page, Source, Window } from "./types.ts";

/** nextjs.parse_nextjs: (items in window, note). */
export function parseNextjs(_page: string, _url: string, _window: Window): { items: MadeItem[]; note: string | null } { throw new Error("not ported"); }

/** nextjs.local_stamp: "YYYY-MM-DD HH:MM" Lisbon time of a UTC ISO moment, the day alone at local midnight; null if unreadable. */
export function localStamp(_value: unknown): string | null { throw new Error("not ported"); }

/** nextjs.clocks: the (start, end) "HH:MM" read from a schedule phrase. */
export function clocks(_schedule: string): [string | null, string | null] { throw new Error("not ported"); }

/** nextjs.excerpt_of */
export function excerptOf(_description: string): string | null { throw new Error("not ported"); }

export const nextjs: Adapter = {
  parse() { throw new Error("not ported"); },
  details(_source: Source, _pages: Page[], _window: Window): Detail[] { throw new Error("not ported"); },
};
