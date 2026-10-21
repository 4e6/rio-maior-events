// Shared shapes of the collector. Python counterparts: scripts/adapters/common.py (Request, Page,
// AdapterError), scripts/adapters/__init__.py (the adapter contract), scripts/collect.py
// (well_formed, new_result, parse_outcome), scripts/sources.json (Source).

/** A JSON value as read from a file or an API. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** common.Request: a GET (data null) or a form-encoded POST. */
export interface Request {
  url: string;
  data: Uint8Array | null;
}

/** common.Page: what came back for a Request. `url` is the final URL for a followed page. */
export interface Page {
  url: string;
  status: number;
  body: Uint8Array;
  contentType: string | null;
}

/** The window as two ISO dates, first and last day inclusive (tests/python/helpers.py WINDOW). */
export type Window = readonly [string, string];

/** An entry of scripts/sources.json `sources`. Adapter-specific `options` and `links` are typed loosely. */
export interface Source {
  name: string;
  label: string;
  /** Key of ADAPTERS. */
  adapter: string;
  town: string;
  group: string;
  url: string;
  /** text adapter: regex source for the hrefs of event pages (tested on path + query). */
  links?: string;
  /** Replaces TEXT_CAP for the page text, in code points. */
  cap?: number;
  /** How many event pages to fetch at most (default 0: none). */
  follow?: number;
  /** Per-adapter options: riomaior_calendar {categories}, events_calendar {window_params},
   *  cadaval_api {site}, municipal_rss {page}. */
  options?: Record<string, any>;
}

/** The sources.json file (collect.load_config). */
export interface Config {
  default_delay: number;
  hosts?: Record<string, { delay?: number }>;
  groups: Record<string, string>;
  sources: Source[];
}

/** common.make_item: what the feed and API adapters produce. */
export interface MadeItem {
  title: string | null;
  start: string | null;
  end: string | null;
  venue: string | null;
  url: string | null;
  /** Whatever the API gave (string, number); falsy becomes null. */
  price: string | number | null;
  description: string | null;
}

/** riomaior_calendar.parse_items: the cm-riomaior item (extra fields; no end, venue or price). */
export interface RioMaiorItem {
  title: string;
  /** As sent, UTC. */
  start: string;
  /** "YYYY-MM-DDTHH:MM+01:00" (lisbon isoformat, timespec minutes). */
  local_start: string;
  /** Lisbon-local day. */
  date: string;
  url: string | null;
  description: string;
}

/** common._event_item: a schema.org Event from JSON-LD (the text adapter's items). */
export interface JsonLdItem {
  name: string | null;
  startDate: unknown;
  endDate: unknown;
  location: string | null;
  addressLocality: string | null;
  url: string | null;
  price: unknown;
  description: string | null;
}

/** An item in a source's result: the Python code only requires a dict (collect.well_formed). */
export type Item = MadeItem | RioMaiorItem | JsonLdItem;

/** common.extract_detail: an event page's own fields; a field it does not give is null. */
export interface Detail {
  url: string;
  title: string | null;
  start: string | null;
  end: string | null;
  venue: string | null;
  excerpt: string | null;
}

/** What an adapter's parse returns (the dict in adapters/__init__.py). `follow`: event pages worth fetching. */
export interface ParseResult {
  items: Item[];
  past: Item[];
  text: string | null;
  truncated: boolean;
  note: string | null;
  follow?: Request[];
}

/** One module per kind of site (scripts/adapters/__init__.py). parse is pure and throws AdapterError. */
export interface Adapter {
  /** Default: one GET of source.url. */
  requests?(source: Source, window: Window): Request[];
  parse(source: Source, pages: Page[], window: Window): ParseResult;
  /** Default: defaultDetails (common.default_details). */
  details?(source: Source, pages: Page[], window: Window): Detail[];
}

/** common.AdapterError: the pages cannot be read; the message becomes the source's error. */
export class AdapterError extends Error {
  override name = "AdapterError";
}

/** collect.new_result: one source's entry in a group file. */
export interface SourceResult {
  name: string;
  label: string;
  url: string;
  town: string;
  adapter: string;
  ok: boolean;
  status: number | null;
  error: string | null;
  note: string | null;
  items: Item[];
  past: Item[];
  text: string | null;
  truncated: boolean;
  details: Detail[];
  /** Set when the site refused or did not answer; goes to index.json, not to the group file. */
  refused?: boolean;
}
