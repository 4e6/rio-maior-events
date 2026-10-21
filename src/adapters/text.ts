// Port of scripts/adapters/text.py. Owned by T8.
import type { Adapter, Page, ParseResult, Request, Source, Window } from "./types.ts";
import { AdapterError, MIN_TEXT, TEXT_CAP, decode, extractJsonldEvents, visibleTextLinks } from "./common.ts";
import { cpLen } from "../py/str.ts";

/** text.parse: visible text plus JSON-LD events; `follow` from source.links markers. */
export const text: Adapter = {
  parse(source: Source, pages: Page[], window: Window): ParseResult {
    const page = decode(pages[0]!.body, pages[0]!.contentType);
    const items = extractJsonldEvents(page, window);
    const links = source.links ? new RegExp(source.links) : null;
    const { text: body, truncated, urls } = visibleTextLinks(page, source.cap ?? TEXT_CAP, pages[0]!.url, links);
    if (!items.length && cpLen(body) < MIN_TEXT) throw new AdapterError("no events or text found (layout may have changed)");
    const parsed: ParseResult = { items, text: body, truncated, past: [], note: null };
    if (links) parsed.follow = urls.map((url): Request => ({ url, data: null }));
    return parsed;
  },
};
