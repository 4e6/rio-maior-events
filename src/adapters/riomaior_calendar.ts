// Port of scripts/adapters/riomaior_calendar.py. Owned by T7.
import type { Adapter, Request, RioMaiorItem, Window } from "./types.ts";

/** riomaior_calendar.CM_NOTE */
export const CM_NOTE =
  "start is UTC as sent; local_start and date are mainland Portugal time. " +
  "An all-day item can show 00:00 or 01:00 local: check it against the event page";

/** riomaior_calendar.request_body: form-encoded catid[] ... as ASCII bytes. */
export function requestBody(_categories: string[]): Uint8Array { throw new Error("not ported"); }

/** riomaior_calendar.parse_items: items inside the window, sorted by start. */
export function parseItems(_raw: Uint8Array, _window: Window, _base: string): RioMaiorItem[] { throw new Error("not ported"); }

export const riomaior_calendar: Adapter = {
  requests(): Request[] { throw new Error("not ported"); },
  parse() { throw new Error("not ported"); },
};
