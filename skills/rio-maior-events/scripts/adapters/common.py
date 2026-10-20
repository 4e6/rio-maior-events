"""What every adapter shares: the request and page shapes, the visible text of
a page (with markers for its event links), the details of an event page, the
schema.org events in its JSON-LD, the XML guards, window tests and item helpers.

Python 3.9, standard library only. Nothing here touches the network.
"""

from __future__ import annotations

import collections
import datetime
import html
import json
import re
import unicodedata
import urllib.parse
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

TEXT_CAP = 30000
DESCRIPTION_CAP = 300
MIN_TEXT = 200
EXCERPT_CAP = 800

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


MARK = "\ue000"  # starts a marker line while the text is built


def clean_url(base, href):
    """An absolute http(s) URL for an href: resolved against base, fragment
    dropped, spaces and non-ASCII characters percent-encoded; None otherwise."""
    if not isinstance(href, str) or not href.strip():
        return None
    parts = urllib.parse.urlsplit(urllib.parse.urljoin(base or "", href.strip()))
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    keep = "/%:@!$&'()*+,;=~-._"
    host = parts.netloc
    if host.endswith((":443", ":80")) and parts.port == (443 if parts.scheme == "https" else 80):
        host = host.rsplit(":", 1)[0]
    return urllib.parse.urlunsplit((
        parts.scheme, host, urllib.parse.quote(parts.path, safe=keep),
        urllib.parse.quote(parts.query, safe=keep + "?"), ""))


def same_site(url, other):
    """Whether two URLs have the same host, ignoring a leading "www." """
    return _bare_host(url) == _bare_host(other)


def _bare_host(url):
    host = urllib.parse.urlsplit(url).hostname or ""
    return host[4:] if host.startswith("www.") else host


class _TextParser(HTMLParser):
    def __init__(self, base=None, links=None):
        super().__init__(convert_charrefs=True)
        self.base = base
        self.links = links
        self.anchor = None
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
        elif tag == "a" and self.links is not None:
            self._open_anchor(dict(attrs).get("href"), dict(attrs).get("title"))
        self._boundary(tag)

    def _open_anchor(self, href, title=None):
        self._close_anchor()
        url = clean_url(self.base, href)
        if self.skip or not url or _bare_host(url) != _bare_host(self.base or ""):
            return
        parts = urllib.parse.urlsplit(url)
        if self.links.search(parts.path + ("?" + parts.query if parts.query else "")):
            self.anchor = (len(self.parts), url, re.sub(r"\s+", " ", title or "").strip())

    def _close_anchor(self):
        """Writes the marker of the open anchor before its text. An anchor with
        no text or only digits (a page number, a day) is marked only when it has
        a title attribute, which is written on the line after the marker."""
        if self.anchor is None:
            return
        index, url, title = self.anchor
        self.anchor = None
        label = re.sub(r"\s+", "", "".join(self.parts[index:]))
        if label and not label.isdigit():
            self.parts[index:index] = ["\n", MARK + url, "\n"]
        elif title:
            self.parts[index:index] = ["\n", MARK + url, "\n", title.replace(MARK, ""), "\n"]

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
        elif tag == "a":
            self._close_anchor()
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
        self.parts.append(data.replace(MARK, ""))


TAGLIKE_RE = re.compile(r'^<([!?]|/?[A-Za-z][\w:.-]*(\s|/?>|$))|\b\w+="[^"]*"\s+\w+="|="[^"]*"/?>$')


def _markup_line(line):
    """A line that is leftover markup (Office XML, say): a tag, attributes, mso- styles.
    "<18 anos" is text."""
    return bool(TAGLIKE_RE.search(line)) or "mso-" in line or "w:Lsd" in line or "UnhideWhenUsed=" in line


def visible_text_links(page, cap=TEXT_CAP, base=None, links=None):
    """Visible text of an HTML page as (text, truncated, urls), without lines
    that are leftover markup.

    With `links` (a compiled regex tested on an href's path and query) and
    `base` (the page's URL), a line `<https://absolute/url>` is written at the
    position of each matching anchor that has text other than digits, outside
    the page chrome; a marker equal to the line before it is dropped. `urls`
    are the distinct marker URLs in the text kept, in page order.
    """
    parser = _TextParser(base, links)
    parser.feed(page)
    parser.close()
    parser._close_anchor()
    lines, marks = [], []
    for line in "".join(parser.parts).split("\n"):
        if line.startswith(MARK):
            line = "<%s>" % line[1:].strip()
            if lines and lines[-1] == line:
                continue
            marks.append((sum(len(l) + 1 for l in lines), line[1:-1]))
            lines.append(line)
            continue
        line = re.sub(r"[ \t\r\f\v ]+", " ", html.unescape(line)).strip()
        if line and not _markup_line(line):
            lines.append(line)
    text = "\n".join(lines)
    truncated = len(text) > cap
    urls = []
    for offset, url in marks:
        if offset + len(url) + 2 <= cap and url not in urls:
            urls.append(url)
    return (text[:cap] if truncated else text), truncated, urls


def visible_text(page, cap=TEXT_CAP):
    """Visible text of an HTML page as (text, truncated), without lines that
    are leftover markup."""
    return visible_text_links(page, cap)[:2]


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



def xml_root(body):
    """The root element of an XML feed, read only when it is safe: ASCII-
    compatible, with no DOCTYPE or ENTITY declaration."""
    if b"\x00" in body or body.startswith((b"\xff\xfe", b"\xfe\xff")):
        raise AdapterError("feed is UTF-16 or UTF-32, not ASCII-compatible; not read")
    if re.search(rb"<!(DOCTYPE|ENTITY)", body, re.I):
        raise AdapterError("feed has a DOCTYPE or ENTITY declaration; not read")
    try:
        return ET.fromstring(body)
    except ET.ParseError:
        raise AdapterError("feed is not valid XML")


# An event page's own fields: the title, when it says more than a category;
# the start, end and venue from the page's structured data; and its first text.
PLACEHOLDERS = {
    "concerto", "cinema", "teatro", "danca", "exposicao", "musica", "evento", "eventos",
    "espetaculo", "espectaculo", "conferencia", "workshop", "desporto", "festa", "feira",
    "formacao", "literatura", "humor", "outros"}
ATC_RE = re.compile(
    r"<(\w+)[^>]*\bclass\s*=\s*[\"'][^\"']*\batc_(date_start|date_end|location)\b[^\"']*[\"'][^>]*>"
    r"(.*?)</\1\s*>", re.S)
ICAL_RE = re.compile(r"href\s*=\s*[\"']data:text/calendar[^,\"']*,([^\"']*)[\"']", re.I)
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
OG_TITLE_RE = re.compile(
    r"<meta\s[^>]*?\bproperty\s*=\s*[\"']og:title[\"'][^>]*>", re.I)
CONTENT_RE = re.compile(r"\bcontent\s*=\s*(\"([^\"]*)\"|'([^']*)')", re.I)


def _fold(value):
    """Lower case without accents, to compare a title with a category word."""
    value = re.sub(r"[̀-ͯ]", "", unicodedata.normalize("NFD", value))
    return value.casefold().strip()


def _placeholder(value):
    return not value or _fold(value) in PLACEHOLDERS


def _stamp(date, clock):
    """"YYYY-MM-DD HH:MM", or the day alone when there is no time or it is midnight."""
    if clock is None or clock[:5] in ("00:00", ""):
        return date
    return "%s %s" % (date, clock[:5])


def _local(value):
    """(date, "HH:MM" or None) from an ISO date or time, an atc value or an iCal
    one; a trailing Z is UTC and becomes Lisbon time."""
    value = (value or "").strip()
    match = re.match(r"(\d{4})-?(\d{2})-?(\d{2})(?:[T ](\d{2}):?(\d{2})(?::?(\d{2}))?)?(Z)?", value)
    if not match:
        return None, None
    year, month, day, hour, minute, _, utc = match.groups()
    if hour is None:
        return "%s-%s-%s" % (year, month, day), None
    if utc:
        moment = datetime.datetime(int(year), int(month), int(day), int(hour), int(minute),
                                   tzinfo=datetime.timezone.utc)
        moment = lisbon_time(moment)
        return moment.strftime("%Y-%m-%d"), moment.strftime("%H:%M")
    return "%s-%s-%s" % (year, month, day), "%s:%s" % (hour, minute)


def _span(start, end, venue):
    """The pieces of one source as (start, end, venue); start None when unreadable."""
    first, clock = _local(start)
    if first is None:
        return None, None, None
    start = _stamp(first, clock)
    last, closing = _local(end)
    finish = _stamp(last, closing) if last else None
    if finish == start:
        finish = None
    return start, finish, None if _placeholder(venue) else venue


def _jsonld_span(page):
    for event in extract_jsonld_events(page):
        found = _span(event["startDate"], event["endDate"], event["location"])
        if found[0]:
            return found
    return None, None, None


def _atc_span(page):
    fields = {name: plain(value) for _, name, value in ATC_RE.findall(page)}
    return _span(fields.get("date_start"), fields.get("date_end"), fields.get("location"))


def _ical_span(page):
    for body in ICAL_RE.findall(page):
        text = urllib.parse.unquote(html.unescape(body))
        text = re.sub(r"\r?\n[ \t]", "", text)
        fields = {}
        for line in re.split(r"\r?\n", text):
            name, _, value = line.partition(":")
            fields.setdefault(name.split(";")[0].strip().upper(), value.strip())
        venue = re.sub(r"\\(.)", r"\1", fields.get("LOCATION", "")).strip()
        found = _span(fields.get("DTSTART"), fields.get("DTEND"), venue)
        if found[0]:
            return found
    return None, None, None


def _page_title(page):
    """(og:title or <title>, the <title> line) as plain text; empty strings if none."""
    tag = TITLE_RE.search(page)
    line = plain(tag.group(1)) if tag else None
    for meta in OG_TITLE_RE.findall(page):
        content = CONTENT_RE.search(meta)
        value = html.unescape(content.group(2) or content.group(3) or "").strip() if content else ""
        if value:
            return value, line or ""
    if line:
        return re.split(r" \| | ‹ | — ", line)[0].strip(), line
    return "", ""


def _in_calendar(text, at):
    """Whether the lines after `at` read as a mini calendar or a menu: at least
    half of the next 12 non-empty lines are 3 characters or fewer (a day, a
    weekday abbreviation)."""
    lines = [line.strip() for line in text[at:].split("\n")[1:] if line.strip()][:12]
    return len(lines) >= 6 and sum(len(line) <= 3 for line in lines) * 2 >= len(lines)


def _excerpt(text, title, head):
    """About EXCERPT_CAP characters of text from the first mention of the title
    after the <title> line (or of its part before " - ", " | ", " ‹ ") that does
    not lead into a mini calendar, else from the start of the text after that
    line. A first line that starts with the title and is followed by a line that
    starts with the title's first 20 characters is dropped, so the title is not
    said twice."""
    start = 0
    if head and text.startswith(head):
        start = len(head)
    needles = [title] + [part for part in re.split(r" - | \| | ‹ ", title)[:1] if part != title]
    for needle in needles:
        first = text.find(needle, start) if needle else -1
        if first >= 0:
            found = first
            while found >= 0 and _in_calendar(text, found):
                found = text.find(needle, found + len(needle))
            start = found if found >= 0 else first
            break
    chunk = text[start:].strip()
    lines = chunk.split("\n", 2)
    if title and len(lines) > 1 and lines[0].startswith(title) and lines[1].startswith(title[:20]):
        chunk = chunk[len(lines[0]) + 1:].strip()
    if len(chunk) > EXCERPT_CAP:
        chunk = chunk[:EXCERPT_CAP]
        cut = max(chunk.rfind(" "), chunk.rfind("\n"))
        chunk = chunk[:cut] if cut > EXCERPT_CAP // 2 else chunk
    return chunk.strip() or None


def extract_detail(page):
    """What an event page says about itself, as a dict: url (the page's final
    URL), title, start, end ("YYYY-MM-DD HH:MM", or the day alone), venue and
    excerpt. A field the page does not give is None.

    The title is og:title (else <title>), None when it is only a category
    word. Start, end and venue come from the first of the page's JSON-LD Event,
    its `atc_date_start/end/location` elements and an inline iCal link; a start
    at midnight is a date without a time, an end equal to the start is no end.
    """
    source = decode(page.body, page.content_type)
    title, head = _page_title(source)
    start = end = venue = None
    for found in (_jsonld_span(source), _atc_span(source), _ical_span(source)):
        if start is None:
            start, end = found[0], found[1]
        venue = venue or found[2]
        if start and venue:
            break
    text, _, _ = visible_text_links(source, 10 ** 9)
    return {"url": page.url, "title": None if _placeholder(title) else title, "start": start,
            "end": end, "venue": venue, "excerpt": _excerpt(text, title, head)}


def default_details(source, pages, window):
    """extract_detail for each followed page; a page it cannot read is left out."""
    details = []
    for page in pages:
        try:
            details.append(extract_detail(page))
        except Exception:
            continue
    return details
