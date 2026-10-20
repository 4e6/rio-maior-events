"""Next.js municipal sites that embed their events in the page (Bombarral,
Lourinhã, Alenquer).

The page streams its data as self.__next_f.push([1,"..."]) string chunks; one
JSON value can span several. They are joined, then the value after
"eventsList" is read. Dates are midnight, so the items carry a day and no
time. The page text comes too, as for any page.

An event page has no text of its own either: its data is in the same kind of
payload, under pageData.modules, in an object with the title, the description
(HTML: the time, the venue and the price are said there) and UTC dates. The
in-window events' pages are followed and read from that.
"""

import datetime
import json
import re
import urllib.parse

from .common import (EXCERPT_CAP, TEXT_CAP, Request, _stamp, decode, extract_detail,
                     iso_day, keep_window, lisbon_time, make_item, plain, visible_text)

NEXT_CHUNK_RE = re.compile(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)')


def payload(page):
    """The page's streamed data as one string."""
    chunks = NEXT_CHUNK_RE.findall(page)
    return "".join(json.loads('"%s"' % chunk, strict=False) for chunk in chunks)


def parse_nextjs(page, url, window):
    """(items inside the window, note) of a Next.js agenda page.

    The note says when the page holds only the first of several pages.
    """
    data = payload(page)
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
    follow = [Request(i["url"]) for i in sorted(items, key=lambda i: i["start"] or "") if i["url"]]
    return {"items": items, "text": text, "truncated": truncated, "past": [], "note": note,
            "follow": follow}


def module_data(page):
    """The event object (the one with a `description`) of an event page's modules."""
    data = payload(page)
    at = data.find('"modules":')
    if at < 0:
        raise ValueError("no modules in the page data")
    at += len('"modules":')
    modules, _ = json.JSONDecoder().raw_decode(data, at + len(data[at:]) - len(data[at:].lstrip()))
    for module in modules if isinstance(modules, list) else []:
        found = module.get("data") if isinstance(module, dict) else None
        if isinstance(found, dict) and "description" in found:
            return found
    raise ValueError("no module with a description")


def resolve(data, value):
    """A string value of the payload; a long one is streamed as a text row
    ("21:T615,<text>", the length in hex UTF-8 bytes) and the value is "$21"."""
    reference = re.match(r"\$([0-9a-f]+)$", value) if isinstance(value, str) else None
    if not reference:
        return value
    row = re.search(r"(?:^|\n)%s:T([0-9a-f]+)," % reference.group(1), data)
    if not row:
        return None
    raw = data[row.end():].encode("utf-8")[:int(row.group(1), 16)]
    return raw.decode("utf-8", "ignore")


def local_stamp(value):
    """"YYYY-MM-DD HH:MM" in Lisbon time of a UTC ISO moment, the day alone at
    local midnight; None when unreadable."""
    try:
        moment = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=datetime.timezone.utc)
    local = lisbon_time(moment.astimezone(datetime.timezone.utc))
    return _stamp(local.strftime("%Y-%m-%d"), local.strftime("%H:%M"))


CLOCK = r"(\d{1,2})(?:\s*(?:h|horas?)(?:\s*(\d{2}))?|:(\d{2}))"
ONE_TIME_RE = re.compile(r"(?:[àa]s\s+)?%s\.?$" % CLOCK, re.I)
RANGE_RE = re.compile(r"(?:das\s+)?%s\s*(?:[àa]s|a|-|–)\s*%s\.?$" % (CLOCK, CLOCK), re.I)


def clocks(schedule):
    """["HH:MM"] or ["HH:MM", "HH:MM"] when the schedule says one clock time or
    a range of two and nothing else; [] for anything vaguer ("Todo o dia")."""
    text = re.sub(r"\s+", " ", schedule).strip() if isinstance(schedule, str) else ""
    match = ONE_TIME_RE.match(text) or RANGE_RE.match(text)
    if not match:
        return []
    groups, found = match.groups(), []
    for at in range(0, len(groups), 3):
        hour, minute = int(groups[at]), int(groups[at + 1] or groups[at + 2] or 0)
        if hour > 23 or minute > 59:
            return []
        found.append("%02d:%02d" % (hour, minute))
    return found


def with_schedule(start, end, schedule):
    """(start, end) with the schedule's clock times on a day-only start (and a
    day-only end on the same day, for a range)."""
    times = clocks(schedule)
    if not times or not start or len(start) != 10:
        return start, end
    if len(times) == 2 and (end is None or end == start):
        end = "%s %s" % (start, times[1])
    return "%s %s" % (start, times[0]), end


def excerpt_of(description):
    """The description's text, cut at a space to about EXCERPT_CAP characters."""
    if not isinstance(description, str):
        return None
    text = visible_text(description, 10 ** 9)[0]
    if len(text) > EXCERPT_CAP:
        text = text[:EXCERPT_CAP]
        cut = max(text.rfind(" "), text.rfind("\n"))
        text = text[:cut] if cut > EXCERPT_CAP // 2 else text
    return text.strip() or None


def details(source, pages, window):
    """One detail per followed page, read from its payload; a page whose
    payload has another shape is read as any page (common.extract_detail), and
    one that neither reads is left out."""
    found = []
    for page in pages:
        try:
            source_page = decode(page.body, page.content_type)
            data = module_data(source_page)
            start = local_stamp(data.get("startDate"))
            end = local_stamp(data.get("endDate"))
            end = None if end == start else end
            schedule = resolve(payload(source_page), data.get("schedule"))
            schedule = re.sub(r"\s+", " ", schedule).strip() if isinstance(schedule, str) else ""
            start, end = with_schedule(start, end, schedule)
            excerpt = excerpt_of(resolve(payload(source_page), data.get("description")))
            if schedule:
                excerpt = "Hor\u00e1rio: %s%s" % (schedule, "\n" + excerpt if excerpt else "")
            found.append({"url": page.url, "title": plain(data.get("title")), "start": start,
                          "end": end, "venue": None, "excerpt": excerpt})
        except Exception:
            try:
                found.append(extract_detail(page))
            except Exception:
                continue
    return found
