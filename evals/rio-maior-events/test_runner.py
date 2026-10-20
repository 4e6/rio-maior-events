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
import re
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
from adapters.common import Page, Request

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


class Encoding(unittest.TestCase):
    TEXT = ("<p>Concerto no Cineteatro. " * 40).encode()

    def gzip_bytes(self):
        import gzip
        return gzip.compress(self.TEXT)

    def test_gzip_with_header(self):
        self.assertEqual(collect.inflate(self.gzip_bytes(), "gzip"), self.TEXT)

    def test_gzip_without_header_by_magic_bytes(self):
        self.assertEqual(collect.inflate(self.gzip_bytes(), None), self.TEXT)

    def test_deflate_zlib_and_raw(self):
        import zlib
        self.assertEqual(collect.inflate(zlib.compress(self.TEXT), "deflate"), self.TEXT)
        raw = zlib.compressobj(wbits=-15)
        data = raw.compress(self.TEXT) + raw.flush()
        self.assertEqual(collect.inflate(data, "deflate"), self.TEXT)

    def test_plain_body_is_untouched(self):
        self.assertEqual(collect.inflate(self.TEXT, None), self.TEXT)
        self.assertEqual(collect.inflate(self.TEXT, "identity"), self.TEXT)

    def run_one(self, body, content_type=None):
        clock = Clock()
        return collect.run_host("h.example", [("a", [Request("u")])], lambda url, data=None: (200, body, content_type),
                                clock.sleep, clock.clock, 2.0)

    def test_garbled_text_fails_its_source(self):
        outcomes = self.run_one(bytes(range(0, 9)) * 100)
        self.assertEqual(outcomes["a"]["error"], "unreadable response (binary or garbled)")
        self.assertIsNone(outcomes["a"]["pages"])

    def test_normal_text_is_unaffected(self):
        outcomes = self.run_one(PAGE, "text/html; charset=utf-8")
        self.assertIsNone(outcomes["a"]["error"])
        self.assertFalse(collect.garbled("Olá, São João – ação".encode("utf-8"), None))

    def fetch_with(self, body, encoding):
        headers = {"Content-Type": "text/html; charset=utf-8"}
        if encoding:
            headers["Content-Encoding"] = encoding
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.read.return_value = body
        response.headers = headers
        with mock.patch("urllib.request.urlopen", return_value=response):
            return collect.fetch("https://h.example/")

    def test_fetch_decompresses_gzip_with_the_header(self):
        status, body, content_type = self.fetch_with(self.gzip_bytes(), "gzip")
        self.assertEqual((status, body, content_type), (200, self.TEXT, "text/html; charset=utf-8"))

    def test_fetch_decompresses_gzip_without_the_header(self):
        self.assertEqual(self.fetch_with(self.gzip_bytes(), None)[1], self.TEXT)

    def test_undecoded_gzip_reaching_the_runner_fails_the_source_as_unreadable(self):
        # run_host receives what fetch returns; fetch has already inflated, so
        # compressed bytes arriving here mean an encoding it could not undo.
        outcomes = self.run_one(self.gzip_bytes(), "text/html; charset=utf-8")
        self.assertEqual(outcomes["a"]["error"], "unreadable response (binary or garbled)")
        self.assertIsNone(outcomes["a"]["pages"])


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


EVENT = ("<html><head><title>Fado - Teatro</title><meta property=\"og:title\" content=\"Fado\">"
         "</head><body><h1>Fado</h1><p>%s</p></body></html>" % ("noite " * 30)).encode()


class Follow(unittest.TestCase):
    """The second stage of run_host: the event pages a source asks for."""

    def run_host(self, jobs, follows, fetch=None, follow_fetch=None, delay=2.0, stop=None):
        """jobs is [(name, list url)]; follows {name: [urls]}. Returns (clock, calls, got, outcomes)."""
        clock = Clock()
        calls, got = [], {}

        def fetching(url, data=None):
            calls.append(url)
            return (fetch or clock.fetch)(url, data)
        pairs = [(n, [Request(u)]) for n, u in jobs]
        outcomes = collect.run_host(
            "h.example", pairs, fetching, clock.sleep, clock.clock, delay,
            lambda name, outcome: [Request(u) for u in follows.get(name, [])], stop,
            follow_fetch and (lambda url, data=None: calls.append(url) or follow_fetch(url, data)),
            lambda name, pages: got.__setitem__(name, [p.url for p in pages]))
        return clock, calls, got, outcomes

    def test_all_list_pages_come_first_then_the_event_pages_once_each(self):
        jobs = [("a", "https://h.example/la"), ("b", "https://h.example/lb")]
        follows = {"a": ["https://h.example/e1", "https://h.example/e2"],
                   "b": ["https://h.example/e2", "https://h.example/e3"]}
        clock, calls, got, _ = self.run_host(jobs, follows)
        self.assertEqual([u.rsplit("/", 1)[1] for u in calls], ["la", "lb", "e1", "e2", "e3"])
        self.assertEqual(got, {"a": ["https://h.example/e1", "https://h.example/e2"],
                               "b": ["https://h.example/e2", "https://h.example/e3"]})
        self.assertEqual(clock.sleeps, [2.0] * 4)

    def test_a_page_carries_its_final_url_when_the_fetch_gives_one(self):
        def follow_fetch(url, data=None):
            return 200, PAGE, None, url + "/final"
        _, _, got, _ = self.run_host([("a", "https://h.example/la")], {"a": ["https://h.example/e1"]},
                                     follow_fetch=follow_fetch)
        self.assertEqual(got, {"a": ["https://h.example/e1/final"]})

    def test_a_failed_event_page_is_skipped_and_the_rest_are_fetched(self):
        def fetch(url, data=None):
            if url.endswith(("e1", "e2", "e3")):
                raise {"e1": http(404), "e2": collect.RedirectRefused("elsewhere"),
                       "e3": OSError("odd")}[url[-2:]]
            return 200, PAGE, None
        follows = {"a": ["https://h.example/%s" % n for n in ("e1", "e2", "e3", "e4")]}
        _, calls, got, outcomes = self.run_host([("a", "https://h.example/la")], follows, fetch=fetch)
        self.assertEqual(len(calls), 5)
        self.assertEqual(got, {"a": ["https://h.example/e4"]})
        self.assertIsNone(outcomes["a"]["error"])

    def test_a_refusal_ends_the_event_pages_but_the_list_results_stand(self):
        for error in (http(403), http(429), http(503), socket.timeout("t"), ConnectionResetError("r"),
                      urllib.error.URLError("refused")):
            def fetch(url, data=None):
                if url.endswith("e2"):
                    raise error
                return 200, PAGE, None
            follows = {"a": ["https://h.example/e1", "https://h.example/e2", "https://h.example/e3"],
                       "b": ["https://h.example/e4"]}
            jobs = [("a", "https://h.example/la"), ("b", "https://h.example/lb")]
            _, calls, got, outcomes = self.run_host(jobs, follows, fetch=fetch)
            self.assertEqual(len(calls), 4, error)
            self.assertEqual(got, {"a": ["https://h.example/e1"]}, error)
            self.assertEqual([o["error"] for o in outcomes.values()], [None, None])

    def test_no_event_pages_after_a_refused_list_page(self):
        def fetch(url, data=None):
            if url.endswith("lb"):
                raise http(403)
            return 200, PAGE, None
        jobs = [("a", "https://h.example/la"), ("b", "https://h.example/lb")]
        _, calls, got, _ = self.run_host(jobs, {"a": ["https://h.example/e1"]}, fetch=fetch)
        self.assertEqual((len(calls), got), (2, {}))

    def test_a_source_whose_list_page_failed_gets_no_event_pages(self):
        def fetch(url, data=None):
            if url.endswith("la"):
                raise http(404)
            return 200, PAGE, None
        _, calls, got, _ = self.run_host([("a", "https://h.example/la")], {"a": ["https://h.example/e1"]},
                                         fetch=fetch)
        self.assertEqual((calls, got), (["https://h.example/la"], {}))

    def test_a_garbled_event_page_is_skipped(self):
        def fetch(url, data=None):
            return 200, (bytes(range(0, 9)) * 100 if url.endswith("e1") else PAGE), None
        _, _, got, _ = self.run_host([("a", "https://h.example/la")],
                                     {"a": ["https://h.example/e1", "https://h.example/e2"]}, fetch=fetch)
        self.assertEqual(got, {"a": ["https://h.example/e2"]})

    def test_the_stop_ends_the_event_pages_too(self):
        stop = threading.Event()
        calls = []

        def fetch(url, data=None):
            calls.append(url)
            if url.endswith("e1"):
                stop.set()
            return 200, PAGE, None
        jobs = [("a", [Request("https://h.example/la")])]
        clock = Clock()
        collect.run_host("h.example", jobs, fetch, clock.sleep, clock.clock, 1.0,
                         lambda n, o: [Request("https://h.example/e1"), Request("https://h.example/e2")], stop)
        self.assertEqual([u[-2:] for u in calls], ["la", "e1"])


class Redirects(unittest.TestCase):
    def handler(self, newurl):
        handler = collect._SameHost("h.example")
        request = urllib.request.Request("https://h.example/a")
        return handler.redirect_request(request, io.BytesIO(), 302, "Found", {}, newurl)

    def test_a_redirect_on_the_same_host_over_https_is_followed(self):
        self.assertEqual(self.handler("https://h.example/b").full_url, "https://h.example/b")

    def test_a_redirect_to_another_host_or_to_http_is_refused_before_it_is_requested(self):
        for url in ("https://www.h.example/b", "https://other.example/b", "http://h.example/b"):
            with self.assertRaises(collect.RedirectRefused, msg=url):
                self.handler(url)


class FetchFollow(unittest.TestCase):
    """fetch_follow against a server on this machine (no network)."""

    @classmethod
    def setUpClass(cls):
        import http.server

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/ok":
                    body = b"<p>ola</p>"
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                else:
                    self.send_response(302)
                    self.send_header("Location", "http://localhost:%d/ok" % self.server.server_port)
                    self.end_headers()

            def log_message(self, *args):
                pass
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_a_page_comes_back_with_its_final_url(self):
        url = "http://127.0.0.1:%d/ok" % self.server.server_port
        self.assertEqual(collect.fetch_follow(url), (200, b"<p>ola</p>", "text/html; charset=utf-8", url))

    def test_a_redirect_away_from_the_host_is_refused(self):
        with self.assertRaises(collect.RedirectRefused):
            collect.fetch_follow("http://127.0.0.1:%d/moved" % self.server.server_port)


class FollowContract(unittest.TestCase):
    def source(self, **extra):
        return dict({"name": "a-1", "label": "a", "adapter": "text", "town": "T", "group": "g",
                     "url": "https://a.example/page"}, **extra)

    def collect(self, sources, parsed, fetch=None, **adapter):
        """collect_all with a fake `text` adapter whose parse returns `parsed`."""
        calls = []

        def fetching(url, data=None):
            calls.append(url)
            return (fetch or (lambda u, d=None: (200, EVENT if "/e" in u else PAGE, None)))(url, data)
        fake = types.SimpleNamespace(parse=lambda source, pages, window: parsed, **adapter)
        with mock.patch.dict(collect.ADAPTERS, {"text": fake}):
            results = collect.collect_all(sources, WINDOW, {}, 0, fetching, lambda s: None, lambda: 0.0, 2,
                                          lambda line: None)
        return results, calls

    def follow(self, *paths, host="a.example"):
        return {"items": [], "follow": [Request("https://%s%s" % (host, p)) for p in paths]}

    def test_nothing_is_followed_unless_the_source_allows_it(self):
        results, calls = self.collect([self.source()], self.follow("/e1"))
        self.assertEqual(calls, ["https://a.example/page"])
        self.assertEqual(results[0]["details"], [])

    def test_only_the_sources_own_host_is_followed_in_order_up_to_the_cap(self):
        parsed = {"items": [], "follow": [
            Request("https://evil.example/e0"), Request("https://a.example/e1"), Request("https://a.example/e1"),
            Request("https://a.example/e2"), Request("https://a.example/e3")]}
        results, calls = self.collect([self.source(follow=2)], parsed)
        self.assertEqual(calls, ["https://a.example/page", "https://a.example/e1", "https://a.example/e2"])
        self.assertEqual([d["url"] for d in results[0]["details"]],
                         ["https://a.example/e1", "https://a.example/e2"])

    def test_a_non_ascii_url_is_percent_encoded(self):
        results, calls = self.collect([self.source(follow=1)], self.follow("/e/caf\u00e9 x"))
        self.assertEqual(calls[1], "https://a.example/e/caf%C3%A9%20x")

    def test_the_default_details_read_the_event_pages(self):
        results, _ = self.collect([self.source(follow=1)], self.follow("/e1"))
        (detail,) = results[0]["details"]
        self.assertEqual((detail["url"], detail["title"]), ("https://a.example/e1", "Fado"))
        self.assertTrue(results[0]["ok"])

    def test_the_adapters_own_details_step_is_used(self):
        seen = []

        def details(source, pages, window):
            seen.append(([p.url for p in pages], window))
            return [{"url": "u", "title": "own"}]
        results, _ = self.collect([self.source(follow=1)], self.follow("/e1"), details=details)
        self.assertEqual(results[0]["details"], [{"url": "u", "title": "own"}])
        self.assertEqual(seen, [(["https://a.example/e1"], WINDOW)])

    def test_a_failing_or_malformed_details_step_keeps_the_source_without_details(self):
        def boom(source, pages, window):
            raise ValueError("x")
        for step in (boom, lambda s, p, w: "x", lambda s, p, w: [1], lambda s, p, w: None):
            results, _ = self.collect([self.source(follow=1)], self.follow("/e1"), details=step)
            self.assertTrue(results[0]["ok"])
            self.assertEqual(results[0]["details"], [])

    def test_failed_and_refused_event_pages_leave_the_source_ok(self):
        def fetch(url, data=None):
            if "/e" in url:
                raise http(403)
            return 200, PAGE, None
        results, calls = self.collect([self.source(follow=3)], self.follow("/e1", "/e2"), fetch=fetch)
        self.assertEqual(len(calls), 2)
        self.assertTrue(results[0]["ok"])
        self.assertEqual(results[0]["details"], [])

    def test_a_malformed_follow_fails_the_source(self):
        for follow in ("x", ["https://a.example/e1"], [Request("https://a.example/e1", b"x=1")],
                       [Request(5)], {"a": 1}):
            results, calls = self.collect([self.source(follow=1)], {"items": [], "follow": follow})
            self.assertFalse(results[0]["ok"], follow)
            self.assertEqual(results[0]["error"], "adapter returned a malformed result")
            self.assertEqual(calls, ["https://a.example/page"])

    def test_the_same_page_for_two_sources_is_fetched_once(self):
        sources = [self.source(follow=1), dict(self.source(follow=1), name="a-2")]
        results, calls = self.collect(sources, self.follow("/e1"))
        self.assertEqual(calls.count("https://a.example/e1"), 1)
        self.assertEqual([len(r["details"]) for r in results], [1, 1])

    def test_a_real_follow_fetch_is_used_only_for_the_real_fetch(self):
        seen = []

        def fetching(url, data=None):
            seen.append(("fetch", url))
            return 200, EVENT if "/e" in url else PAGE, None

        def following(url, data=None):
            seen.append(("follow", url))
            return 200, EVENT, None, url
        fake = types.SimpleNamespace(parse=lambda source, pages, window: self.follow("/e1"))
        with mock.patch.dict(collect.ADAPTERS, {"text": fake}):
            collect.collect_all([self.source(follow=1)], WINDOW, {}, 0, fetching, lambda s: None,
                                lambda: 0.0, 1, lambda l: None, following)
        self.assertEqual(seen, [("fetch", "https://a.example/page"), ("follow", "https://a.example/e1")])


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
                code = collect.main([out, "--only", "cineteatro", "mcr-caldas", "cm-peniche"], fetch,
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
        code = self.run_main(["--only", "cineteatro", "mcr-caldas", "cm-peniche", "--from", "2026-10-20"])
        self.assertEqual(code, 0)
        index = self.read("index.json")
        self.assertEqual(index["window"], {"start": "2026-10-20", "end": "2026-12-01"})
        self.assertEqual(index["groups"], {
            "rio-maior": {"file": "rio-maior.json", "sources": ["cineteatro"]},
            "oeste-norte": {"file": "oeste-norte.json", "sources": ["mcr-caldas", "cm-peniche"]}})
        self.assertEqual(sorted(os.listdir(self.dir)), ["index.json", "oeste-norte.json", "rio-maior.json"])
        row = index["sources"][0]
        self.assertEqual(row, {
            "name": "cineteatro", "group": "rio-maior", "town": "Rio Maior", "adapter": "text",
            "url": "https://www.cineteatrorm.pt/pt/agenda/", "ok": True, "status": 200, "error": None,
            "note": None, "items": 0, "past": 0, "chars": len("evento " * 60) - 1, "details": 0})
        group = self.read("oeste-norte.json")
        self.assertEqual(group["group"], "oeste-norte")
        self.assertEqual(group["collected_at"], index["collected_at"])
        self.assertEqual(group["window"], index["window"])
        self.assertEqual([s["name"] for s in group["sources"]], ["mcr-caldas", "cm-peniche"])
        self.assertEqual(sorted(group["sources"][0]), sorted(
            ["name", "url", "town", "adapter", "ok", "status", "error", "note", "items", "past",
             "text", "truncated", "label", "details"]))
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

    def test_links_are_regexes_for_text_sources_and_follow_is_a_small_count(self):
        for source in self.sources:
            if "links" in source:
                self.assertEqual(source["adapter"], "text", source["name"])
                re.compile(source["links"])
            follow = source.get("follow", 0)
            self.assertTrue(isinstance(follow, int) and 0 <= follow <= 15, source["name"])
            if follow and source["adapter"] == "text":
                self.assertIn("links", source, source["name"])

    def test_the_municipal_feeds_are_sources_of_their_own_adapter(self):
        by_name = {s["name"]: s for s in self.sources}
        for name in ("cm-nazare", "cm-batalha", "cm-chamusca"):
            self.assertEqual(by_name[name]["adapter"], "municipal_rss", name)
            self.assertTrue(urllib.parse.urlsplit(by_name[name]["url"]).path.endswith(".rss"), name)
            self.assertTrue(by_name[name]["options"]["page"].startswith("https://"), name)
        self.assertEqual(by_name["cm-nazare"]["follow"], 8)

    def test_urls_are_on_the_final_host(self):
        by_name = {s["name"]: s for s in self.sources}
        self.assertEqual(by_name["mcr-caldas"]["url"], "https://www.mcr.pt/agenda")
        self.assertEqual(urllib.parse.urlsplit(by_name["cm-torresnovas"]["url"]).hostname, "cm-torresnovas.pt")

    def test_hosts_have_delays(self):
        self.assertEqual(self.config["default_delay"], 1.5)
        self.assertEqual(self.config["hosts"]["www.cm-entroncamento.pt"]["delay"], 3)

    def test_a_towns_pages_share_a_group(self):
        for source in self.sources:
            for other in self.sources:
                if (other["town"] == source["town"] and "regional" not in (other["group"], source["group"])
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
