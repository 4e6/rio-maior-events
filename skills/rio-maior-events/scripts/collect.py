#!/usr/bin/env python3
"""Fetch the public event listings around Rio Maior into one JSON file.

    python3 scripts/collect.py rio-maior-collected.json [--from DATE] [--to DATE] [--only NAME ...]

The window is --from (default today) to --to (default 42 days later); events
outside it are dropped where their dates can be read. Each source is fetched
once, in turn, with a 20 second timeout and a pause between two requests to
the same site; after a refusal (403, 429, a 5xx), a timeout or a connection
error the rest of that site's pages are skipped. The reason this is a script: the cm
calendar needs a POST, and a script makes the run repeatable. A source that
fails is recorded with ok false and an error and the rest carry on. For every
page the file holds the schema.org Event objects found in its JSON-LD and the
visible text, capped; the cm-riomaior calendar is a JSON endpoint and holds
items only. Reading, dating and merging the events is left to whoever reads the
file.

Exit 0 when at least one source was read, even if others failed. Exit 2, with a
message on stderr, for a usage error or when every source failed.

The list of sources below is mirrored in references/sources.md; change both.

Python 3.9, standard library only. Read-only requests; TLS is always verified.
A site that refuses the request (a 403, a timeout) is recorded as failed and
not retried another way.
"""

from __future__ import annotations

import argparse
import datetime
import html
import json
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

TIMEOUT = 20
PAUSE = 1.5   # seconds between two requests to the same host
TEXT_CAP = 30000
DESCRIPTION_CAP = 300
DEFAULT_DAYS = 42
MIN_TEXT = 200
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 "
    "rio-maior-events/1.0 (personal events digest; one request per page)"
)

CM_BASE = "https://www.cm-riomaior.pt"
CM_CATEGORIES = "116,121,122,134,135,136,137,138,139"

# kind: cm_json (JSON endpoint), html_text (text only), html_jsonld (text and
# JSON-LD events; every html page gets both, the kind says what to expect).
SOURCES = [
    {"name": "cm-riomaior", "kind": "cm_json", "town": "Rio Maior",
     "url": CM_BASE + "/index.php?option=com_ajax&module=calendar&method=getEvents&format=json"},
    {"name": "cineteatro", "kind": "html_text", "town": "Rio Maior",
     "url": "https://www.cineteatrorm.pt/pt/agenda/"},
    {"name": "viralagenda-rio-maior", "kind": "html_text", "town": "Rio Maior",
     "url": "https://www.viralagenda.com/pt/santarem/rio-maior"},
    {"name": "viralagenda-santarem", "kind": "html_text", "town": "Santarém",
     "url": "https://www.viralagenda.com/pt/santarem/santarem"},
    {"name": "viralagenda-caldas-da-rainha", "kind": "html_text", "town": "Caldas da Rainha",
     "url": "https://www.viralagenda.com/pt/leiria/caldas-da-rainha"},
    {"name": "viralagenda-obidos", "kind": "html_text", "town": "Óbidos",
     "url": "https://www.viralagenda.com/pt/leiria/obidos"},
    {"name": "viralagenda-alcobaca", "kind": "html_text", "town": "Alcobaça",
     "url": "https://www.viralagenda.com/pt/leiria/alcobaca"},
    {"name": "viralagenda-torres-novas", "kind": "html_text", "town": "Torres Novas",
     "url": "https://www.viralagenda.com/pt/santarem/torres-novas"},
    {"name": "viralagenda-cartaxo", "kind": "html_text", "town": "Cartaxo",
     "url": "https://www.viralagenda.com/pt/santarem/cartaxo"},
    {"name": "viralagenda-porto-de-mos", "kind": "html_text", "town": "Porto de Mós",
     "url": "https://www.viralagenda.com/pt/leiria/porto-de-mos"},
    {"name": "viralagenda-bombarral", "kind": "html_text", "town": "Bombarral",
     "url": "https://www.viralagenda.com/pt/leiria/bombarral"},
    {"name": "portugalrunning-santarem", "kind": "html_text", "town": "Santarém",
     "url": "https://www.portugalrunning.com/corridas-santarem/"},
    {"name": "portugalrunning-leiria", "kind": "html_text", "town": "Leiria",
     "url": "https://www.portugalrunning.com/corridas-leiria/"},
    {"name": "portugalrunning-lisboa", "kind": "html_text", "town": "Lisboa",
     "url": "https://www.portugalrunning.com/corridas-lisboa/"},
    {"name": "cm-santarem", "kind": "html_text", "town": "Santarém",
     "url": "https://www.cm-santarem.pt/agenda"},
    {"name": "mcr-caldas", "kind": "html_text", "town": "Caldas da Rainha",
     "url": "https://mcr.pt/agenda"},
    {"name": "cm-torresnovas", "kind": "html_text", "town": "Torres Novas",
     "url": "https://www.cm-torresnovas.pt/index.php/comunicacao/agenda"},
    {"name": "cm-cartaxo", "kind": "html_text", "town": "Cartaxo",
     "url": "https://www.cm-cartaxo.pt/informacao/agenda"},
    {"name": "eventbrite", "kind": "html_jsonld", "town": "Rio Maior",
     "url": "https://www.eventbrite.pt/d/portugal--rio-maior/events/"},
]

CM_NOTE = (
    "start is UTC as sent; local_start and date are mainland Portugal time. "
    "An all-day item can show 00:00 or 01:00 local: check it against the event page"
)


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
        self.parts.append("\n" if tag in BLOCK_TAGS else " ")

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
        self.parts.append("\n" if tag in BLOCK_TAGS else " ")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def visible_text(page, cap=TEXT_CAP):
    """Visible text of an HTML page as (text, truncated)."""
    parser = _TextParser()
    parser.feed(page)
    parser.close()
    lines = []
    for line in "".join(parser.parts).split("\n"):
        line = re.sub(r"[ \t\r\f\v ]+", " ", html.unescape(line)).strip()
        if line:
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


def _day(value):
    if isinstance(value, str) and re.match(r"\d{4}-\d{2}-\d{2}", value):
        return value[:10]
    return None


def in_window(start, end, window):
    """True unless the dates are readable and the event falls outside the window.

    An event that began before the window but ends inside it is kept.
    """
    first, last = _day(start), _day(end)
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


def parse_cm_json(raw, window):
    """Items of the cm-riomaior calendar inside the window (two ISO dates).

    The endpoint ignores dates and returns months of past events. `start` is
    kept as sent, in UTC; `local_start` and `date` are Portugal time.
    """
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
            "url": urllib.parse.urljoin(CM_BASE + "/", url) if url else None,
            "description": html.unescape(entry.get("description") or "").strip(),
        })
    items.sort(key=lambda item: item["start"])
    return items


def _decode(body, content_type):
    match = re.search(r"charset=([\w-]+)", content_type or "", re.I)
    for charset in (match.group(1) if match else None, "utf-8"):
        if charset:
            try:
                return body.decode(charset)
            except (UnicodeDecodeError, LookupError):
                pass
    return body.decode("latin-1")


def fetch(url, data=None):
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.5"}
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    request = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.status, response.read(), response.headers.get("Content-Type")


def cm_request_body():
    fields = [("catid[]", c) for c in CM_CATEGORIES.split(",")]
    fields += [("description_length", "100"), ("show_child_category_articles", "0"), ("moduleId", "223")]
    return urllib.parse.urlencode(fields).encode("ascii")


def collect_source(source, window):
    result = {
        "name": source["name"], "url": source["url"], "town": source["town"],
        "kind": source["kind"], "ok": False, "status": None, "error": None,
        "items": [], "text": None, "truncated": False,
    }
    try:
        if source["kind"] == "cm_json":
            status, body, _ = fetch(source["url"], cm_request_body())
            result["status"] = status
            result["items"] = parse_cm_json(body, window)
            result["note"] = CM_NOTE
            if not result["items"]:
                result["note"] = "0 items in window; " + CM_NOTE
        else:
            status, body, content_type = fetch(source["url"])
            result["status"] = status
            page = _decode(body, content_type)
            result["items"] = extract_jsonld_events(page, window)
            result["text"], result["truncated"] = visible_text(page)
            if not result["items"] and len(result["text"]) < MIN_TEXT:
                result["error"] = "no events or text found (layout may have changed)"
                return result
        result["ok"] = True
    except urllib.error.HTTPError as err:
        result["status"] = err.code
        result["error"] = "HTTP %d %s" % (err.code, err.reason)
        result["silent"] = err.code in (403, 429) or err.code >= 500
    except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as err:
        result["error"] = "%s: %s" % (type(err).__name__, err)
        result["silent"] = True
    except Exception as err:  # one source failing must not stop the others
        result["error"] = "%s: %s" % (type(err).__name__, err)
    return result


def summary_line(result):
    if not result["ok"]:
        return "%-30s FAILED  %s" % (result["name"], result["error"])
    text = "" if result["text"] is None else ", %d chars of text" % len(result["text"])
    return "%-30s ok  %d items%s%s" % (
        result["name"], len(result["items"]), text, " (truncated)" if result["truncated"] else "")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Collect event listings around Rio Maior.")
    parser.add_argument("out", help="path of the JSON file to write")
    parser.add_argument("--from", dest="start", metavar="YYYY-MM-DD", help="first day (default today)")
    parser.add_argument("--to", dest="end", metavar="YYYY-MM-DD", help="last day (default 42 days after --from)")
    parser.add_argument("--only", nargs="+", metavar="NAME", help="fetch only these sources")
    args = parser.parse_args(argv)

    names = [s["name"] for s in SOURCES]
    chosen = SOURCES
    if args.only:
        unknown = [n for n in args.only if n not in names]
        if unknown:
            print("unknown source: %s (known: %s)" % (", ".join(unknown), ", ".join(names)),
                  file=sys.stderr)
            return 2
        chosen = [s for s in SOURCES if s["name"] in args.only]

    now = datetime.datetime.now().astimezone()
    try:
        start = datetime.date.fromisoformat(args.start) if args.start else now.date()
        end = datetime.date.fromisoformat(args.end) if args.end else start + datetime.timedelta(days=DEFAULT_DAYS)
    except ValueError as err:
        print("bad date: %s" % err, file=sys.stderr)
        return 2
    if end < start:
        print("--to is before --from", file=sys.stderr)
        return 2
    window = (start.isoformat(), end.isoformat())
    results = []
    silent_hosts = set()
    seen_hosts = set()
    for source in chosen:
        host = urllib.parse.urlsplit(source["url"]).hostname
        if host in seen_hosts and host not in silent_hosts:
            time.sleep(PAUSE)
        seen_hosts.add(host)
        if host in silent_hosts:
            result = dict(name=source["name"], url=source["url"], town=source["town"],
                          kind=source["kind"], ok=False, status=None, items=[], text=None,
                          truncated=False, error="skipped: %s refused or did not answer" % host)
        else:
            result = collect_source(source, window)
            if result.pop("silent", False):
                silent_hosts.add(host)
        print(summary_line(result), flush=True)
        results.append(result)

    ok = sum(1 for r in results if r["ok"])
    if not ok:
        print("every source failed; nothing written", file=sys.stderr)
        return 2
    try:
        with open(args.out, "w", encoding="utf-8") as handle:
            json.dump({"collected_at": now.isoformat(timespec="seconds"),
                       "window": {"start": window[0], "end": window[1]}, "sources": results},
                      handle, ensure_ascii=False, indent=1)
            handle.write("\n")
    except OSError as err:
        print("cannot write %s: %s" % (args.out, err), file=sys.stderr)
        return 2
    print("wrote %s: %d sources ok, %d failed" % (args.out, ok, len(results) - ok))
    return 0


if __name__ == "__main__":
    sys.exit(main())
