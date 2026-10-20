"""What every adapter shares: the request and page shapes, the visible text of
a page, the schema.org events in its JSON-LD, window tests and item helpers.

Python 3.9, standard library only. Nothing here touches the network.
"""

from __future__ import annotations

import collections
import datetime
import html
import json
import re
from html.parser import HTMLParser

TEXT_CAP = 30000
DESCRIPTION_CAP = 300
MIN_TEXT = 200

Request = collections.namedtuple("Request", "url data", defaults=(None,))
Page = collections.namedtuple("Page", "url status body content_type")


class AdapterError(Exception):
    """The pages cannot be read; the message becomes the source's error."""


def lisbon_time(moment):
    """A UTC datetime in mainland Portugal time: UTC+1 from the last Sunday of
    March to the last Sunday of October, at 01:00 UTC both ways, else UTC."""
    def last_sunday(month):
        day = datetime.datetime(moment.year, month, 31, 1, tzinfo=datetime.timezone.utc)
        return day - datetime.timedelta(days=(day.weekday() + 1) % 7)
    summer = last_sunday(3) <= moment < last_sunday(10)
    return moment.astimezone(datetime.timezone(datetime.timedelta(hours=1 if summer else 0)))



SKIP_TAGS = {"script", "style", "noscript", "svg", "template"}
# Page chrome, dropped unless inside an article or main, where a card keeps its
# title and date in a header.
CHROME_TAGS = {"nav", "header", "footer"}
CONTENT_TAGS = {"article", "main"}
# Inline tags that can mark up part of a word or number ("Sá<b>b</b>",
# "6<sup>ª</sup>"): they part two words only when one ends and the next
# begins at once ("<em>sab</em><em>24</em>").
PHRASING_TAGS = {"b", "strong", "i", "em", "u", "sup", "sub", "small", "mark", "abbr", "s"}
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
             "meta", "source", "track", "wbr"}
BLOCK_TAGS = {"address", "article", "aside", "blockquote", "br", "dd", "div", "dl",
              "dt", "fieldset", "figcaption", "figure", "form", "h1", "h2", "h3",
              "h4", "h5", "h6", "hr", "li", "main", "ol", "p", "pre", "section",
              "table", "td", "th", "tr", "ul"}


class _TextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.content = 0
        self.chrome = []
        self.parts = []
        self.gap = False
        self.closed = False

    def handle_starttag(self, tag, attrs):
        if tag in VOID_TAGS:
            if tag in BLOCK_TAGS:
                self.parts.append("\n")
            return
        if tag in CONTENT_TAGS:
            self.content += 1
        if tag in CHROME_TAGS:
            self.chrome.append(not self.content)
            self.skip += not self.content
        elif tag in SKIP_TAGS:
            self.skip += 1
        self._boundary(tag)

    def handle_startendtag(self, tag, attrs):
        if tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in CONTENT_TAGS:
            self.content = max(0, self.content - 1)
        if tag in CHROME_TAGS:
            if self.chrome and self.chrome.pop():
                self.skip = max(0, self.skip - 1)
        elif tag in SKIP_TAGS:
            self.skip = max(0, self.skip - 1)
        self._boundary(tag, end=True)

    def _boundary(self, tag, end=False):
        if tag in BLOCK_TAGS:
            self.parts.append("\n")
        elif tag not in PHRASING_TAGS or (self.closed and not end):
            self.gap = True
        self.closed = end

    def handle_data(self, data):
        if self.skip or not data:
            return
        # Another inline element starts a new field ("2026" then "dom"): keep
        # a space between two letters or digits, but not before "," or ":".
        if self.gap and self.parts and self.parts[-1][-1:].isalnum() and data[0].isalnum():
            self.parts.append(" ")
        self.gap = self.closed = False
        self.parts.append(data)


TAGLIKE_RE = re.compile(r'^<([!?]|/?[A-Za-z][\w:.-]*(\s|/?>|$))|\b\w+="[^"]*"\s+\w+="|="[^"]*"/?>$')


def _markup_line(line):
    """A line that is leftover markup (Office XML, say): a tag, attributes, mso- styles.
    "<18 anos" is text."""
    return bool(TAGLIKE_RE.search(line)) or "mso-" in line or "w:Lsd" in line or "UnhideWhenUsed=" in line


def visible_text(page, cap=TEXT_CAP):
    """Visible text of an HTML page as (text, truncated), without lines that
    are leftover markup."""
    parser = _TextParser()
    parser.feed(page)
    parser.close()
    lines = []
    for line in "".join(parser.parts).split("\n"):
        line = re.sub(r"[ \t\r\f\v ]+", " ", html.unescape(line)).strip()
        if line and not _markup_line(line):
            lines.append(line)
    text = "\n".join(lines)
    if len(text) > cap:
        return text[:cap], True
    return text, False


JSONLD_RE = re.compile(
    r"<script[^>]*type\s*=\s*[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
    re.I | re.S,
)


def _flatten(node):
    if isinstance(node, list):
        for child in node:
            yield from _flatten(child)
    elif isinstance(node, dict):
        yield node
        for key in ("@graph", "itemListElement", "item"):
            if key in node:
                yield from _flatten(node[key])


def _has_event_type(node):
    kinds = node.get("@type")
    if isinstance(kinds, str):
        kinds = [kinds]
    return any(isinstance(k, str) and k.endswith("Event") for k in kinds or [])


def _first(value):
    if isinstance(value, list):
        return _first(value[0]) if value else None
    return value


def _event_item(node):
    location = _first(node.get("location"))
    place = locality = None
    if isinstance(location, dict):
        place = location.get("name")
        address = _first(location.get("address"))
        if isinstance(address, dict):
            locality = address.get("addressLocality")
        elif isinstance(address, str):
            locality = address
    elif isinstance(location, str):
        place = location
    offers = _first(node.get("offers"))
    price = None
    if isinstance(offers, dict):
        price = offers.get("price", offers.get("lowPrice"))
    description = node.get("description")
    if isinstance(description, str):
        description = html.unescape(re.sub(r"\s+", " ", description)).strip()[:DESCRIPTION_CAP]
    url = node.get("url")
    return {
        "name": html.unescape(node["name"]).strip() if isinstance(node.get("name"), str) else None,
        "startDate": node.get("startDate"),
        "endDate": node.get("endDate"),
        "location": place,
        "addressLocality": locality,
        "url": url if isinstance(url, str) else None,
        "price": price,
        "description": description,
    }


def iso_day(value):
    if isinstance(value, str) and re.match(r"\d{4}-\d{2}-\d{2}", value):
        return value[:10]
    return None


def in_window(start, end, window):
    """True unless the dates are readable and the event falls outside the window.

    An event that began before the window but ends inside it is kept.
    """
    first, last = iso_day(start), iso_day(end)
    if window is None or first is None:
        return True
    last = last or first
    return first <= window[1] and last >= window[0]


def extract_jsonld_events(page, window=None):
    """Event objects from a page's JSON-LD blocks; bad blocks are skipped."""
    events = []
    for block in JSONLD_RE.findall(page):
        try:
            data = json.loads(html.unescape(block) if "&quot;" in block else block)
        except ValueError:
            continue
        for node in _flatten(data):
            if _has_event_type(node):
                item = _event_item(node)
                if in_window(item["startDate"], item["endDate"], window):
                    events.append(item)
    return events


def plain(value, cap=None):
    """Text of a string that may hold entities and tags, on one line."""
    if not isinstance(value, str):
        return None
    value = html.unescape(re.sub(r"<[^>]*>", " ", html.unescape(value)))
    value = re.sub(r"\s+", " ", value).strip()
    return (value[:cap] if cap else value) or None


def make_item(title, start, end, venue=None, url=None, price=None, description=None):
    return {"title": plain(title), "start": start, "end": end, "venue": plain(venue),
            "url": url, "price": price or None, "description": plain(description, DESCRIPTION_CAP)}


def keep_window(items, window):
    return [i for i in items if in_window(i["start"], i["end"], window)]


def decode(body, content_type):
    match = re.search(r"charset=([\w-]+)", content_type or "", re.I)
    for charset in (match.group(1) if match else None, "utf-8"):
        if charset:
            try:
                return body.decode(charset)
            except (UnicodeDecodeError, LookupError):
                pass
    return body.decode("latin-1")

