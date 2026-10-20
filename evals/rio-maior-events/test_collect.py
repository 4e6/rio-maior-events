"""Offline tests for the rio-maior-events collector, on small hand-made fixtures.

    python3 -m unittest discover -s evals/rio-maior-events

Only the parsing functions are tested; nothing here reaches the network. The
tests live here, outside the skill, because anything inside a skill's folder
ships with it.
"""

import importlib.util
import json
import datetime
import os
import socket
import tempfile
import urllib.error
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "..", "skills", "rio-maior-events", "scripts", "collect.py")

_spec = importlib.util.spec_from_file_location("collect", SCRIPT)
collect = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(collect)

WINDOW = ("2026-10-20", "2026-12-01")


def fixture(name):
    with open(os.path.join(HERE, "fixtures", name), "rb") as handle:
        return handle.read()


class CmJson(unittest.TestCase):
    def test_keeps_only_the_window_and_unescapes(self):
        items = collect.parse_cm_json(fixture("cm.json"), WINDOW)
        self.assertEqual([i["title"] for i in items], ["Earlier", 'Concerto "Natal" & Coro'])
        self.assertEqual(items[1]["date"], "2026-10-24")
        self.assertEqual(items[1]["start"], "2026-10-24T21:00:00+00:00")
        self.assertEqual(items[1]["description"], "Entrada livre '")

    def test_local_time_follows_portuguese_summer_time(self):
        items = collect.parse_cm_json(fixture("cm.json"), WINDOW)
        self.assertEqual(items[1]["local_start"], "2026-10-24T22:00+01:00")

    def test_lisbon_time_switches_on_the_last_sundays(self):
        utc = datetime.timezone.utc
        cases = [
            ((2026, 10, 24, 20, 30), "2026-10-24T21:30+01:00"),
            ((2026, 10, 25, 0, 59), "2026-10-25T01:59+01:00"),
            ((2026, 10, 25, 1, 0), "2026-10-25T01:00+00:00"),
            ((2026, 10, 29, 21, 30), "2026-10-29T21:30+00:00"),
            ((2026, 3, 29, 0, 59), "2026-03-29T00:59+00:00"),
            ((2026, 3, 29, 1, 0), "2026-03-29T02:00+01:00"),
            ((2026, 12, 31, 23, 30), "2026-12-31T23:30+00:00"),
        ]
        for parts, expected in cases:
            moment = datetime.datetime(*parts, tzinfo=utc)
            self.assertEqual(collect.lisbon_time(moment).isoformat(timespec="minutes"), expected)

    def test_date_is_the_local_day(self):
        raw = b'[{"title":"Late","start":"2026-07-10T23:30:00+00:00","url":"","description":""}]'
        items = collect.parse_cm_json(raw, ("2026-07-11", "2026-07-11"))
        self.assertEqual(items[0]["date"], "2026-07-11")

    def test_urls_become_absolute(self):
        items = collect.parse_cm_json(fixture("cm.json"), WINDOW)
        self.assertEqual(items[1]["url"], "https://www.cm-riomaior.pt/informacao/agenda-rio-maior/concerto")

    def test_window_is_inclusive(self):
        items = collect.parse_cm_json(fixture("cm.json"), ("2026-10-24", "2026-10-24"))
        self.assertEqual(len(items), 1)

    def test_not_an_array_is_an_error(self):
        with self.assertRaises(ValueError):
            collect.parse_cm_json(b'{"a": 1}', WINDOW)


class JsonLd(unittest.TestCase):
    def setUp(self):
        self.page = fixture("page.html").decode("utf-8")

    def test_flattens_item_lists_and_graphs(self):
        names = [e["name"] for e in collect.extract_jsonld_events(self.page)]
        self.assertEqual(names, ["Trail & Serra", "Past gig", "Long fair"])

    def test_event_fields(self):
        event = collect.extract_jsonld_events(self.page)[0]
        self.assertEqual(event["location"], "Pavilhão")
        self.assertEqual(event["addressLocality"], "Rio Maior")
        self.assertEqual(event["price"], "12")
        self.assertEqual(event["url"], "https://example.org/trail")

    def test_window_keeps_events_still_running(self):
        names = [e["name"] for e in collect.extract_jsonld_events(self.page, WINDOW)]
        self.assertEqual(names, ["Trail & Serra", "Long fair"])

    def test_description_is_cut(self):
        page = ('<script type="application/ld+json">{"@type":"Event","name":"x",'
                '"description":"%s"}</script>' % ("a" * 500))
        self.assertEqual(len(collect.extract_jsonld_events(page)[0]["description"]), 300)


class VisibleText(unittest.TestCase):
    def test_drops_chrome_and_collapses_whitespace(self):
        text, truncated = collect.visible_text(fixture("page.html").decode("utf-8"))
        self.assertFalse(truncated)
        self.assertNotIn("Site header", text)
        self.assertNotIn("Menu", text)
        self.assertNotIn("Footer text", text)
        self.assertNotIn("hidden", text)
        self.assertNotIn("color:red", text)
        self.assertIn("Sáb 24 out & mais\nConcerto às 21:30", text)
        self.assertIn("Item um\nItem dois", text)

    def test_a_card_keeps_its_header_inside_an_article(self):
        text, _ = collect.visible_text(fixture("page.html").decode("utf-8"))
        self.assertIn("Cartao Titulo\n24 out", text)
        self.assertIn("Cartao rodape", text)
        self.assertNotIn("Site header", text)
        self.assertNotIn("Footer text", text)

    def test_a_page_header_after_an_article_is_still_dropped(self):
        text, _ = collect.visible_text(
            "<article><p>Card</p></article><header>Top</header><main><p>Body</p></main>")
        self.assertEqual(text, "Card\nBody")

    def test_cap_sets_truncated(self):
        text, truncated = collect.visible_text("<p>%s</p>" % ("a" * 100), cap=40)
        self.assertEqual((len(text), truncated), (40, True))


class CollectSource(unittest.TestCase):
    source = {"name": "s", "url": "https://example.org/", "town": "T", "kind": "html_text"}

    def run_with(self, page):
        with mock.patch.object(collect, "fetch", return_value=(200, page.encode("utf-8"), None)):
            return collect.collect_source(self.source, WINDOW)

    def test_empty_page_is_a_failure(self):
        result = self.run_with("<html><body><p>Ola</p></body></html>")
        self.assertFalse(result["ok"])
        self.assertIn("layout may have changed", result["error"])

    def test_page_with_text_is_ok(self):
        result = self.run_with("<p>%s</p>" % ("evento " * 60))
        self.assertTrue(result["ok"])

    def test_cm_with_no_items_is_ok_with_a_note(self):
        source = dict(self.source, kind="cm_json")
        with mock.patch.object(collect, "fetch", return_value=(200, b"[]", None)):
            result = collect.collect_source(source, WINDOW)
        self.assertTrue(result["ok"])
        self.assertTrue(result["note"].startswith("0 items in window"))

    def test_network_error_is_recorded(self):
        with mock.patch.object(collect, "fetch", side_effect=OSError("down")):
            result = collect.collect_source(self.source, WINDOW)
        self.assertFalse(result["ok"])
        self.assertIn("down", result["error"])


class Main(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(collect, "PAUSE", 0)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_unknown_source_is_a_usage_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(collect.main([os.path.join(tmp, "o.json"), "--only", "nope"]), 2)

    def test_every_source_failing_is_exit_2(self):
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(collect, "fetch", side_effect=OSError("down")):
            out = os.path.join(tmp, "o.json")
            self.assertEqual(collect.main([out, "--only", "cineteatro"]), 2)
            self.assertFalse(os.path.exists(out))

    def test_one_failure_does_not_stop_the_rest(self):
        def fake(url, data=None):
            if "cineteatro" in url:
                raise OSError("down")
            return 200, ("<p>%s</p>" % ("evento " * 60)).encode(), None
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(collect, "fetch", fake):
            out = os.path.join(tmp, "o.json")
            code = collect.main([out, "--only", "cineteatro", "mcr-caldas", "--from", "2026-10-20"])
            with open(out, encoding="utf-8") as handle:
                data = json.load(handle)
        self.assertEqual(code, 0)
        self.assertEqual([s["ok"] for s in data["sources"]], [False, True])
        self.assertEqual(data["window"], {"start": "2026-10-20", "end": "2026-12-01"})

    def run_viral(self, error):
        """Three Viral Agenda pages and one other site; the first page fails with error."""
        calls = []

        def fake(url, data=None):
            calls.append(url)
            if "viralagenda" in url and len([c for c in calls if "viralagenda" in c]) == 1:
                raise error
            return 200, ("<p>%s</p>" % ("evento " * 60)).encode(), None
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(collect, "fetch", fake):
            out = os.path.join(tmp, "o.json")
            code = collect.main([out, "--only", "viralagenda-rio-maior", "cineteatro",
                                 "viralagenda-santarem", "viralagenda-obidos", "--from", "2026-10-20"])
            with open(out, encoding="utf-8") as handle:
                data = json.load(handle)
        return code, calls, {s["name"]: s for s in data["sources"]}

    def test_a_host_that_refuses_or_does_not_answer_is_skipped(self):
        http = lambda code: urllib.error.HTTPError("u", code, "x", None, None)
        for error in (http(403), http(429), http(503), socket.timeout("timed out"),
                      urllib.error.URLError("refused"), ConnectionResetError("reset")):
            code, calls, sources = self.run_viral(error)
            self.assertEqual(code, 0)
            self.assertEqual(len([c for c in calls if "viralagenda" in c]), 1, error)
            for name in ("viralagenda-santarem", "viralagenda-obidos"):
                self.assertFalse(sources[name]["ok"])
                self.assertEqual(sources[name]["error"],
                                 "skipped: www.viralagenda.com refused or did not answer")
            self.assertTrue(sources["cineteatro"]["ok"])

    def test_other_failures_do_not_skip_the_host(self):
        for error in (urllib.error.HTTPError("u", 404, "x", None, None), OSError("down")):
            code, calls, sources = self.run_viral(error)
            self.assertEqual(len([c for c in calls if "viralagenda" in c]), 3, error)
            self.assertTrue(sources["viralagenda-obidos"]["ok"])

    def test_the_same_host_is_paused_between_requests(self):
        def fake(url, data=None):
            return 200, ("<p>%s</p>" % ("evento " * 60)).encode(), None
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(collect, "fetch", fake), \
                mock.patch.object(collect, "PAUSE", 1.5), mock.patch.object(collect.time, "sleep") as sleep:
            collect.main([os.path.join(tmp, "o.json"), "--only", "viralagenda-rio-maior",
                          "cineteatro", "viralagenda-santarem", "viralagenda-obidos"])
        self.assertEqual(sleep.call_args_list, [mock.call(1.5), mock.call(1.5)])

    def test_bad_date_is_a_usage_error(self):
        self.assertEqual(collect.main(["o.json", "--from", "soon"]), 2)


class InlineText(unittest.TestCase):
    def text(self, page):
        return collect.visible_text("<p>%s</p>" % page)[0]

    def test_fields_in_spans_are_kept_apart(self):
        self.assertEqual(self.text("<span>Trail 2026</span><span>dom</span><span>15</span><span>nov</span>"),
                         "Trail 2026 dom 15 nov")

    def test_fields_in_adjacent_ems_are_kept_apart(self):
        self.assertEqual(self.text("<em>sab</em><em>24</em><em>out</em><em>Dia</em>"), "sab 24 out Dia")

    def test_markup_inside_a_word_or_number_joins(self):
        self.assertEqual(self.text("S\u00e1<b>b</b> 6<sup>\u00aa</sup>"), "S\u00e1b 6\u00aa")
        self.assertEqual(self.text("<span>21</span>:<span>30</span> \u20ac<span>8</span>"), "21:30 \u20ac8")
        self.assertEqual(self.text("<a href=x>Concerto</a>, hoje"), "Concerto, hoje")


class SourceList(unittest.TestCase):
    def test_names_are_unique_and_documented(self):
        names = [s["name"] for s in collect.SOURCES]
        self.assertEqual(len(names), len(set(names)))
        path = os.path.join(HERE, "..", "..", "skills", "rio-maior-events", "references", "sources.md")
        with open(path, encoding="utf-8") as handle:
            doc = handle.read()
        for source in collect.SOURCES:
            if not source["name"].startswith("viralagenda-"):
                self.assertIn(source["name"], doc)
            url = source["url"].split("?")[0]
            self.assertIn(url, doc)


if __name__ == "__main__":
    unittest.main()
