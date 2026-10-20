"""Offline tests for the collector's runner: spacing, skipping, ordering, output.

    python3 -m unittest discover -s evals/rio-maior-events

Nothing here reaches the network: fetch, sleep and the clock are fakes. The
tests live here, outside the skill, because anything inside a skill's folder
ships with it.
"""

import contextlib
import io
import json
import os
import socket
import tempfile
import threading
import types
import unittest
from unittest import mock
import urllib.error
import urllib.parse

import helpers
from helpers import WINDOW
import collect
from adapters import ADAPTERS
from adapters.common import Request

PAGE = ("<p>%s</p>" % ("evento " * 60)).encode()


class Clock:
    """A clock that only moves when something sleeps or a fetch takes time."""

    def __init__(self, took=0.0):
        self.now = 100.0
        self.took = took
        self.sleeps = []

    def clock(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds

    def fetch(self, url, data=None, raises=None):
        self.now += self.took
        return 200, PAGE, None


def http(code):
    return urllib.error.HTTPError("u", code, "x", None, None)


class RunHost(unittest.TestCase):
    def run_host(self, jobs, fetch, delay=2.0, clock=None):
        clock = clock or Clock()
        return clock, collect.run_host("h.example", jobs, fetch, clock.sleep, clock.clock, delay)

    def jobs(self, *names):
        return [(n, [Request("https://h.example/" + n)]) for n in names]

    def test_requests_are_spaced_from_the_end_of_the_previous_response(self):
        clock = Clock(took=0.5)
        _, outcomes = self.run_host(self.jobs("a", "b", "c"), clock.fetch, delay=2.0, clock=clock)
        self.assertEqual(clock.sleeps, [2.0, 2.0])
        self.assertEqual([o["error"] for o in outcomes.values()], [None] * 3)

    def test_time_spent_between_requests_counts_towards_the_delay(self):
        clock = Clock()

        def parsing(name, outcome):
            clock.now += 0.5
        collect.run_host("h.example", self.jobs("a", "b"), clock.fetch, clock.sleep, clock.clock, 2.0, parsing)
        self.assertEqual(clock.sleeps, [1.5])

    def test_one_source_can_make_several_requests_with_a_body(self):
        clock = Clock()
        seen = []

        def fetch(url, data=None):
            seen.append((url, data))
            return 200, PAGE, None
        jobs = [("a", [Request("https://h.example/1", b"x=1"), Request("https://h.example/2")])]
        _, outcomes = self.run_host(jobs, fetch, clock=clock)
        self.assertEqual(seen, [("https://h.example/1", b"x=1"), ("https://h.example/2", None)])
        self.assertEqual(len(outcomes["a"]["pages"]), 2)
        self.assertEqual(clock.sleeps, [2.0])

    def test_a_refusal_timeout_or_connection_error_skips_the_rest_of_the_host(self):
        for error in (http(403), http(429), http(503), socket.timeout("timed out"),
                      urllib.error.URLError("refused"), ConnectionResetError("reset")):
            calls = []

            def fetch(url, data=None):
                calls.append(url)
                raise error
            _, outcomes = self.run_host(self.jobs("a", "b", "c"), fetch)
            self.assertEqual(len(calls), 1, error)
            self.assertIsNotNone(outcomes["a"]["error"])
            for name in ("b", "c"):
                self.assertEqual(outcomes[name]["error"], "skipped: h.example refused or did not answer")
                self.assertIsNone(outcomes[name]["pages"])

    def test_a_404_or_other_failure_fails_only_its_source(self):
        for error in (http(404), OSError("down")):
            calls = []

            def fetch(url, data=None):
                calls.append(url)
                if url.endswith("a"):
                    raise error
                return 200, PAGE, None
            _, outcomes = self.run_host(self.jobs("a", "b", "c"), fetch)
            self.assertEqual(len(calls), 3, error)
            self.assertIsNotNone(outcomes["a"]["error"])
            self.assertIsNone(outcomes["b"]["error"])
            self.assertIsNone(outcomes["c"]["error"])

    def test_a_failed_request_fails_its_source_and_stops_its_other_requests(self):
        calls = []

        def fetch(url, data=None):
            calls.append(url)
            if url.endswith("1"):
                raise http(404)
            return 200, PAGE, None
        jobs = [("a", [Request("https://h.example/1"), Request("https://h.example/2")]),
                ("b", [Request("https://h.example/3")])]
        _, outcomes = self.run_host(jobs, fetch)
        self.assertEqual(calls, ["https://h.example/1", "https://h.example/3"])
        self.assertEqual(outcomes["a"]["error"], "HTTP 404 x")
        self.assertEqual(outcomes["a"]["status"], 404)
        self.assertIsNone(outcomes["b"]["error"])

    def test_on_done_is_called_for_every_source_in_turn(self):
        done = []
        clock = Clock()
        collect.run_host("h.example", self.jobs("a", "b"), clock.fetch, clock.sleep, clock.clock, 1.0,
                         lambda name, outcome: done.append(name))
        self.assertEqual(done, ["a", "b"])


class Pool(unittest.TestCase):
    def sources(self, *names):
        return [{"name": n, "label": n, "adapter": "text", "town": "T", "group": "g",
                 "url": "https://%s.example/page" % n.split("-")[0]} for n in names]

    def test_results_follow_the_order_of_the_sources_whatever_finishes_first(self):
        sources = self.sources("a-1", "b-1", "a-2", "c-1", "b-2")
        for workers in (1, 3, 8):
            lines = []
            results = collect.collect_all(
                sources, WINDOW, {}, 0, lambda url, data=None: (200, PAGE, None),
                lambda s: None, lambda: 0.0, workers, lines.append)
            self.assertEqual([r["name"] for r in results], [s["name"] for s in sources])
            self.assertEqual(len(lines), 5)
            self.assertTrue(all(r["ok"] for r in results))

    def test_a_refused_host_does_not_touch_the_others(self):
        sources = self.sources("a-1", "b-1", "a-2")

        def fetch(url, data=None):
            if "a.example" in url:
                raise http(403)
            return 200, PAGE, None
        results = collect.collect_all(sources, WINDOW, {}, 0, fetch, lambda s: None, lambda: 0.0, 2, lambda l: None)
        self.assertEqual([r["ok"] for r in results], [False, True, False])
        self.assertEqual(results[2]["error"], "skipped: a.example refused or did not answer")

    def test_the_slowest_host_is_submitted_first(self):
        sources = self.sources("a-1", "b-1", "b-2", "c-1")
        started = []

        def fetch(url, data=None):
            started.append(urllib.parse.urlsplit(url).hostname)
            return 200, PAGE, None
        collect.collect_all(sources, WINDOW, {"c.example": {"delay": 15}}, 1.5, fetch,
                            lambda s: None, lambda: 0.0, 1, lambda l: None)
        self.assertEqual(started[0], "c.example")
        self.assertEqual(started[1:], ["b.example", "b.example", "a.example"])

    def test_the_host_delay_comes_from_the_table_else_the_default(self):
        sources = self.sources("a-1", "a-2", "v-1", "v-2")
        clock = Clock()
        collect.collect_all(sources, WINDOW, {"v.example": {"delay": 15}}, 1.5, clock.fetch,
                            clock.sleep, clock.clock, 1, lambda l: None)
        self.assertEqual(sorted(clock.sleeps), [1.5, 15])

    def test_an_adapter_that_cannot_read_its_pages_fails_only_its_source(self):
        sources = self.sources("a-1", "b-1")

        def fetch(url, data=None):
            return 200, (b"<p>Ola</p>" if "a.example" in url else PAGE), None
        results = collect.collect_all(sources, WINDOW, {}, 0, fetch, lambda s: None, lambda: 0.0, 2, lambda l: None)
        self.assertFalse(results[0]["ok"])
        self.assertIn("layout may have changed", results[0]["error"])
        self.assertTrue(results[1]["ok"])


class Contract(unittest.TestCase):
    def source(self, name="a-1", host="a.example"):
        return {"name": name, "label": name, "adapter": "text", "town": "T", "group": "g",
                "url": "https://%s/page" % host}

    def collect(self, sources, **kwargs):
        return collect.collect_all(
            sources, WINDOW, {}, 0, kwargs.pop("fetch", lambda url, data=None: (200, PAGE, None)),
            kwargs.pop("sleep", lambda s: None), lambda: 0.0, kwargs.pop("workers", 2), lambda l: None)

    def test_two_hosts_are_fetched_at_the_same_time(self):
        barrier = threading.Barrier(2, timeout=5)

        def fetch(url, data=None):
            barrier.wait()  # passes only when both hosts are inside fetch together
            return 200, PAGE, None
        results = self.collect([self.source("a-1", "a.example"), self.source("b-1", "b.example")], fetch=fetch)
        self.assertEqual([r["ok"] for r in results], [True, True])

    def test_one_worker_cannot_overlap_two_hosts(self):
        barrier = threading.Barrier(2, timeout=0.2)

        def fetch(url, data=None):
            barrier.wait()
            return 200, PAGE, None
        results = self.collect([self.source("a-1", "a.example"), self.source("b-1", "b.example")],
                               fetch=fetch, workers=1)
        self.assertEqual([r["ok"] for r in results], [False, False])

    def adapter(self, parsed, requests=None):
        fake = types.SimpleNamespace(parse=lambda source, pages, window: parsed)
        if requests is not None:
            fake.requests = lambda source, window: requests
        return mock.patch.dict(collect.ADAPTERS, {"text": fake})

    def test_a_malformed_adapter_result_fails_only_its_source(self):
        bad = [
            "not a dict", {"items": "x"}, {"items": ["x"]}, {"items": [], "past": {}},
            {"items": [], "text": 5}, {"items": [], "truncated": "yes"}, {"items": [], "note": []},
        ]
        for parsed in bad:
            with self.adapter(parsed):
                results = self.collect([self.source()])
            self.assertFalse(results[0]["ok"], parsed)
            self.assertEqual(results[0]["error"], "adapter returned a malformed result")
            self.assertEqual(results[0]["items"], [])

    def test_a_well_formed_result_passes(self):
        with self.adapter({"items": [{"title": "x"}], "past": [], "text": None, "truncated": False, "note": "n"}):
            results = self.collect([self.source()])
        self.assertTrue(results[0]["ok"])
        self.assertEqual(results[0]["items"], [{"title": "x"}])

    def test_a_request_to_another_host_fails_the_source_and_is_not_made(self):
        called = []
        with self.adapter({"items": []}, [Request("https://evil.example/x")]):
            results = self.collect([self.source()], fetch=lambda url, data=None: called.append(url))
        self.assertFalse(results[0]["ok"])
        self.assertIn("evil.example", results[0]["error"])
        self.assertEqual(called, [])

    def test_a_request_to_its_own_host_is_fine(self):
        with self.adapter({"items": []}, [Request("https://a.example/other")]):
            self.assertTrue(self.collect([self.source()])[0]["ok"])

    def test_a_stopped_host_makes_no_more_requests(self):
        stop = threading.Event()
        stop.set()
        calls = []
        outcomes = collect.run_host("h.example", [("a", [Request("https://h.example/a")])],
                                    lambda url, data=None: calls.append(url), lambda s: None,
                                    lambda: 0.0, 1.0, None, stop)
        self.assertEqual((calls, outcomes), ([], {}))

    def test_the_stop_is_checked_after_the_wait_too(self):
        stop = threading.Event()
        calls = []

        def fetch(url, data=None):
            calls.append(url)
            return 200, PAGE, None
        jobs = [("a", [Request("https://h.example/a"), Request("https://h.example/b")])]
        clock = Clock()
        collect.run_host("h.example", jobs, fetch, lambda s: stop.set(), clock.clock, 5.0, None, stop)
        self.assertEqual(calls, ["https://h.example/a"])


class Interrupt(unittest.TestCase):
    def test_ctrl_c_writes_nothing_exits_130_and_stops_the_other_hosts(self):
        calls = []

        def fetch(url, data=None):
            calls.append(url)
            raise KeyboardInterrupt
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "collected")
            err = io.StringIO()
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                code = collect.main([out, "--only", "cineteatro", "mcr-caldas", "cm-nazare"], fetch,
                                    lambda s: None, lambda: 0.0, 1)
            self.assertEqual(code, 130)
            self.assertFalse(os.path.exists(out))
        self.assertIn("interrupted", err.getvalue())
        self.assertEqual(len(calls), 1)


class Main(unittest.TestCase):
    def run_main(self, args, fetch=None, workers=2):
        fetch = fetch or (lambda url, data=None: (200, PAGE, None))
        self.out = tempfile.TemporaryDirectory()
        self.addCleanup(self.out.cleanup)
        self.dir = os.path.join(self.out.name, "collected")
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = collect.main([self.dir] + args, fetch, lambda s: None, lambda: 0.0, workers)
        self.stdout = buffer.getvalue()
        return code

    def read(self, name):
        with open(os.path.join(self.dir, name), encoding="utf-8") as handle:
            return json.load(handle)

    def test_unknown_source_is_a_usage_error(self):
        self.assertEqual(self.run_main(["--only", "nope"]), 2)

    def test_bad_date_is_a_usage_error(self):
        self.assertEqual(self.run_main(["--from", "soon"]), 2)

    def test_every_source_failing_is_exit_2_and_writes_nothing(self):
        def down(url, data=None):
            raise OSError("down")
        self.assertEqual(self.run_main(["--only", "cineteatro"], down), 2)
        self.assertFalse(os.path.exists(self.dir))

    def test_the_folder_has_an_index_and_a_file_per_group(self):
        code = self.run_main(["--only", "cineteatro", "mcr-caldas", "cm-nazare", "--from", "2026-10-20"])
        self.assertEqual(code, 0)
        index = self.read("index.json")
        self.assertEqual(index["window"], {"start": "2026-10-20", "end": "2026-12-01"})
        self.assertEqual(index["groups"], {
            "rio-maior": {"file": "rio-maior.json", "sources": ["cineteatro"]},
            "oeste-norte": {"file": "oeste-norte.json", "sources": ["mcr-caldas", "cm-nazare"]}})
        self.assertEqual(sorted(os.listdir(self.dir)), ["index.json", "oeste-norte.json", "rio-maior.json"])
        row = index["sources"][0]
        self.assertEqual(row, {
            "name": "cineteatro", "group": "rio-maior", "town": "Rio Maior", "adapter": "text",
            "url": "https://www.cineteatrorm.pt/pt/agenda/", "ok": True, "status": 200, "error": None,
            "note": None, "items": 0, "past": 0, "chars": len("evento " * 60) - 1})
        group = self.read("oeste-norte.json")
        self.assertEqual(group["group"], "oeste-norte")
        self.assertEqual(group["collected_at"], index["collected_at"])
        self.assertEqual(group["window"], index["window"])
        self.assertEqual([s["name"] for s in group["sources"]], ["mcr-caldas", "cm-nazare"])
        self.assertEqual(sorted(group["sources"][0]), sorted(
            ["name", "url", "town", "adapter", "ok", "status", "error", "note", "items", "past",
             "text", "truncated", "label"]))
        self.assertEqual(group["sources"][0]["adapter"], "text")

    def test_one_failure_does_not_stop_the_rest(self):
        def fetch(url, data=None):
            if "cineteatro" in url:
                raise OSError("down")
            return 200, PAGE, None
        code = self.run_main(["--only", "cineteatro", "mcr-caldas"], fetch)
        self.assertEqual(code, 0)
        index = self.read("index.json")
        self.assertEqual([s["ok"] for s in index["sources"]], [False, True])
        self.assertIn("down", index["sources"][0]["error"])

    def test_only_lists_just_the_sources_run(self):
        self.run_main(["--only", "mcr-caldas"])
        index = self.read("index.json")
        self.assertEqual([s["name"] for s in index["sources"]], ["mcr-caldas"])
        self.assertEqual(list(index["groups"]), ["oeste-norte"])
        self.assertEqual(index["groups"]["oeste-norte"]["sources"], ["mcr-caldas"])

    def test_the_summary_line_names_the_counts_and_groups(self):
        self.run_main(["--only", "cineteatro", "mcr-caldas"])
        lines = self.stdout.splitlines()
        self.assertTrue(lines[-1].endswith("collected: 2 sources ok, 0 failed in 2 groups"), lines[-1])
        self.assertTrue(lines[-1].startswith("wrote "))


class Config(unittest.TestCase):
    config = collect.load_config()
    sources = config["sources"]

    def test_names_are_unique(self):
        names = [s["name"] for s in self.sources]
        self.assertEqual(len(names), len(set(names)))

    def test_groups_cover_every_source_exactly_once(self):
        for source in self.sources:
            self.assertIn(source["group"], self.config["groups"], source["name"])
        for group in self.config["groups"]:
            self.assertTrue([s for s in self.sources if s["group"] == group], group)

    def test_every_source_has_an_adapter_and_its_options(self):
        for source in self.sources:
            self.assertIn(source["adapter"], ADAPTERS, source["name"])
            for key in ("name", "label", "town", "group", "url"):
                self.assertTrue(source[key])
        by_name = {s["name"]: s for s in self.sources}
        self.assertTrue(by_name["cm-riomaior"]["options"]["categories"])
        self.assertTrue(by_name["ourem"]["options"]["window_params"])
        self.assertTrue(by_name["cm-cadaval"]["options"]["site"])

    def test_the_group_file_carries_each_sources_label(self):
        label = next(s["label"] for s in self.sources if s["name"] == "cm-nazare")
        self.assertEqual(label, "Município de Nazaré")

    def test_the_adapters_expose_parse(self):
        for name, module in ADAPTERS.items():
            self.assertTrue(callable(module.parse), name)

    def test_hosts_have_delays(self):
        self.assertEqual(self.config["default_delay"], 1.5)
        self.assertEqual(self.config["hosts"]["www.viralagenda.com"]["delay"], 15)
        self.assertEqual(self.config["hosts"]["www.cm-entroncamento.pt"]["delay"], 3)

    def test_a_towns_pages_share_a_group_with_its_viral_page(self):
        for source in self.sources:
            if source["name"].startswith("viralagenda-"):
                for other in self.sources:
                    if (other["town"] == source["town"] and other["group"] != "regional"
                            and other["group"] != source["group"]):
                        self.fail("%s and %s are in different groups" % (source["name"], other["name"]))


class Towns(unittest.TestCase):
    def rows(self):
        path = os.path.join(helpers.SKILL, "references", "towns.md")
        with open(path, encoding="utf-8") as handle:
            lines = [l for l in handle if l.startswith("|")][2:]
        return [[c.strip() for c in l.strip().strip("|").split("|")] for l in lines]

    def test_each_row_is_one_place_and_one_integer(self):
        rows = self.rows()
        self.assertGreater(len(rows), 30)
        for town, municipality, minutes in rows:
            self.assertTrue(minutes.isdigit(), (town, minutes))
            self.assertNotIn(",", town)
            self.assertNotIn("(", town)


class SourceList(unittest.TestCase):
    def test_names_and_urls_are_documented(self):
        path = os.path.join(helpers.SKILL, "references", "sources.md")
        with open(path, encoding="utf-8") as handle:
            doc = handle.read()
        for source in Config.sources:
            if not source["name"].startswith("viralagenda-"):
                self.assertTrue(source["name"] in doc, source["name"])
            self.assertTrue(source["url"].split("?")[0] in doc, source["url"])

    def test_every_adapter_is_named_in_the_docs(self):
        path = os.path.join(helpers.SKILL, "references", "sources.md")
        with open(path, encoding="utf-8") as handle:
            doc = handle.read()
        for name in ADAPTERS:
            self.assertTrue(name in doc, name)


if __name__ == "__main__":
    unittest.main()
