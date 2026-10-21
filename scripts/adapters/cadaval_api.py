"""The Cadaval municipal portal's event list: a GET that returns JSON.

Dates are midnight, so only the day is kept; links are relative to the public
site. Options: `site`, the public site that serves the portal's pages
("/2716/slug" under it).
"""

import json
import urllib.parse

from .common import iso_day, keep_window, make_item


def map_events(data, base):
    events = data.get("items") if isinstance(data, dict) else None
    if not isinstance(events, list):
        raise ValueError("expected an object with an items array")
    items = []
    for event in events:
        if not isinstance(event, dict) or not event.get("title"):
            continue
        link = event.get("link")
        link = link.get("url") if isinstance(link, dict) else link
        url = urllib.parse.urljoin(base + "/", link) if isinstance(link, str) and link else base + "/"
        items.append(make_item(event.get("title"), iso_day(event.get("date")),
                               iso_day(event.get("datef")), url=url))
    return items


def parse(source, pages, window):
    data = json.loads(pages[0].body.decode("utf-8"))
    items = keep_window(map_events(data, source["options"]["site"]), window)
    return {"items": items, "text": None, "truncated": False, "past": [],
            "note": None if items else "0 items in window"}
