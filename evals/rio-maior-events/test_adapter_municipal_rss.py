"""Offline tests for the shared municipal RSS feed adapter."""

import unittest

from helpers import fixture
from adapters import municipal_rss
from adapters.common import AdapterError, Page, Request

URL = "https://www.example.pt/pages/agenda.rss"
SOURCE = {"name": "t", "adapter": "municipal_rss", "town": "T", "url": URL}
WINDOW = ("2026-10-20", "2026-11-22")


def parse(raw, window=WINDOW):
    return municipal_rss.parse(SOURCE, [Page(URL, 200, raw, None)], window)


def feed(*items):
    return ('<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>%s</channel></rss>'
            % "".join(items)).encode()


class MunicipalRss(unittest.TestCase):
    def setUp(self):
        self.result = parse(fixture("municipal.rss"))
        self.items = {i["title"]: i for i in self.result["items"]}

    def test_the_offset_is_applied_across_the_change(self):
        # 09:00 UTC on the 25th is after the change (01:00 UTC): winter time, UTC+0.
        self.assertEqual(self.items["Corrida"]["start"], "2026-10-25 09:00")
        self.assertEqual(self.items["Meia-noite de verão"]["start"], "2026-10-26 22:00")

    def test_summer_offset_before_the_change_is_kept(self):
        raw = feed("<item><title>A</title><pubDate>Sat, 24 Oct 2026 10:00:00 +0100</pubDate></item>")
        self.assertEqual(parse(raw)["items"][0]["start"], "2026-10-24 10:00")

    def test_utc_before_the_change_is_summer_time(self):
        self.assertEqual(self.items["Teatro de verão"]["start"], "2026-10-24 00:30")

    def test_utc_after_the_change_is_the_same_clock(self):
        item = self.items["Concerto & Fado"]
        self.assertEqual(item["start"], "2026-10-31 21:00")
        self.assertEqual(item["description"], "Noite de fado")
        self.assertEqual(item["url"], "https://www.example.pt/agenda/evento/fado")
        self.assertIsNone(item["end"])
        self.assertIsNone(item["venue"])

    def test_midnight_local_is_a_date_only(self):
        self.assertEqual(self.items["CINEMA"]["start"], "2026-11-22")

    def test_midnight_from_an_offset(self):
        raw = feed("<item><title>A</title><pubDate>Sat, 24 Oct 2026 23:00:00 +0000</pubDate></item>")
        self.assertEqual(parse(raw)["items"][0]["start"], "2026-10-25")

    def test_image_only_description_is_none(self):
        self.assertIsNone(self.items["CINEMA"]["description"])

    def test_window_filter_and_unreadable_dates(self):
        self.assertEqual(set(self.items), {"Concerto & Fado", "CINEMA", "Corrida", "Teatro de verão",
                                           "Meia-noite de verão"})

    def test_items_ascend_and_follow_matches(self):
        starts = [i["start"] for i in self.result["items"]]
        self.assertEqual(starts, sorted(starts))
        self.assertEqual(starts[0], "2026-10-24 00:30")
        self.assertEqual([r.url for r in self.result["follow"]],
                         [i["url"] for i in self.result["items"]])
        self.assertTrue(all(isinstance(r, Request) for r in self.result["follow"]))
        self.assertIn("https://www.example.pt/agenda/evento/teatro", [r.url for r in self.result["follow"]])

    def test_no_items_in_window_is_ok_with_a_note(self):
        result = parse(fixture("municipal.rss"), ("2027-01-01", "2027-01-31"))
        self.assertEqual((result["items"], result["follow"], result["note"]),
                         ([], [], "0 items in window"))

    def test_doctype_is_refused(self):
        raw = b'<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY x "y">]><rss><channel></channel></rss>'
        with self.assertRaises(AdapterError):
            parse(raw)

    def test_missing_channel(self):
        with self.assertRaises(AdapterError):
            parse(b'<rss version="2.0"></rss>')
        with self.assertRaises(AdapterError):
            parse(b"<html><body>no</body></html>")

    def test_not_xml(self):
        with self.assertRaises(AdapterError):
            parse(b"<rss><channel>")


if __name__ == "__main__":
    unittest.main()
