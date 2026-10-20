"""Offline tests for the Next.js adapter."""

import unittest

from helpers import WINDOW, fixture
from adapters import nextjs
from adapters.common import Page

URL = "https://www.example.pt/agenda"
SOURCE = {"name": "s", "url": URL, "town": "T", "adapter": "nextjs"}


def page(name="nextjs.html"):
    return fixture(name).decode("utf-8")


def parse(text):
    return nextjs.parse(SOURCE, [Page(URL, 200, text.encode("utf-8"), None)], WINDOW)


class NextJs(unittest.TestCase):
    def test_event_list_split_over_two_chunks_is_decoded(self):
        items = nextjs.parse_nextjs(page(), URL, None)[0]
        self.assertEqual([i["title"] for i in items],
                         ['Concerto "Primavera" | Ensaio à luz', "Antigo", "Feira longa"])

    def test_fields_dates_are_days_and_links_are_absolute(self):
        item = nextjs.parse_nextjs(page(), URL, None)[0][0]
        self.assertEqual(item["start"], "2026-10-24")
        self.assertIsNone(item["end"])
        self.assertEqual(item["venue"], "Teatro São João")
        self.assertEqual(item["url"], "https://www.example.pt/agenda/concerto--primavera")

    def test_window_keeps_running_events_and_drops_past_ones(self):
        items, _ = nextjs.parse_nextjs(page(), URL, WINDOW)
        self.assertEqual([i["title"] for i in items][1:], ["Feira longa"])
        self.assertEqual(len(items), 2)

    def test_later_pages_are_noted(self):
        paged = page().replace('\\"count\\": 3, \\"totalPages\\": 1', '\\"count\\": 17, \\"totalPages\\": 2')
        self.assertEqual(nextjs.parse_nextjs(paged, URL, None)[1],
                         "page 1 of 2, 17 events in all; later events are not in this file")
        self.assertIsNone(nextjs.parse_nextjs(page(), URL, None)[1])
        self.assertEqual(parse(paged)["note"],
                         "page 1 of 2, 17 events in all; later events are not in this file")

    def test_odd_entries_are_skipped(self):
        odd = page().replace('[{\\"id\\": 1,', '[7, null, {\\"id\\": 9}, {\\"id\\": 1,')
        items, _ = nextjs.parse_nextjs(odd, URL, None)
        self.assertEqual(len(items), 3)

    def test_a_page_without_event_list_is_an_error(self):
        with self.assertRaises(ValueError):
            nextjs.parse_nextjs("<p>nothing</p>", URL, WINDOW)

    def test_zero_items_is_ok_with_a_note(self):
        parsed = parse(page("nextjs_empty.html"))
        self.assertEqual(parsed["items"], [])
        self.assertEqual(parsed["note"], "0 items in window")

    def test_parse_returns_items_and_text(self):
        parsed = parse(page())
        self.assertEqual(len(parsed["items"]), 2)
        self.assertIn("Agenda", parsed["text"])


if __name__ == "__main__":
    unittest.main()
