"""Offline tests for the Events Calendar (WordPress) adapter."""

import json
import unittest

from helpers import WINDOW, fixture
from adapters import events_calendar
from adapters.common import Page

SOURCE = {"name": "t", "adapter": "events_calendar", "town": "T",
          "url": "https://www.example.pt/wp-json/tribe/events/v1/events?per_page=50",
          "options": {"window_params": ["start_date", "end_date"]}}


def parse(raw, window=None, source=SOURCE):
    return events_calendar.parse(source, [Page(source["url"], 200, raw, None)], window)


class Tribe(unittest.TestCase):
    def test_titles_are_unescaped_and_venue_may_be_empty(self):
        items = parse(fixture("tribe.json"))["items"]
        self.assertEqual(items[0]["title"], "Feira – Santa & Iria")
        self.assertIsNone(items[0]["venue"])
        self.assertEqual(items[0]["start"], "2026-10-22 18:00:00")
        self.assertEqual(items[0]["end"], "2026-10-25 22:30:00")
        self.assertEqual(items[0]["description"], "Quatro dias de feira .")
        self.assertEqual(items[1]["venue"], "Auditório & Sala")
        self.assertEqual(items[1]["price"], "5 €")
        self.assertEqual(items[1]["url"], "https://www.example.pt/evento/aula/")

    def test_window_and_description_cap(self):
        items = parse(fixture("tribe.json"), WINDOW)["items"]
        self.assertEqual([i["title"] for i in items], ["Feira – Santa & Iria", "Aula", "Muito longo"])
        self.assertEqual(len(items[2]["description"]), 300)

    def test_the_window_is_added_to_the_request_url(self):
        (request,) = events_calendar.requests(SOURCE, WINDOW)
        self.assertEqual(request.url,
                         SOURCE["url"] + "&start_date=2026-10-20&end_date=2026-12-01+23%3A59%3A59")
        self.assertIsNone(request.data)
        bare = dict(SOURCE, url="https://www.example.pt/e")
        self.assertEqual(events_calendar.request_url(bare, WINDOW),
                         "https://www.example.pt/e?start_date=2026-10-20&end_date=2026-12-01+23%3A59%3A59")

    def test_no_text_and_three_items(self):
        parsed = parse(fixture("tribe.json"), WINDOW)
        self.assertIsNone(parsed["text"])
        self.assertEqual(len(parsed["items"]), 3)

    def test_odd_entries_are_skipped(self):
        raw = json.dumps({"events": [3, None, {"start_date": "2026-10-22"},
                                     {"title": "Bom", "start_date": "2026-10-22"}]}).encode()
        self.assertEqual([i["title"] for i in parse(raw)["items"]], ["Bom"])

    def test_zero_items_is_ok_with_a_note(self):
        self.assertEqual(parse(b'{"events": []}', WINDOW)["note"], "0 items in window")

    def test_wrong_shape_is_an_error(self):
        with self.assertRaises(ValueError):
            parse(b"[1]")


if __name__ == "__main__":
    unittest.main()
