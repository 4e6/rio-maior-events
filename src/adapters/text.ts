// Port of scripts/adapters/text.py. Owned by T8.
import type { Adapter, Item, Page, ParseResult, Request, Source, Window } from "./types.ts";
import { AdapterError, MIN_TEXT, TEXT_CAP, capWithMarks, decode, dropCardsAfter, extractJsonldEvents, miniCalendarItems, visibleTextLinks } from "./common.ts";
import { cpLen } from "../py/str.ts";

/** text.parse: visible text plus JSON-LD events; `follow` from source.links markers. */
export const text: Adapter = {
  parse(source: Source, pages: Page[], window: Window): ParseResult {
    const page = decode(pages[0]!.body, pages[0]!.contentType);
    const items: Item[] = extractJsonldEvents(page, window);
    // A Joomla mini calendar: the day of each linked event is read from its cell, not from the text.
    const links = source.links ? new RegExp(source.links) : null;
    const cap = source.cap ?? TEXT_CAP;
    let { text: body, truncated, urls } = visibleTextLinks(page, source.options?.card_dates ? Infinity : cap, pages[0]!.url, links);
    let cardNote: string | null = null;
    if (source.options?.card_dates === "portugalrunning") {
      // Cards dated after the window end go before the cap and before `follow` is built. A cost and noise saver; the rule
      // that these races stop at the coming weeks is merge's, which holds when the layout changes and nothing is dated.
      const cut = dropCardsAfter(body, window[1]);
      ({ text: body, truncated, urls } = capWithMarks(cut.text, cut.marks, cap));
      // The note always says what the filter did, so a partial layout change (some cards no longer read) shows too; the
      // source never fails over it.
      if (cut.dated === 0) cardNote = "no dated race cards found (layout may have changed)";
      else {
        cardNote = `${cut.dated} dated race cards, ${cut.dropped} after ${window[1]} left out`;
        if (cut.unread) cardNote += `; ${cut.unread} race card(s) the filter could not read were kept (layout may have changed)`;
      }
    } else if (source.options?.card_dates) {
      throw new AdapterError(`unknown card_dates: ${String(source.options.card_dates)}`);
    }
    if (!items.length && cpLen(body) < MIN_TEXT) throw new AdapterError("no events or text found (layout may have changed)");
    const parsed: ParseResult = { items, text: body, truncated, past: [], note: cardNote };
    if (source.options?.mini_calendar) {
      const calendar = miniCalendarItems(page, pages[0]!.url, window);
      items.push(...calendar.items);
      if (!calendar.read) parsed.note = "mini calendar not found; days in the text follow the titles";
    }
    if (links) parsed.follow = urls.map((url): Request => ({ url, data: null }));
    return parsed;
  },
};
