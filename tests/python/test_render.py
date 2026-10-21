"""Tests for the rio-maior-events renderer, offline, on the skill's own sample.

    python3 -m unittest discover -s evals/rio-maior-events -p 'test_render.py'

The renderer checks the events file the model writes, gives each event a stable
id and writes one self-contained page. These tests run it on the sample, then
break the sample one rule at a time and check what it says, and try to get a
hostile title and a hostile link past it.

The tests live here, outside the skill, because anything inside a skill's folder
ships with it.
"""

import contextlib
import copy
import importlib.util
import io
import json
import os
import re
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.join(HERE, "..", "..")
SAMPLE_JSON = os.path.join(SKILL, "examples", "sample-events.json")
SAMPLE_HTML = os.path.join(SKILL, "examples", "sample-events.html")

_spec = importlib.util.spec_from_file_location("render", os.path.join(SKILL, "scripts", "render.py"))
render = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(render)


def sample():
    with open(SAMPLE_JSON, encoding="utf-8") as f:
        return json.load(f)


def html_of(data):
    with open(os.path.join(SKILL, "assets", "page.css"), encoding="utf-8") as f:
        css = f.read()
    with open(os.path.join(SKILL, "assets", "page.js"), encoding="utf-8") as f:
        js = f.read()
    return render.build(data, css, js)


def run(args):
    """main(), with what it prints captured: (exit code, stdout, stderr)."""
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = render.main(args)
    return code, out.getvalue(), err.getvalue()


def first(data, kind):
    return next(e for e in data["events"] if e["kind"] == kind)


class SampleTests(unittest.TestCase):
    def test_sample_validates(self):
        self.assertEqual(render.check(sample()), [])

    def test_sample_covers_every_kind_and_state(self):
        data = sample()
        self.assertEqual({e["kind"] for e in data["events"]}, set(render.KINDS))
        self.assertTrue(any(e["date_tbc"] for e in data["events"]))
        self.assertTrue(any(e["confidence"] == "low" for e in data["events"]))
        self.assertTrue(any(not s["ok"] for s in data["sources_checked"]))

    def test_sample_html_matches_committed_file_byte_for_byte(self):
        with open(SAMPLE_HTML, "rb") as f:
            committed = f.read()
        self.assertEqual(html_of(sample()).encode("utf-8"), committed)

    def test_cli_writes_the_page_and_says_so(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "page.html")
            code, said, _ = run([SAMPLE_JSON, out])
            self.assertEqual(code, 0)
            self.assertRegex(said, r"^wrote .*: 17 events, from 2026-10-20 to 2026-11-30\n$")
            with open(out, "rb") as f, open(SAMPLE_HTML, "rb") as g:
                self.assertEqual(f.read(), g.read())

    def test_cli_exits_2_and_writes_nothing_on_problems(self):
        data = sample()
        data["events"][0]["kind"] = "weekly"
        with tempfile.TemporaryDirectory() as d:
            src, out = os.path.join(d, "e.json"), os.path.join(d, "page.html")
            with open(src, "w", encoding="utf-8") as f:
                json.dump(data, f)
            self.assertEqual(run([src, out])[0], 2)
            self.assertFalse(os.path.exists(out))

    def test_cli_exits_2_on_a_file_that_is_not_json(self):
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "e.json")
            with open(src, "w") as f:
                f.write("{nope")
            self.assertEqual(run([src, os.path.join(d, "o.html")])[0], 2)


class IdTests(unittest.TestCase):
    def test_accents_case_and_spacing_give_the_same_id(self):
        a = dict(title_pt="Feira do Sal e dos Sabores", start_date="2026-10-23", town="Rio Maior")
        b = dict(title_pt="  FEIRA  do sal e dos  sabóres ", start_date="2026-10-23", town="rio  maior")
        c = dict(title_pt="Feira do Sal", start_date="2026-10-23", town="Rio Maior")
        self.assertEqual(render.event_id(a), render.event_id(b))
        self.assertNotEqual(render.event_id(a), render.event_id(c))
        self.assertRegex(render.event_id(a), r"^[0-9a-f]{10}$")

    def test_a_different_date_or_town_is_a_different_id(self):
        a = dict(title_pt="Mercado", start_date="2026-10-23", town="Rio Maior")
        self.assertNotEqual(render.event_id(a), render.event_id(dict(a, start_date="2026-10-24")))
        self.assertNotEqual(render.event_id(a), render.event_id(dict(a, town="Santarem")))

    def test_ids_are_in_the_page_data(self):
        data = sample()
        out = render.page_data(data)
        self.assertEqual(out["events"][0]["id"], render.event_id(data["events"][0]))

    def test_the_same_event_twice_is_a_problem(self):
        data = sample()
        data["events"].append(copy.deepcopy(data["events"][0]))
        self.assertTrue(any("same event as events[0]" in p for p in render.check(data)))


class ValidationTests(unittest.TestCase):
    def problems_after(self, change):
        data = sample()
        change(data)
        return render.check(data)

    def test_low_confidence_needs_a_caveat(self):
        def change(d):
            e = next(e for e in d["events"] if e["confidence"] == "low")
            e["caveat"] = ""
        found = self.problems_after(change)
        self.assertEqual(len(found), 1)
        self.assertIn("caveat", found[0])
        self.assertIn("events[", found[0])

    def test_a_bad_date_is_named_with_its_event(self):
        def change(d):
            d["events"][2]["start_date"] = "2026-02-30"
        found = self.problems_after(change)
        self.assertEqual(len(found), 1)
        self.assertIn("events[2]", found[0])
        self.assertIn("start_date", found[0])

    def test_empty_sources(self):
        def change(d):
            d["events"][1]["sources"] = []
        self.assertTrue(any("sources" in p for p in self.problems_after(change)))

    def test_bad_kind(self):
        def change(d):
            d["events"][0]["kind"] = "weekly"
        self.assertTrue(any("kind" in p for p in self.problems_after(change)))

    def test_bad_time_and_category(self):
        def change(d):
            d["events"][0]["start_time"] = "25:00"
            d["events"][1]["category"] = "party"
        found = self.problems_after(change)
        self.assertTrue(any("start_time" in p for p in found))
        self.assertTrue(any("category" in p for p in found))

    def test_an_ongoing_event_without_an_end_is_not_called_outside_the_window(self):
        def change(d):
            e = first(d, "ongoing")
            e["start_date"], e["end_date"] = "2026-10-01", None
        found = self.problems_after(change)
        self.assertEqual(len(found), 1)
        self.assertIn("needs an end_date", found[0])
        self.assertNotIn("outside", found[0])

    def test_multi_day_needs_a_later_end(self):
        def change(d):
            e = first(d, "multi_day")
            e["end_date"] = e["start_date"]
        self.assertTrue(any("multi_day" in p for p in self.problems_after(change)))

    def test_a_recurring_event_cannot_have_date_tbc(self):
        def change(d):
            e = first(d, "recurring")
            e.update(date_tbc=True, dates=None, start_time=None, end_date=None)
        found = self.problems_after(change)
        self.assertTrue(any("recurring" in p and "date_tbc" in p for p in found))

    def test_multi_day_spans_at_most_seven_days(self):
        def change(d):
            e = first(d, "multi_day")
            e["start_date"], e["end_date"] = "2026-10-21", "2026-10-28"
        found = self.problems_after(change)
        self.assertTrue(any("at most 7 days" in p and "ongoing" in p for p in found))

    def test_multi_day_of_seven_days_is_fine(self):
        def change(d):
            e = first(d, "multi_day")
            e["start_date"], e["end_date"] = "2026-10-21", "2026-10-27"
        self.assertEqual(self.problems_after(change), [])

    def test_recurring_dates_must_be_inside_the_window(self):
        def change(d):
            first(d, "recurring")["dates"] = ["2026-10-24", "2026-12-05"]
        found = self.problems_after(change)
        self.assertEqual(len(found), 1)
        self.assertIn("2026-12-05", found[0])

    def test_an_event_that_ended_before_the_window_is_rejected(self):
        def change(d):
            e = first(d, "multi_day")
            e["start_date"], e["end_date"] = "2026-10-10", "2026-10-12"
        self.assertTrue(any("outside the window" in p for p in self.problems_after(change)))

    def test_a_single_event_outside_the_window_is_rejected(self):
        for day in ("2026-10-19", "2026-12-01"):
            def change(d):
                first(d, "single")["start_date"] = day
            self.assertTrue(any("outside the window" in p for p in self.problems_after(change)), day)

    def test_an_event_that_started_before_the_window_but_runs_into_it_is_kept(self):
        self.assertEqual(self.problems_after(lambda d: None), [])
        self.assertLess(first(sample(), "ongoing")["start_date"], sample()["window"]["start"])

    def test_a_month_only_date_is_judged_by_its_month(self):
        def change(d):
            e = next(e for e in d["events"] if e["date_tbc"])
            e["start_date"] = "2027-02"
        self.assertTrue(any("outside the window" in p for p in self.problems_after(change)))
        def inside(d):
            next(e for e in d["events"] if e["date_tbc"])["start_date"] = "2026-10"
        self.assertEqual(self.problems_after(inside), [])

    def test_a_missing_field_is_named(self):
        def change(d):
            del d["events"][0]["town"]
        self.assertTrue(any("missing town" in p for p in self.problems_after(change)))

    def test_problems_are_capped_at_twenty(self):
        data = sample()
        for e in data["events"]:
            e["kind"] = "weekly"
            e["category"] = "party"
        self.assertGreater(len(render.check(data)), render.MAX_PROBLEMS)
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "e.json")
            with open(src, "w", encoding="utf-8") as f:
                json.dump(data, f)
            code, _, err = run([src, os.path.join(d, "o.html")])
            self.assertEqual(code, 2)
            self.assertIn("and ", err.splitlines()[-1])
            self.assertEqual(len(err.splitlines()), 1 + render.MAX_PROBLEMS + 1)


class SafetyTests(unittest.TestCase):
    def test_javascript_links_are_dropped_and_text_kept(self):
        data = sample()
        data["events"][0]["sources"] = [{"name": "Evil source", "url": "javascript:alert(1)"}]
        data["sources_checked"][0]["url"] = "data:text/html,x"
        page = html_of(data)
        self.assertNotIn("javascript:", page)
        self.assertNotIn("data:text/html", page)
        self.assertIn("Evil source", page)
        embedded = json.loads(self.data_block(page))
        self.assertEqual(embedded["events"][0]["sources"][0]["url"], "")
        self.assertTrue(embedded["events"][0]["sources"][0]["name"])

    def data_block(self, page):
        m = re.search(r'<script type="application/json" id="events-data">\n(.*?)\n</script>', page, re.S)
        self.assertIsNotNone(m)
        return m.group(1)

    def test_a_title_cannot_break_out_of_the_data_block(self):
        evil = "</script><script>alert(1)</script>"
        data = sample()
        data["events"][0]["title_pt"] = evil
        data["events"][0]["title_en"] = "A & B <b>"
        page = html_of(data)
        block = self.data_block(page)
        self.assertNotIn("</script", block.lower())
        self.assertNotIn("<", block)
        self.assertEqual(json.loads(block)["events"][0]["title_pt"], evil)
        self.assertNotIn(evil, page)
        self.assertEqual(page.lower().count("</script"), 2)

    def test_the_noscript_list_is_escaped(self):
        data = sample()
        data["events"][0]["title_en"] = "<img src=x onerror=alert(1)>"
        page = html_of(data)
        self.assertNotIn("<img src=x", page)
        self.assertIn("&lt;img src=x onerror=alert(1)&gt;", page)

    def test_nothing_is_fetched_from_elsewhere(self):
        page = html_of(sample())
        self.assertIsNone(re.search(r"<script[^>]*\ssrc=", page, re.I))
        self.assertNotIn("<link", page.lower())
        self.assertNotIn("@import", page.lower())
        self.assertNotIn("url(http", page.lower())

    def test_the_page_has_the_title_and_a_noscript_list(self):
        page = html_of(sample())
        self.assertIn("<title>What's on around Rio Maior</title>", page)
        m = re.search(r"<noscript>(.*?)</noscript>", page, re.S)
        self.assertIsNotNone(m)
        self.assertEqual(m.group(1).count("<li>"), len(sample()["events"]))

    def test_output_does_not_depend_on_anything_but_input(self):
        self.assertEqual(html_of(sample()), html_of(sample()))


class PageScriptTests(unittest.TestCase):
    """Rules from the plan that the script has to keep."""

    def setUp(self):
        with open(os.path.join(SKILL, "assets", "page.js"), encoding="utf-8") as f:
            self.js = f.read()

    def test_dates_are_never_parsed_from_a_bare_string(self):
        self.assertIsNone(re.search(r"new Date\(\s*[a-z]\w*\s*\)", self.js.replace("new Date()", "")))
        self.assertNotIn("Date.parse", self.js)
        self.assertNotIn("UTC(", self.js)

    def test_calendar_files_use_floating_times_and_data_links(self):
        self.assertNotIn("TZID", self.js)
        self.assertNotIn("VTIMEZONE", self.js)
        self.assertIn("DTSTART;VALUE=DATE:", self.js)
        self.assertIn("DTEND;VALUE=DATE:", self.js)
        self.assertIn("data:text/calendar", self.js)
        self.assertNotIn("createObjectURL", self.js)

    def test_the_empty_state_does_not_click_a_button_that_may_be_missing(self):
        self.assertNotIn("clear-filters').click()", self.js)
        self.assertNotIn('clear-filters\\\').click()', self.js)

    def test_no_demo_leftovers(self):
        self.assertNotIn("__demo", self.js)


if __name__ == "__main__":
    unittest.main()
