"""Offline tests for the cm-riomaior calendar adapter."""

import datetime
import unittest
import urllib.parse

from helpers import WINDOW, fixture
from adapters import riomaior_calendar
from adapters.common import Page, lisbon_time

BASE = "https://www.cm-riomaior.pt"
SOURCE = {"name": "cm", "url": BASE + "/index.php?option=com_ajax", "town": "Rio Maior",
          "adapter": "riomaior_calendar", "options": {"categories": ["116", "121"]}}


def items(raw, window=WINDOW):
    return riomaior_calendar.parse_items(raw, window, BASE)


class CmJson(unittest.TestCase):
    def test_keeps_only_the_window_and_unescapes(self):
        got = items(fixture("cm.json"))
        self.assertEqual([i["title"] for i in got], ["Earlier", 'Concerto "Natal" & Coro'])
        self.assertEqual(got[1]["date"], "2026-10-24")
        self.assertEqual(got[1]["start"], "2026-10-24T21:00:00+00:00")
        self.assertEqual(got[1]["description"], "Entrada livre '")

    def test_local_time_follows_portuguese_summer_time(self):
        self.assertEqual(items(fixture("cm.json"))[1]["local_start"], "2026-10-24T22:00+01:00")

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
            self.assertEqual(lisbon_time(moment).isoformat(timespec="minutes"), expected)

    def test_date_is_the_local_day(self):
        raw = b'[{"title":"Late","start":"2026-07-10T23:30:00+00:00","url":"","description":""}]'
        self.assertEqual(items(raw, ("2026-07-11", "2026-07-11"))[0]["date"], "2026-07-11")

    def test_urls_become_absolute(self):
        self.assertEqual(items(fixture("cm.json"))[1]["url"],
                         "https://www.cm-riomaior.pt/informacao/agenda-rio-maior/concerto")

    def test_window_is_inclusive(self):
        self.assertEqual(len(items(fixture("cm.json"), ("2026-10-24", "2026-10-24"))), 1)

    def test_not_an_array_is_an_error(self):
        with self.assertRaises(ValueError):
            items(b'{"a": 1}')


class Adapter(unittest.TestCase):
    def test_one_post_with_the_categories(self):
        (request,) = riomaior_calendar.requests(SOURCE, WINDOW)
        self.assertEqual(request.url, SOURCE["url"])
        self.assertEqual(urllib.parse.parse_qsl(request.data.decode("ascii")),
                         [("catid[]", "116"), ("catid[]", "121"), ("description_length", "100"),
                          ("show_child_category_articles", "0"), ("moduleId", "223")])

    def test_parse_carries_the_note_and_no_text(self):
        parsed = riomaior_calendar.parse(SOURCE, [Page(SOURCE["url"], 200, fixture("cm.json"), None)], WINDOW)
        self.assertEqual(len(parsed["items"]), 2)
        self.assertEqual(parsed["note"], riomaior_calendar.CM_NOTE)
        self.assertIsNone(parsed["text"])

    def test_zero_items_is_ok_with_a_note(self):
        parsed = riomaior_calendar.parse(SOURCE, [Page(SOURCE["url"], 200, b"[]", None)], WINDOW)
        self.assertEqual(parsed["items"], [])
        self.assertTrue(parsed["note"].startswith("0 items in window"))


if __name__ == "__main__":
    unittest.main()
