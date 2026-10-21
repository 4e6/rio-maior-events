// What every adapter shares. Port of scripts/adapters/common.py. Owned by T6 (xmlRoot's guards and the
// decode wrapper are small; T6 does them too). Lengths and caps count code points (src/py/str.ts).
import type { Detail, JsonLdItem, MadeItem, Page, Source, Window } from "./types.ts";
import type { LisbonTime } from "../py/datetime.ts";
import type { Element } from "../py/xml.ts";

export { AdapterError } from "./types.ts";
export type { Page, Request } from "./types.ts";
export { cleanUrl, sameSite } from "../url.ts";
export { lisbonTime } from "../py/datetime.ts";

const NYI = (): never => { throw new Error("not ported"); };

export const TEXT_CAP = 30000;
export const DESCRIPTION_CAP = 300;
export const MIN_TEXT = 200;
export const EXCERPT_CAP = 800;
/** common.MARK: "" starts a marker line while the text is built. */
export const MARK = "";

/** common.visible_text_links: (text, truncated, urls). `links` is a RegExp tested on an href's path + query. */
export function visibleTextLinks(_page: string, _cap?: number, _base?: string | null, _links?: RegExp | null): { text: string; truncated: boolean; urls: string[] } { return NYI(); }

/** common.visible_text: (text, truncated). */
export function visibleText(_page: string, _cap?: number): { text: string; truncated: boolean } { return NYI(); }

/** common.extract_jsonld_events: schema.org events of a page's JSON-LD blocks; bad blocks are skipped. */
export function extractJsonldEvents(_page: string, _window?: Window | null): JsonLdItem[] { return NYI(); }

/** common.iso_day: "YYYY-MM-DD" prefix of a string that starts with one, else null. */
export function isoDay(_value: unknown): string | null { return NYI(); }

/** common.in_window: true unless the dates are readable and outside the window. */
export function inWindow(_start: unknown, _end: unknown, _window: Window | null | undefined): boolean { return NYI(); }

/** common.plain: text of a string that may hold entities and tags, on one line; null if not a string or empty. */
export function plain(_value: unknown, _cap?: number): string | null { return NYI(); }

/** common.make_item. */
export function makeItem(_title: unknown, _start: string | null, _end: string | null, _venue?: unknown,
  _url?: string | null, _price?: unknown, _description?: unknown): MadeItem { return NYI(); }

/** common.keep_window: items whose start/end are in the window. */
export function keepWindow<T extends { start: unknown; end?: unknown }>(_items: T[], _window: Window): T[] { return NYI(); }

/** common.decode(body, content_type): charset from the header strict, then utf-8 strict, then latin-1. */
export function decode(_body: Uint8Array, _contentType: string | null | undefined): string { return NYI(); }

/** common.xml_root: guards (NUL/UTF-16, DOCTYPE/ENTITY) then py/xml.fromString; throws AdapterError. */
export function xmlRoot(_body: Uint8Array): Element { return NYI(); }

/** common._stamp (imported by nextjs.py): "YYYY-MM-DD HH:MM", or the day alone without a time or at 00:00. */
export function stamp(_date: string, _clock: string | null): string { return NYI(); }

/** common._local + _stamp on a Lisbon moment, as nextjs.local_stamp uses them. */
export function stampOf(_local: LisbonTime): string { return NYI(); }

/** common.extract_detail: an event page's own fields. `page.url` is the final URL. */
export function extractDetail(_page: Page): Detail { return NYI(); }

/** common.default_details: extractDetail for each followed page; an unreadable page is left out. */
export function defaultDetails(_source: Source, _pages: Page[], _window: Window): Detail[] { return NYI(); }
