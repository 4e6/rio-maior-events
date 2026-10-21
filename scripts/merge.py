#!/usr/bin/env python3
"""Join the readers' candidate files into one events file.

    python3 scripts/merge.py rio-maior-collected rio-maior-candidates rio-maior-events.json [--missing-ok]     0 wrote it, 2 could not
    python3 scripts/merge.py --finalize rio-maior-events.json                                                    0 rewrote it, 2 could not

The collect script writes rio-maior-collected/index.json and one file per
reading group. Each reader writes rio-maior-candidates/<group>.json:
{collected_at, group, events, hints, coverage}. An optional
rio-maior-candidates/manual.json, {collected_at, events, sources}, holds events
the model read itself and `sources` overrides {name, ok, error?} for sources it
read by hand after the script failed on them.

This script reads index.json and requires a candidates file for every group the
index lists, each with the same collected_at as the index. It names every group
whose file is missing, unreadable or stale, writes nothing, and exits 2.

With --missing-ok (for a run with nobody to have a group read again) such a
group is skipped instead: its sources go into sources_checked as ok false with
the error "not read" (a source that had failed with its own error keeps that
error), "missing group: <name>" is printed for it, and the rest is merged. A
broken index.json, a stale manual.json or no readable group at all still ends
in exit 2.

Otherwise it writes the events file: window and sources_checked from the index
(with the manual overrides applied), generated_at now with the local offset,
origin "Rio Maior", no note, and the events of every group in index order,
then the manual ones. It prints four blocks for the model to act on:

    hints:               each yearly-event hint with its group
    coverage:            each group's one-line coverage
    problems:            what render.py's check finds wrong in the written
                         events, each with the group the event came from (the
                         exit code stays 0; the model fixes them before rendering)
    possible duplicates: pairs of events, with index, title, start date and
                         town, by index in the written events list

A pair is possible when the towns match, the dates are close, and the titles
share at least half of the words of the shorter one (accents stripped, lookalike
Cyrillic and Greek letters read as Latin, case folded, words under three letters and common Portuguese function words
dropped). Towns match when they are equal once case and accents are ignored, or
when one is the other's parenthetical ("Cambelas (Torres Vedras)" and "Torres
Vedras"). Dates are close when the events' date ranges (start to end, a single
day when there is no end) overlap or are at most one day apart; both start
dates must be full dates. The script never merges them: whether two listings
are one event is for the model to decide. The file has no `note`: the model
writes it from the coverage lines. An event whose start_date is only a month
(date_tbc) is never paired.

--finalize EVENTS_JSON is a separate mode, the deterministic fallback that
guarantees a page: it takes an events file (the editor's, or this script's raw
output) and rewrites it in place so that render.py's check reports nothing.
It reads no other file. In order:

    drop      events that render.check_event rejects (checked against the
              file's own window); they are named, "title (start_date)", in `note`
    collapse  events with the same render.event_id into one, at the place of
              the first. The one kept is the best by, in order: a start_time
              over none, a single day (no end_date) over a range, a municipal
              or venue source over others. A source is municipal when its name,
              accents and case ignored, starts with "cm-" or "mcr", or has the
              word "municipio" or "municipal" or "camara" in it (the label
              "Municipio de Rio Maior"); it is a venue source when it contains
              the event's own `venue` or the venue contains it. Ties keep the
              first. The sources of all of them are combined, without
              duplicates (same name and url).
    keep      date_tbc events as they are unless check_event rejects them
    note      if `note` is missing or blank, it is written: "Not read: <the
              sources_checked entries with ok false and the error "not read">."
              if any, and a generic line saying the page was put together
              without a final edit. If there is a note it stays, and the
              sentence naming dropped events is appended.

Exit 2 (nothing written) when the file is not a JSON object with an events list
or when render.check still reports a problem outside the events (window,
generated_at, sources_checked, and so on), which this mode does not repair.

Python 3.9, standard library only, no network. The output depends on the input
files alone except generated_at, which main() takes from the clock unless a
test passes `now`.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import render  # noqa: E402

ORIGIN = "Rio Maior"
NOT_READ = "not read"
MAX_DAYS_APART = 1
MIN_OVERLAP = 0.5
STOPWORDS = frozenset(
    "com das dos del como para por que uma uns umas aos nas nos pelo pela "
    "este esta isto the and".split()
)
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# Letters of other alphabets that look like a Latin one, so that a title with a
# Cyrillic "е" still matches the same title in Latin letters.
LOOKALIKES = str.maketrans(
    "аеорсухіјѕАЕОРСУХІЈЅ" "οαε" "ΟΑΕ",
    "aeopcyxijsAEOPCYXIJS" "oae" "OAE",
)


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).translate(LOOKALIKES)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " ".join(text.casefold().split())


def tokens(title: str) -> frozenset:
    words = re.findall(r"[a-z0-9]+", normalise(title))
    return frozenset(w for w in words if len(w) >= 3 and w not in STOPWORDS)


def full_date(text):
    if not isinstance(text, str) or not DATE.match(text):
        return None
    try:
        return datetime.date.fromisoformat(text)
    except ValueError:
        return None


def town_names(town) -> frozenset:
    """The names a town goes by: whole, without its parenthetical, and the parenthetical."""
    if not isinstance(town, str):
        return frozenset()
    whole = normalise(town)
    names = {whole, normalise(re.sub(r"\(.*?\)", " ", town))}
    names.update(normalise(inner) for inner in re.findall(r"\((.*?)\)", town))
    return frozenset(n for n in names if n)


def day_range(e: dict):
    """(first, last) day of an event, or None when its start is not a full date."""
    first = full_date(e.get("start_date"))
    if first is None:
        return None
    last = full_date(e.get("end_date"))
    return first, (last if last and last >= first else first)


def load(path: Path, problems: list, what: str):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        problems.append("%s: missing (%s)" % (what, path))
    except (OSError, ValueError) as err:
        problems.append("%s: cannot read %s: %s" % (what, path, err))
    else:
        if isinstance(data, dict):
            return data
        problems.append("%s: %s must hold one JSON object" % (what, path))
    return None


def possible_duplicates(events: list) -> list:
    """Index pairs (i, j), i < j, that may be one event listed twice."""
    keys = []
    for e in events:
        ok = isinstance(e, dict)
        title = e.get("title_pt") if ok else None
        keys.append((
            town_names(e.get("town")) if ok else frozenset(),
            day_range(e) if ok else None,
            tokens(title) if isinstance(title, str) else frozenset(),
        ))
    gap = datetime.timedelta(days=MAX_DAYS_APART)
    pairs = []
    for i in range(len(keys)):
        town_i, days_i, words_i = keys[i]
        if not town_i or days_i is None or not words_i:
            continue
        for j in range(i + 1, len(keys)):
            town_j, days_j, words_j = keys[j]
            if not (town_i & town_j) or days_j is None or not words_j:
                continue
            if days_j[0] > days_i[1] + gap or days_i[0] > days_j[1] + gap:
                continue
            if len(words_i & words_j) / min(len(words_i), len(words_j)) >= MIN_OVERLAP:
                pairs.append((i, j))
    return pairs


def describe(e: dict) -> str:
    return "%s | %s | %s" % (e.get("title_pt"), e.get("start_date"), e.get("town"))


def read_group(candidates: Path, group: str, stamp, problems: list):
    """A group's candidates file if it is usable, else None with the reasons in problems."""
    data = load(candidates / (group + ".json"), problems, "group " + group)
    if data is None:
        return None
    if data.get("collected_at") != stamp:
        problems.append("group %s: stale, its collected_at is %s but the index says %s"
                        % (group, data.get("collected_at"), stamp))
    elif data.get("group") != group:
        problems.append("group %s: the file says group %s" % (group, data.get("group")))
    elif not isinstance(data.get("events"), list):
        problems.append("group %s: events must be a list" % group)
    else:
        return data
    return None


def merge(collected: Path, candidates: Path, now=None, missing_ok=False):
    """Return (document, report lines) or (None, problems)."""
    problems = []
    index = load(collected / "index.json", problems, "index")
    if index is None:
        return None, problems
    groups = index.get("groups")
    sources = index.get("sources")
    window = index.get("window")
    stamp = index.get("collected_at")
    if not (isinstance(groups, dict) and isinstance(sources, list) and isinstance(window, dict) and stamp):
        return None, ["index: needs collected_at, window, groups and sources"]

    events, origins, hints, coverage = [], [], [], []
    missing = []
    for group in groups:
        group_problems = []
        data = read_group(candidates, group, stamp, group_problems)
        if data is None:
            if missing_ok:
                missing.append(group)
            else:
                problems.extend(group_problems)
            continue
        events.extend(data["events"])
        origins.extend([group] * len(data["events"]))
        hint_list = data.get("hints") or []
        if not (isinstance(hint_list, list) and all(isinstance(h, dict) for h in hint_list)):
            problems.append("group %s: hints must be a list of events" % group)
            continue
        for h in hint_list:
            hints.append((group, h))
        if data.get("coverage"):
            coverage.append((group, str(data["coverage"])))

    manual_path = candidates / "manual.json"
    overrides = {}
    if manual_path.exists():
        manual = load(manual_path, problems, "manual")
        if manual is not None:
            if manual.get("collected_at") != stamp:
                problems.append("manual: stale, its collected_at is %s but the index says %s; "
                                "delete %s and read the failed sources again if you still need it"
                                % (manual.get("collected_at"), stamp, manual_path))
            else:
                manual_events = manual.get("events") or []
                events.extend(manual_events)
                origins.extend(["manual"] * len(manual_events))
                for o in manual.get("sources") or []:
                    name = o.get("name") if isinstance(o, dict) else None
                    if not any(s.get("name") == name for s in sources):
                        problems.append("manual: source %r is not in the index" % (name,))
                    else:
                        overrides[name] = o
    if problems:
        return None, problems

    unread = set()
    for group in missing:
        listed = groups[group].get("sources") if isinstance(groups[group], dict) else None
        unread.update(listed if isinstance(listed, list) else
                      [s.get("name") for s in sources if s.get("group") == group])
    checked = []
    for s in sources:
        o = overrides.get(s.get("name"), s)
        entry = {"name": s["name"], "url": s.get("url") or "", "ok": bool(o.get("ok"))}
        if s.get("name") in unread and s.get("name") not in overrides:
            entry["ok"] = False
            o = o if not o.get("ok") and o.get("error") else {"error": NOT_READ}
        if not entry["ok"] and o.get("error"):
            entry["error"] = o["error"]
        checked.append(entry)

    now = now or datetime.datetime.now().astimezone()
    doc = {
        "generated_at": now.replace(microsecond=0).isoformat(),
        "window": window,
        "origin": ORIGIN,
        "sources_checked": checked,
        "events": events,
    }
    lines = ["missing group: " + group for group in missing]
    lines.append("hints:")
    for group, h in hints:
        lines.append("  [%s] %s | %s" % (group, describe(h), h.get("caveat") or ""))
    lines.append("coverage:")
    for group, text in coverage:
        lines.append("  %s: %s" % (group, text))
    lines.append("problems:")
    for text in render.check(doc):
        found = re.match(r"events\[(\d+)\]", text)
        if found and int(found.group(1)) < len(origins):
            text += " [group %s]" % origins[int(found.group(1))]
        lines.append("  " + text)
    lines.append("possible duplicates:")
    for i, j in possible_duplicates(events):
        lines.append("  events[%d] %s  <->  events[%d] %s" % (i, describe(events[i]), j, describe(events[j])))
    return doc, lines


MUNICIPAL_WORDS = ("municipio", "municipal", "camara")


def municipal_or_venue(source, event) -> bool:
    """Whether a source of an event is the municipality's or the venue's own."""
    name = normalise(source.get("name") or "")
    if name.startswith("cm-") or name.startswith("mcr") or any(w in name for w in MUNICIPAL_WORDS):
        return True
    venue = normalise(event.get("venue") or "")
    return bool(venue and name and (venue in name or name in venue))


def preference(e: dict) -> tuple:
    """Higher is better: a start_time, then a single day, then a municipal or venue source."""
    return (
        e["start_time"] is not None,
        e["end_date"] is None,
        any(municipal_or_venue(s, e) for s in e["sources"]),
    )


def finalize_document(doc):
    """Return (events file fixed so render.check passes, stats) or (None, problems)."""
    if not isinstance(doc, dict) or not isinstance(doc.get("events"), list):
        return None, ["the file must be a JSON object with an events list"]
    window = None
    w = doc.get("window")
    if isinstance(w, dict):
        ws, we = render.real_date(w.get("start")), render.real_date(w.get("end"))
        if ws and we and ws <= we:
            window = (ws, we)

    dropped, valid = [], []
    for e in doc["events"]:
        if isinstance(e, dict) and not render.check_event(e, window):
            valid.append(e)
        else:
            title = e.get("title_pt") if isinstance(e, dict) else None
            start = e.get("start_date") if isinstance(e, dict) else None
            dropped.append("%s (%s)" % (title if render.text_ok(title) else "untitled", start))

    kept, place = [], {}
    for e in valid:
        eid = render.event_id(e)
        if eid not in place:
            place[eid] = len(kept)
            kept.append(e)
            continue
        first = kept[place[eid]]
        best, other = (e, first) if preference(e) > preference(first) else (first, e)
        merged = list(best["sources"])
        for s in other["sources"]:
            if not any(s.get("name") == m.get("name") and s.get("url") == m.get("url") for m in merged):
                merged.append(s)
        best = dict(best, sources=merged)
        kept[place[eid]] = best
    collapsed = len(valid) - len(kept)

    out = dict(doc, events=kept)
    note = out.get("note")
    note = note.strip() if isinstance(note, str) else ""
    if not note:
        unread = [s["name"] for s in out.get("sources_checked") or []
                  if isinstance(s, dict) and s.get("ok") is False and s.get("error") == NOT_READ
                  and isinstance(s.get("name"), str)]
        parts = []
        if unread:
            parts.append("Not read: %s." % ", ".join(unread))
        parts.append("This agenda was put together automatically, without a final edit: "
                     "some listings may be missing or repeated, so check the source for anything that matters.")
        note = " ".join(parts)
    if dropped:
        note += " Left out because they could not be shown: %s." % "; ".join(dropped)
    out["note"] = note
    problems = render.check(out)
    if problems:
        return None, problems
    return out, {"events": len(kept), "dropped": len(dropped), "collapsed": collapsed}


def finalize(path: Path) -> int:
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        print("cannot read %s: %s" % (path, err))
        return 2
    out, result = finalize_document(doc)
    if out is None:
        print("cannot finalize %s:" % path)
        for line in result[:render.MAX_PROBLEMS]:
            print("  " + line)
        return 2
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        os.replace(tmp, path)
    except OSError as err:
        print("cannot write %s: %s" % (path, err))
        return 2
    print("finalized %s: %d events, %d dropped, %d duplicates collapsed"
          % (path, result["events"], result["dropped"], result["collapsed"]))
    return 0


def main(argv=None, now=None) -> int:
    ap = argparse.ArgumentParser(description="Join candidate files into an events file.")
    ap.add_argument("collected", nargs="?", help="folder written by collect.py, with index.json")
    ap.add_argument("candidates", nargs="?", help="folder of <group>.json files, and manual.json if any")
    ap.add_argument("out", nargs="?", help="events file to write")
    ap.add_argument("--missing-ok", action="store_true",
                    help="skip a group whose candidates file is missing, unreadable or stale")
    ap.add_argument("--finalize", metavar="EVENTS_JSON",
                    help="instead of merging, make this events file pass render.py's check, in place")
    args = ap.parse_args(argv)
    if args.finalize:
        if args.collected or args.missing_ok:
            ap.error("--finalize takes no folders and no --missing-ok")
        return finalize(Path(args.finalize))
    if not (args.collected and args.candidates and args.out):
        ap.error("collected, candidates and out are required")
    doc, lines = merge(Path(args.collected), Path(args.candidates), now, args.missing_ok)
    if doc is None:
        for line in lines:
            print(line)
        return 2
    try:
        Path(args.out).write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    except OSError as err:
        print("cannot write %s: %s" % (args.out, err))
        return 2
    print("wrote %s: %d events" % (args.out, len(doc["events"])))
    for line in lines:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
