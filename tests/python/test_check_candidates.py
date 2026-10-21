"""Tests for scripts/check_candidates.py, offline."""

import json
import os
import tempfile
import unittest

from helpers import SCRIPTS  # noqa: F401  (puts scripts on the path)
import check_candidates

STAMP = "2026-10-20T08:00:00+01:00"
WINDOW = (__import__("datetime").date(2026, 10, 20), __import__("datetime").date(2026, 12, 1))


def event(**extra):
    e = {
        "title_pt": "Concerto", "title_en": "Concert", "category": "music", "kind": "single",
        "start_date": "2026-10-25", "end_date": None, "start_time": None, "dates": None,
        "recurrence": None, "date_tbc": False, "venue": None, "town": "Rio Maior",
        "drive_min": 0, "price": None, "kids": False, "description_en": None,
        "sources": [{"name": "A", "url": "https://example.org/a"}], "confidence": "high", "caveat": None,
    }
    e.update(extra)
    return e


def good():
    return {"collected_at": STAMP, "group": "g", "events": [event()], "hints": [], "coverage": "ok"}


class Check(unittest.TestCase):
    def problems(self, data):
        return check_candidates.problems_in(data, "g", STAMP, WINDOW)

    def test_good(self):
        self.assertEqual(self.problems(good()), [])

    def test_wrong_group_stamp_and_missing_key(self):
        d = good()
        d["group"] = "x"
        d["collected_at"] = "other"
        self.assertEqual(len(self.problems(d)), 2)
        del d["hints"]
        self.assertEqual(self.problems(d), ["missing hints"])

    def test_bad_event_and_hint(self):
        d = good()
        d["events"][0]["category"] = "bogus"
        d["hints"] = [event(start_date="2027-05-01")]
        found = self.problems(d)
        self.assertTrue(any(p.startswith("events[0]") and "category" in p for p in found))
        self.assertTrue(any(p.startswith("hints[0]") for p in found))

    def test_cli_exit_codes(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = os.path.join(tmp, "index.json")
            with open(index, "w") as f:
                json.dump({"collected_at": STAMP, "window": {"start": "2026-10-20", "end": "2026-12-01"}}, f)
            path = os.path.join(tmp, "g.json")
            with open(path, "w") as f:
                json.dump(good(), f)
            self.assertEqual(check_candidates.main([path, "--index", index, "--group", "g"]), 0)
            with open(path, "w") as f:
                f.write("garbage")
            self.assertEqual(check_candidates.main([path, "--index", index, "--group", "g"]), 2)


if __name__ == "__main__":
    unittest.main()
