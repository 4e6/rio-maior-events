"""Next.js municipal sites that embed their events in the page (Bombarral,
Lourinhã, Alenquer).

The page streams its data as self.__next_f.push([1,"..."]) string chunks; one
JSON value can span several. They are joined, then the value after
"eventsList" is read. Dates are midnight, so the items carry a day and no
time. The page text comes too, as for any page.
"""

import json
import re
import urllib.parse

from .common import TEXT_CAP, decode, iso_day, keep_window, make_item, visible_text

NEXT_CHUNK_RE = re.compile(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)')


def parse_nextjs(page, url, window):
    """(items inside the window, note) of a Next.js agenda page.

    The note says when the page holds only the first of several pages.
    """
    chunks = NEXT_CHUNK_RE.findall(page)
    data = "".join(json.loads('"%s"' % chunk, strict=False) for chunk in chunks)
    at = data.find('"eventsList":')
    if at < 0:
        raise ValueError("no eventsList in the page data (layout may have changed)")
    at += len('"eventsList":')
    at += len(data[at:]) - len(data[at:].lstrip())
    value, _ = json.JSONDecoder().raw_decode(data, at)
    events = value.get("items") if isinstance(value, dict) else None
    if not isinstance(events, list):
        raise ValueError("eventsList has no items array")
    parts = urllib.parse.urlsplit(url)
    site = "%s://%s/" % (parts.scheme, parts.netloc)
    items = []
    for event in events:
        if not isinstance(event, dict) or not event.get("title"):
            continue
        link = event.get("link")
        items.append(make_item(event.get("title"), iso_day(event.get("startDate")),
                               iso_day(event.get("endDate")), event.get("location"),
                               urllib.parse.urljoin(site, link) if isinstance(link, str) and link else None))
    note = None
    pages, count = value.get("totalPages"), value.get("count")
    if isinstance(pages, int) and pages > 1:
        note = "page 1 of %d%s; later events are not in this file" % (
            pages, ", %d events in all" % count if isinstance(count, int) else "")
    return keep_window(items, window), note


def parse(source, pages, window):
    page = decode(pages[0].body, pages[0].content_type)
    items, note = parse_nextjs(page, source["url"], window)
    text, truncated = visible_text(page, source.get("cap", TEXT_CAP))
    if not items:
        note = "; ".join(["0 items in window"] + ([note] if note else []))
    return {"items": items, "text": text, "truncated": truncated, "past": [], "note": note}
