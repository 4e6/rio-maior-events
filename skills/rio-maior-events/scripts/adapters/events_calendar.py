"""The Events Calendar plugin for WordPress, through its REST API (Ourém).

A GET that returns JSON. Options: `window_params`, the two query parameters
that take the window (its last day runs to the end of that day).
"""

import json
import urllib.parse

from .common import Request, keep_window, make_item


def request_url(source, window):
    """The URL to GET: the source's own, plus the window in the query."""
    names = source["options"]["window_params"]
    joiner = "&" if "?" in source["url"] else "?"
    start, end = window
    return source["url"] + joiner + urllib.parse.urlencode(list(zip(names, (start, end + " 23:59:59"))))


def requests(source, window):
    return [Request(request_url(source, window))]


def map_events(data):
    """The REST answer's events; `venue` is [] without one."""
    events = data.get("events") if isinstance(data, dict) else None
    if not isinstance(events, list):
        raise ValueError("expected an object with an events array")
    items = []
    for event in events:
        if not isinstance(event, dict) or not event.get("title"):
            continue
        venue = event.get("venue")
        name = venue.get("venue") if isinstance(venue, dict) else None
        items.append(make_item(event.get("title"), event.get("start_date"), event.get("end_date"),
                               name, event.get("url"), event.get("cost"), event.get("description")))
    return items


def parse(source, pages, window):
    data = json.loads(pages[0].body.decode("utf-8"))
    items = keep_window(map_events(data), window)
    return {"items": items, "text": None, "truncated": False, "past": [],
            "note": None if items else "0 items in window"}
