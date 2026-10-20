"""Pages read as visible text plus the schema.org events in their JSON-LD.

The default adapter: it suits any site whose agenda is HTML. Every page gives
both, so a source with no structured events still has its text. `cap` in the
source replaces TEXT_CAP for a page that is mostly noise.
"""

from .common import (MIN_TEXT, TEXT_CAP, AdapterError, decode, extract_jsonld_events,
                     visible_text)


def parse(source, pages, window):
    page = decode(pages[0].body, pages[0].content_type)
    items = extract_jsonld_events(page, window)
    text, truncated = visible_text(page, source.get("cap", TEXT_CAP))
    if not items and len(text) < MIN_TEXT:
        raise AdapterError("no events or text found (layout may have changed)")
    return {"items": items, "text": text, "truncated": truncated, "past": [], "note": None}
