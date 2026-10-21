"""Pages read as visible text plus the schema.org events in their JSON-LD.

The default adapter: it suits any site whose agenda is HTML. Every page gives
both, so a source with no structured events still has its text. `cap` in the
source replaces TEXT_CAP for a page that is mostly noise.

`links` in the source is a regex for the hrefs of its event pages, tested on
the path and query of each link ("/agenda/detalhes/\\d+$"). The text then holds
a line `<https://...>` at each matching link, and `follow` lists those pages,
in page order, for the runner to fetch (as many as the source's `follow` allows).
"""

import re

from .common import (MIN_TEXT, TEXT_CAP, AdapterError, Request, decode,
                     extract_jsonld_events, visible_text_links)


def parse(source, pages, window):
    page = decode(pages[0].body, pages[0].content_type)
    items = extract_jsonld_events(page, window)
    links = re.compile(source["links"]) if source.get("links") else None
    text, truncated, urls = visible_text_links(page, source.get("cap", TEXT_CAP), pages[0].url, links)
    if not items and len(text) < MIN_TEXT:
        raise AdapterError("no events or text found (layout may have changed)")
    parsed = {"items": items, "text": text, "truncated": truncated, "past": [], "note": None}
    if links:
        parsed["follow"] = [Request(url) for url in urls]
    return parsed
