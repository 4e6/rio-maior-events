#!/usr/bin/env python3
"""Check an events file and turn it into one self-contained page.

    python3 scripts/render.py rio-maior-events.json rio-maior-events.html     0 wrote it, 2 could not

The output is a single file: the stylesheet and the script beside this one are
inlined into it, and the events travel inside it as JSON. The page draws itself
from that JSON when it is opened, and everything that depends on today -- the
This weekend / Next week / Later bands, hiding past events, the Weekend chip,
the notice on a page that has gone stale -- is worked out there, in the viewer's
browser, never here. A <noscript> list is the only markup written for a viewer
without a script.

Exit 2 means the file cannot be rendered: it is not JSON, or it breaks a rule in
references/events-schema.json. Each problem is printed on its own line with the
event it belongs to, at most 20 of them. Fix those and run it again. Exit 0
prints a line saying where it wrote, rather than staying silent.

The model does not write an event's id. It is made here from the event itself --
the title, the start date and the town, with accents, case and spacing ignored --
so the same event keeps its id when the agenda is made again, and the page can
tell what is new since its viewer was last there.

Anything that is not an http:// or https:// address is dropped from a link and
its text kept. Everything written into the page is escaped, and the JSON is
written with < > & as \\u escapes so no event can close the script around it.

Python 3.9, standard library only, no network. It reads the events file and the
two assets, and writes the one file it was told to write. The output depends on
the events file alone -- no clock -- so a fixed input gives the same bytes.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import html
import json
import re
import sys
import unicodedata
from pathlib import Path

sys.dont_write_bytecode = True

ASSETS = Path(__file__).resolve().parent.parent / "assets"

CATEGORIES = (
    "music", "theatre", "cinema", "festival", "market", "sport",
    "exhibition", "kids", "food", "nature", "workshop", "other",
)
KINDS = ("single", "multi_day", "ongoing", "recurring")
MAX_PROBLEMS = 20
MAX_MULTI_DAY = 7

EVENT_KEYS = (
    "title_pt", "title_en", "category", "kind", "start_date", "end_date",
    "start_time", "dates", "recurrence", "date_tbc", "venue", "town",
    "drive_min", "price", "kids", "description_en", "sources", "confidence",
    "caveat",
)

DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MONTH = re.compile(r"^\d{4}-\d{2}$")
TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}")


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " ".join(text.casefold().split())


def event_id(event: dict) -> str:
    key = normalise(event["title_pt"]) + "|" + event["start_date"] + "|" + normalise(event["town"])
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:10]


def real_date(text):
    if not isinstance(text, str) or not DATE.match(text):
        return None
    try:
        return datetime.date.fromisoformat(text)
    except ValueError:
        return None


def real_month(text) -> bool:
    return isinstance(text, str) and bool(MONTH.match(text)) and 1 <= int(text[5:7]) <= 12


def text_ok(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def check_event(e: dict, window=None) -> list:
    """What is wrong with one event, as short sentences.

    window is the (start, end) pair of dates the agenda covers, or None when the
    window itself is wrong and the events cannot be judged against it.
    """
    bad = []
    for key in EVENT_KEYS:
        if key not in e:
            bad.append("missing " + key)
    for key in e:
        if key not in EVENT_KEYS and key != "id":
            bad.append("unknown field " + key)
    if bad:
        return bad
    for key in ("title_pt", "title_en", "town"):
        if not text_ok(e[key]):
            bad.append(key + " must be a non-empty string")
    if e["category"] not in CATEGORIES:
        bad.append("category must be one of " + ", ".join(CATEGORIES))
    if e["kind"] not in KINDS:
        bad.append("kind must be one of " + ", ".join(KINDS))
    if not isinstance(e["date_tbc"], bool):
        bad.append("date_tbc must be true or false")
    if e["start_time"] is not None and not (isinstance(e["start_time"], str) and TIME.match(e["start_time"])):
        bad.append("start_time must be HH:MM or null")
    tbc = e["date_tbc"] is True
    start = real_date(e["start_date"])
    if tbc:
        if not (real_month(e["start_date"]) or start):
            bad.append("start_date must be YYYY-MM or YYYY-MM-DD, got " + repr(e["start_date"]))
        for key in ("end_date", "start_time", "dates"):
            if e[key] is not None:
                bad.append(key + " must be null while date_tbc is true")
        if e["kind"] == "recurring":
            bad.append("a recurring event has dates; with date_tbc true use another kind")
        if window and isinstance(e["start_date"], str) and (start or real_month(e["start_date"])):
            if not window[0].isoformat()[:len(e["start_date"])] <= e["start_date"] <= window[1].isoformat()[:len(e["start_date"])]:
                bad.append("start_date %s is outside the window %s to %s" % (e["start_date"], window[0], window[1]))
    else:
        if start is None:
            bad.append("start_date must be a real date YYYY-MM-DD, got " + repr(e["start_date"]))
        end = real_date(e["end_date"]) if e["end_date"] is not None else None
        if e["end_date"] is not None and end is None:
            bad.append("end_date must be a real date YYYY-MM-DD or null, got " + repr(e["end_date"]))
        kind = e["kind"]
        if kind == "single" and e["end_date"] is not None:
            bad.append("a single event has end_date null")
        if kind == "multi_day" and (end is None or (start and end <= start)):
            bad.append("a multi_day event needs an end_date after start_date")
        elif kind == "multi_day" and start and (end - start).days >= MAX_MULTI_DAY:
            bad.append("a multi_day event spans at most %d days; use ongoing" % MAX_MULTI_DAY)
        if kind == "ongoing" and (end is None or (start and end < start)):
            bad.append("an ongoing event needs an end_date, not before start_date")
        if kind == "recurring":
            dates = e["dates"]
            if dates is not None and not (isinstance(dates, list) and all(real_date(d) for d in dates)):
                bad.append("dates must be a list of real dates YYYY-MM-DD or null")
            if not dates and not text_ok(e["recurrence"]):
                bad.append("a recurring event needs dates or a recurrence")
        elif e["dates"] is not None:
            bad.append("dates is only for recurring events")
        if window and start:
            last = end or start
            if last < window[0] or start > window[1]:
                bad.append("the event (%s to %s) is entirely outside the window %s to %s; drop it"
                           % (start, last, window[0], window[1]))
            if kind == "recurring" and isinstance(e["dates"], list):
                for d in e["dates"]:
                    day = real_date(d)
                    if day and not window[0] <= day <= window[1]:
                        bad.append("dates has %s, outside the window %s to %s" % (d, window[0], window[1]))
    for key in ("venue", "description_en", "recurrence"):
        if e[key] is not None and not isinstance(e[key], str):
            bad.append(key + " must be a string or null")
    d = e["drive_min"]
    if d is not None and not (isinstance(d, int) and not isinstance(d, bool) and d >= 0):
        bad.append("drive_min must be a whole number of minutes or null")
    p = e["price"]
    if p is not None and not (
        isinstance(p, dict) and set(p) == {"free", "text"}
        and isinstance(p["free"], bool) and text_ok(p["text"])
    ):
        bad.append("price must be null or {free: true/false, text: non-empty}")
    if not isinstance(e["kids"], bool):
        bad.append("kids must be true or false")
    s = e["sources"]
    if not (isinstance(s, list) and s):
        bad.append("sources needs at least one {name, url}")
    elif not all(isinstance(x, dict) and text_ok(x.get("name")) and isinstance(x.get("url"), str) for x in s):
        bad.append("every source needs a name and a url string")
    if e["confidence"] not in ("high", "low"):
        bad.append("confidence must be high or low")
    elif e["confidence"] == "low" and not text_ok(e["caveat"]):
        bad.append("low confidence needs a caveat saying what to check")
    elif e["caveat"] is not None and not isinstance(e["caveat"], str):
        bad.append("caveat must be a string or null")
    return bad


def check(data) -> list:
    """Every problem in the document, each tagged with the event it belongs to."""
    if not isinstance(data, dict):
        return ["the file must hold one JSON object"]
    problems = []
    for key in ("generated_at", "window", "origin", "sources_checked", "events"):
        if key not in data:
            problems.append("missing " + key)
    if problems:
        return problems
    if not (isinstance(data["generated_at"], str) and STAMP.match(data["generated_at"])):
        problems.append("generated_at must be an ISO date and time, like 2026-10-20T08:15:00+01:00")
    w = data["window"]
    ws = real_date(w.get("start")) if isinstance(w, dict) else None
    we = real_date(w.get("end")) if isinstance(w, dict) else None
    window = None
    if ws is None or we is None:
        problems.append("window needs real start and end dates, YYYY-MM-DD")
    elif we < ws:
        problems.append("window.end is before window.start")
    else:
        window = (ws, we)
    if not text_ok(data["origin"]):
        problems.append("origin must be a non-empty string")
    if "note" in data and not isinstance(data["note"], str):
        problems.append("note must be a string")
    sc = data["sources_checked"]
    if not isinstance(sc, list) or not all(
        isinstance(x, dict) and text_ok(x.get("name")) and isinstance(x.get("url"), str)
        and isinstance(x.get("ok"), bool) for x in sc
    ):
        problems.append("sources_checked must be a list of {name, url, ok}")
    events = data["events"]
    if not isinstance(events, list):
        return problems + ["events must be a list"]
    seen = {}
    for i, e in enumerate(events):
        if not isinstance(e, dict):
            problems.append("events[%d]: must be an object" % i)
            continue
        label = "events[%d] %s" % (i, json.dumps(e.get("title_pt", ""), ensure_ascii=False))
        found = check_event(e, window)
        problems.extend(label + ": " + m for m in found)
        if not found:
            eid = event_id(e)
            if eid in seen:
                problems.append("%s: same event as events[%d] (same title, date and town); merge them" % (label, seen[eid]))
            seen[eid] = i
    return problems


def safe_url(url: str) -> str:
    return url if re.match(r"^https?://", url, re.I) else ""


def page_data(data: dict) -> dict:
    out = {k: data[k] for k in ("generated_at", "window", "origin")}
    if data.get("note"):
        out["note"] = data["note"]
    out["sources_checked"] = [dict(s, url=safe_url(s["url"])) for s in data["sources_checked"]]
    events = []
    for e in data["events"]:
        item = {"id": event_id(e)}
        item.update({k: e[k] for k in EVENT_KEYS})
        item["sources"] = [{"name": s["name"], "url": safe_url(s["url"])} for s in e["sources"]]
        events.append(item)
    out["events"] = events
    return out


def embed(data: dict) -> str:
    text = json.dumps(data, ensure_ascii=False, indent=1)
    for ch, esc in (("<", "\\u003c"), (">", "\\u003e"), ("&", "\\u0026"), (" ", "\\u2028"), (" ", "\\u2029")):
        text = text.replace(ch, esc)
    return text


def x(text) -> str:
    return html.escape(str(text), quote=True)


def plain_list(data: dict) -> str:
    def key(e):
        return (e["date_tbc"], e["start_date"], e["start_time"] or "", e["title_pt"])

    items = []
    for e in sorted(data["events"], key=key):
        if e["date_tbc"]:
            when = "Date to be confirmed (" + e["start_date"] + ")"
        elif e["kind"] == "recurring":
            when = e["recurrence"] or ", ".join(e["dates"])
        elif e["end_date"]:
            when = e["start_date"] + " to " + e["end_date"]
        else:
            when = e["start_date"]
        if e["start_time"]:
            when += " " + e["start_time"]
        title = x(e["title_pt"]) + ("" if e["title_en"] == e["title_pt"] else " / " + x(e["title_en"]))
        src = e["sources"][0]
        href = safe_url(src["url"])
        link = '<a href="%s">%s</a>' % (x(href), x(src["name"])) if href else x(src["name"])
        items.append("<li><strong>%s</strong> %s, %s. %s</li>" % (x(when), title, x(e["town"]), link))
    return "\n".join(items)


def build(data: dict, css: str, js: str) -> str:
    return PAGE.format(
        css=css,
        origin=x(data["origin"]),
        window="%s to %s" % (data["window"]["start"], data["window"]["end"]),
        plain=plain_list(data),
        data=embed(page_data(data)),
        js=js,
    )


PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>What's on around Rio Maior</title>
<style>
{css}</style>
</head>
<body>
<noscript><div class="plain"><h1>What's on around {origin}</h1><p>{window}. This page draws its calendar with a script; the events are listed here by date.</p><ul>
{plain}
</ul></div></noscript>
<div class="page">
  <header class="masthead">
    <div>
      <h1 id="title">What's on around {origin}</h1>
      <p class="meta" id="meta"></p>
    </div>
    <button class="theme-btn" id="theme-btn" type="button" aria-label="Colour theme"></button>
  </header>
  <div id="notice"></div>
  <div class="strip-wrap" id="strip-wrap"><nav class="strip" id="strip" aria-label="Jump to day"></nav></div>
  <div class="layout">
    <aside class="rail" id="rail" aria-label="Calendar"></aside>
    <main id="main">
      <section class="filters" id="filters" aria-label="Filters"></section>
      <div id="blocks"></div>
      <div id="list"></div>
      <div id="tbc"></div>
      <footer class="sources" id="sources"></footer>
    </main>
  </div>
</div>
<script type="application/json" id="events-data">
{data}
</script>
<script>
{js}</script>
</body>
</html>
"""


def main(argv=None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Check an events file and render it as one page.")
    parser.add_argument("path", help="the events document, rio-maior-events.json")
    parser.add_argument("out", help="where to write the page, rio-maior-events.html")
    args = parser.parse_args(argv)

    try:
        css = (ASSETS / "page.css").read_text(encoding="utf-8")
        js = (ASSETS / "page.js").read_text(encoding="utf-8")
    except OSError as error:
        print("could not render: the skill's own assets are missing (" + str(error) + ")", file=sys.stderr)
        return 2
    if "</style" in css.lower() or "</script" in js.lower():
        print("could not render: an asset would close its own element", file=sys.stderr)
        return 2
    try:
        data = json.loads(Path(args.path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        print("could not read " + args.path + ": " + str(error), file=sys.stderr)
        return 2
    problems = check(data)
    if problems:
        print("could not render " + args.path + ": " + str(len(problems)) + " problems", file=sys.stderr)
        for line in problems[:MAX_PROBLEMS]:
            print("  " + line, file=sys.stderr)
        if len(problems) > MAX_PROBLEMS:
            print("  ... and %d more" % (len(problems) - MAX_PROBLEMS), file=sys.stderr)
        return 2
    try:
        Path(args.out).write_bytes(build(data, css, js).encode("utf-8"))
    except OSError as error:
        print("could not write " + args.out + ": " + str(error), file=sys.stderr)
        return 2
    print(
        "wrote %s: %d events, from %s to %s"
        % (args.out, len(data["events"]), data["window"]["start"], data["window"]["end"])
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
