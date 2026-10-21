#!/usr/bin/env python3
"""Check one reader's candidates file before the merge sees it.

    python3 scripts/check_candidates.py FILE --index rio-maior-collected/index.json --group NAME     0 fine, 2 not

FILE must be {collected_at, group, events, hints, coverage}: collected_at and
group as the index and the group name say, events and hints lists of events,
coverage a non-empty string. Every event and hint must pass render.check_event
against the index's window. Each problem is printed on its own line, at most 20.

Python 3.9, standard library only, no network.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import render  # noqa: E402


def problems_in(data, group, stamp, window) -> list:
    if not isinstance(data, dict):
        return ["the file must hold one JSON object"]
    bad = []
    for key in ("collected_at", "group", "events", "hints", "coverage"):
        if key not in data:
            bad.append("missing " + key)
    if bad:
        return bad
    if data["collected_at"] != stamp:
        bad.append("collected_at is %r but the group file says %r" % (data["collected_at"], stamp))
    if data["group"] != group:
        bad.append("group is %r but this file is for %r" % (data["group"], group))
    if not render.text_ok(data["coverage"]):
        bad.append("coverage must be a non-empty string")
    for key in ("events", "hints"):
        items = data[key]
        if not (isinstance(items, list) and all(isinstance(e, dict) for e in items)):
            bad.append("%s must be a list of events" % key)
            continue
        for i, e in enumerate(items):
            label = "%s[%d] %s" % (key, i, json.dumps(e.get("title_pt", ""), ensure_ascii=False))
            bad.extend(label + ": " + m for m in render.check_event(e, window))
    return bad


def main(argv=None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="Check one reader's candidates file.")
    ap.add_argument("path")
    ap.add_argument("--index", required=True, help="index.json written by collect.py")
    ap.add_argument("--group", required=True)
    args = ap.parse_args(argv)
    try:
        index = json.loads(Path(args.index).read_text(encoding="utf-8"))
        w = index["window"]
        window = (render.real_date(w["start"]), render.real_date(w["end"]))
        stamp = index["collected_at"]
        if None in window:
            raise ValueError("window")
    except (OSError, ValueError, KeyError, TypeError) as err:
        print("cannot use the index %s: %s" % (args.index, err))
        return 2
    try:
        data = json.loads(Path(args.path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        print("cannot read %s: %s" % (args.path, err))
        return 2
    bad = problems_in(data, args.group, stamp, window)
    for line in bad[:render.MAX_PROBLEMS]:
        print(line)
    if len(bad) > render.MAX_PROBLEMS:
        print("... and %d more" % (len(bad) - render.MAX_PROBLEMS))
    return 2 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
