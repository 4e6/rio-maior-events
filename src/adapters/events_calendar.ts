// Port of scripts/adapters/events_calendar.py. Owned by T7.
import type { Adapter, MadeItem, Request, Source, Window } from "./types.ts";

/** events_calendar.request_url: source.url plus the window in the query. */
export function requestUrl(_source: Source, _window: Window): string { throw new Error("not ported"); }

/** events_calendar.map_events */
export function mapEvents(_data: unknown): MadeItem[] { throw new Error("not ported"); }

export const events_calendar: Adapter = {
  requests(): Request[] { throw new Error("not ported"); },
  parse() { throw new Error("not ported"); },
};
