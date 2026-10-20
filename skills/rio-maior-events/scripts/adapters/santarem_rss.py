"""The Município de Santarém events feed (RSS 2.0 with a `santaremEvent` block).

A GET that returns XML. Dates and times come from the `santaremEvent` fields
(`pubDate` is the day the entry was published), in local time. The portal
splits an event into one entry per sequential period or date, all with the
same link; entries that touch are joined here.
"""

import datetime
import re
import xml.etree.ElementTree as ET

from .common import AdapterError, keep_window, make_item, plain

ONE_DAY = datetime.timedelta(days=1)


def _day(value):
    """A date from "YYYY-MM-DD"; None for "0000-00-00", empty or unreadable."""
    try:
        return datetime.date.fromisoformat((value or "").strip())
    except ValueError:
        return None


def _clock(value):
    """"HH:MM" from a time field; None for "00:00" or empty."""
    match = re.match(r"\s*(\d{1,2}):(\d{2})", value or "")
    if not match or (int(match.group(1)), match.group(2)) == (0, "00"):
        return None
    return "%02d:%s" % (int(match.group(1)), match.group(2))


def _text(node, name):
    child = node.find(name)
    return child.text if child is not None and child.text else ""


def _entry(item):
    """One feed entry as a dict, or None without a title or a date."""
    event = item.find("santaremEvent")
    if event is None:
        return None
    first = _day(_text(event, "singleDate"))
    last = first
    if first is None:
        first = _day(_text(event, "startDate"))
        last = _day(_text(event, "endDate")) or first
    title = plain(_text(item, "title"))
    if first is None or not title:
        return None
    return {"title": title, "first": first, "last": max(first, last),
            "link": _text(item, "link").strip() or None,
            "venue": _text(event, "eventPlace"), "description": _text(item, "description"),
            "start": _clock(_text(event, "startTime")), "end": _clock(_text(event, "endTime"))}


def _session(entry):
    return "%s–%s" % (entry["start"], entry["end"]) if entry["start"] and entry["end"] else entry["start"]


def _join(entries):
    """Entries with one link: touching periods become one (when at least one
    is a range), same-day sessions become one, separate dates stay apart. Each result carries its sessions."""
    joined = []
    for entry in sorted(entries, key=lambda e: (e["first"], e["start"] or "")):
        entry = dict(entry, sessions=[_session(entry)] if _session(entry) else [])
        last = joined[-1] if joined else None
        if last and (entry["first"], entry["last"]) == (last["first"], last["last"]):
            last["sessions"] += entry["sessions"]
        elif (last and entry["first"] == last["last"] + ONE_DAY
              and (last["first"] != last["last"] or entry["first"] != entry["last"])):
            last["last"] = entry["last"]
            last["sessions"] += [s for s in entry["sessions"] if s not in last["sessions"]]
            last["start"] = last["end"] = None
        else:
            joined.append(entry)
    return joined


def _to_item(entry):
    sessions = entry["sessions"]
    description = plain(entry["description"]) or ""
    if entry["first"] == entry["last"]:
        day = entry["first"].isoformat()
        start = "%s %s" % (day, entry["start"]) if entry["start"] else day
        end = "%s %s" % (day, entry["end"]) if entry["start"] and entry["end"] else None
        others = [s for s in sessions[1:] if s != sessions[0]]
        label = "Outras sessões: " + ", ".join(others) if others else ""
    else:
        start, end = entry["first"].isoformat(), entry["last"].isoformat()
        label = "Horário diário: " + ", ".join(dict.fromkeys(sessions)) if sessions else ""
    if label:
        description = (label + ". " + description).strip()
    return make_item(entry["title"], start, end, entry["venue"], entry["link"], None,
                     description)


def map_feed(body):
    if b"\x00" in body or body.startswith((b"\xff\xfe", b"\xfe\xff")):
        raise AdapterError("feed is UTF-16 or UTF-32, not ASCII-compatible; not read")
    if re.search(rb"<!(DOCTYPE|ENTITY)", body, re.I):
        raise AdapterError("feed has a DOCTYPE or ENTITY declaration; not read")
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        raise AdapterError("feed is not valid XML")
    if root.tag != "rss" or root.find("channel") is None:
        raise AdapterError("feed has no rss channel")
    by_link, order = {}, []
    for number, node in enumerate(root.findall("./channel/item")):
        entry = _entry(node)
        if entry:
            key = entry["link"] or ("item", number)
            if key not in by_link:
                by_link[key] = []
                order.append(key)
            by_link[key].append(entry)
    return [_to_item(e) for key in order for e in _join(by_link[key])]


def parse(source, pages, window):
    items = keep_window(map_feed(pages[0].body), window)
    return {"items": items, "text": None, "truncated": False, "past": [],
            "note": None if items else "0 items in window"}
