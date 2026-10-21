"""Municipal RSS feeds (a platform several municipalities share).

A GET that returns RSS 2.0. Unlike the Santarém feed, `pubDate` is the event's
start, with its offset; it is converted to mainland Portugal time, and a start
at 00:00 there is a date without a time. The feed gives no end and no venue.
Titles can be generic ("CINEMA"), so the event pages are worth following: the
items' links, in the order of their start, are the `follow` list.
"""

import datetime
import email.utils

from .common import AdapterError, Request, clean_url, keep_window, lisbon_time, make_item, plain, xml_root


def _text(node, name):
    child = node.find(name)
    return child.text if child is not None and child.text else ""


def _start(value):
    """"YYYY-MM-DD HH:MM" (or the day alone at midnight) in Portugal time from an
    RFC 822 date; None when unreadable or without an offset."""
    try:
        moment = email.utils.parsedate_to_datetime((value or "").strip())
    except (TypeError, ValueError, IndexError):
        return None
    if moment is None or moment.tzinfo is None:
        return None
    local = lisbon_time(moment.astimezone(datetime.timezone.utc))
    if (local.hour, local.minute) == (0, 0):
        return local.strftime("%Y-%m-%d")
    return local.strftime("%Y-%m-%d %H:%M")


def parse(source, pages, window):
    root = xml_root(pages[0].body)
    if root.tag != "rss" or root.find("channel") is None:
        raise AdapterError("feed has no rss channel")
    items = []
    for node in root.findall("./channel/item"):
        start = _start(_text(node, "pubDate"))
        title = plain(_text(node, "title"))
        if start is None or not title:
            continue
        url = clean_url(pages[0].url or source.get("url"), _text(node, "link").strip())
        items.append(make_item(title, start, None, None, url, None, _text(node, "description")))
    items = sorted(keep_window(items, window), key=lambda i: i["start"])
    follow = [Request(url) for url in dict.fromkeys(i["url"] for i in items if i["url"])]
    return {"items": items, "text": None, "truncated": False, "past": [],
            "note": None if items else "0 items in window", "follow": follow}
