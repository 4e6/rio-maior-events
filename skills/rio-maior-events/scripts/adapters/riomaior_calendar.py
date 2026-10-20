"""The cm-riomaior calendar: a POST that returns a JSON array and only items.

The endpoint ignores dates and returns months of past events, so the window is
applied here. `start` is kept as sent, in UTC; `local_start` and `date` are
mainland Portugal time. Options: `categories`, the category ids to ask for.
"""

import datetime
import html
import json
import urllib.parse

from .common import Request, lisbon_time

CM_NOTE = (
    "start is UTC as sent; local_start and date are mainland Portugal time. "
    "An all-day item can show 00:00 or 01:00 local: check it against the event page"
)


def request_body(categories):
    fields = [("catid[]", c) for c in categories]
    fields += [("description_length", "100"), ("show_child_category_articles", "0"), ("moduleId", "223")]
    return urllib.parse.urlencode(fields).encode("ascii")


def requests(source, window):
    return [Request(source["url"], request_body(source["options"]["categories"]))]


def parse_items(raw, window, base):
    """Items of the calendar inside the window (two ISO dates)."""
    data = json.loads(raw.decode("utf-8"))
    if not isinstance(data, list):
        raise ValueError("expected a JSON array")
    items = []
    for entry in data:
        start = entry.get("start") or ""
        try:
            moment = datetime.datetime.fromisoformat(start)
        except ValueError:
            continue
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=datetime.timezone.utc)
        local = lisbon_time(moment)
        date = local.date().isoformat()
        if not window[0] <= date <= window[1]:
            continue
        url = entry.get("url") or ""
        items.append({
            "title": html.unescape(entry.get("title") or "").strip(),
            "start": start,
            "local_start": local.isoformat(timespec="minutes"),
            "date": date,
            "url": urllib.parse.urljoin(base + "/", url) if url else None,
            "description": html.unescape(entry.get("description") or "").strip(),
        })
    items.sort(key=lambda item: item["start"])
    return items


def parse(source, pages, window):
    parts = urllib.parse.urlsplit(source["url"])
    items = parse_items(pages[0].body, window, "%s://%s" % (parts.scheme, parts.netloc))
    note = CM_NOTE if items else "0 items in window; " + CM_NOTE
    return {"items": items, "text": None, "truncated": False, "past": [], "note": note}
