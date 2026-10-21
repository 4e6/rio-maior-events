#!/usr/bin/env python3
"""Join the readers' candidate files into one events file.

    python3 scripts/merge.py rio-maior-collected rio-maior-candidates rio-maior-events.json     0 wrote it, 2 could not

The collect script writes rio-maior-collected/index.json and one file per
reading group. Each reader writes rio-maior-candidates/<group>.json:
{collected_at, group, events, hints, coverage}. An optional
rio-maior-candidates/manual.json, {collected_at, events, sources}, holds events
the model read itself and `sources` overrides {name, ok, error?} for sources it
read by hand after the script failed on them.

This script reads index.json and requires a candidates file for every group the
index lists, each with the same collected_at as the index. It names every group
whose file is missing, unreadable or stale, writes nothing, and exits 2.

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

Python 3.9, standard library only, no network. The output depends on the input
files alone except generated_at, which main() takes from the clock unless a
test passes `now`.
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
import unicodedata
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import render  # noqa: E402

ORIGIN = "Rio Maior"
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


def merge(collected: Path, candidates: Path, now=None):
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
    for group in groups:
        data = load(candidates / (group + ".json"), problems, "group " + group)
        if data is None:
            continue
        if data.get("collected_at") != stamp:
            problems.append("group %s: stale, its collected_at is %s but the index says %s"
                            % (group, data.get("collected_at"), stamp))
            continue
        if data.get("group") != group:
            problems.append("group %s: the file says group %s" % (group, data.get("group")))
            continue
        if not isinstance(data.get("events"), list):
            problems.append("group %s: events must be a list" % group)
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

    checked = []
    for s in sources:
        o = overrides.get(s.get("name"), s)
        entry = {"name": s["name"], "url": s.get("url") or "", "ok": bool(o.get("ok"))}
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
    lines = ["hints:"]
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


def main(argv=None, now=None) -> int:
    ap = argparse.ArgumentParser(description="Join candidate files into an events file.")
    ap.add_argument("collected", help="folder written by collect.py, with index.json")
    ap.add_argument("candidates", help="folder of <group>.json files, and manual.json if any")
    ap.add_argument("out", help="events file to write")
    args = ap.parse_args(argv)
    doc, lines = merge(Path(args.collected), Path(args.candidates), now)
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
