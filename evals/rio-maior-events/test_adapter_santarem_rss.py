"""Offline tests for the Município de Santarém events feed adapter."""

import unittest

from helpers import WINDOW, fixture
from adapters import santarem_rss
from adapters.common import AdapterError, Page

SOURCE = {"name": "t", "adapter": "santarem_rss", "town": "T", "url": "https://www.example.pt/rss_eventos"}


def parse(raw, window=None):
    return santarem_rss.parse(SOURCE, [Page(SOURCE["url"], 200, raw, None)], window)


def by_title(items, title):
    return [i for i in items if i["title"] == title]


class SantaremRss(unittest.TestCase):
    def setUp(self):
        self.items = parse(fixture("santarem.xml"), WINDOW)["items"]

    def test_single_date_has_local_times_and_clean_text(self):
        (item,) = by_title(self.items, "Concerto & Fado")
        self.assertEqual((item["start"], item["end"]), ("2026-10-22 21:30", "2026-10-22 23:00"))
        self.assertEqual(item["venue"], "Teatro Exemplo")
        self.assertEqual(item["url"], "https://www.example.pt/agenda-de-eventos/1-concerto")
        self.assertEqual(item["description"], "Noite de fado com &guitarra")
        self.assertIsNone(item["price"])

    def test_touching_ranges_with_one_link_are_joined(self):
        (item,) = by_title(self.items, "Exposição")
        self.assertEqual((item["start"], item["end"]), ("2026-10-20", "2026-11-10"))
        self.assertEqual(item["description"], "Horário diário: 17:00–17:30. Patente")

    def test_separate_dates_stay_separate(self):
        items = by_title(self.items, "Oficina")
        self.assertEqual([i["start"] for i in items], ["2026-10-24 10:00", "2026-10-31 10:00"])

    def test_same_day_sessions_become_one_item(self):
        (item,) = by_title(self.items, "Teatro escolar")
        self.assertEqual((item["start"], item["end"]), ("2026-11-17 10:30", "2026-11-17 11:30"))
        self.assertEqual(item["description"], "Outras sessões: 14:00–15:00. Duas sessões")

    def test_midnight_times_mean_no_time(self):
        (item,) = by_title(self.items, "Feira")
        self.assertEqual((item["start"], item["end"]), ("2026-11-01", "2026-11-02"))
        self.assertEqual(item["description"], "Sem horas")

    def test_no_date_is_dropped_and_the_window_applies(self):
        self.assertEqual([i["title"] for i in self.items],
                         ["Concerto & Fado", "Exposição", "Oficina", "Oficina", "Teatro escolar", "Feira"])
        everything = parse(fixture("santarem.xml"))["items"]
        self.assertEqual(len(everything), 8)
        self.assertNotIn("Sem data", [i["title"] for i in everything])

    def test_no_text_and_a_note_when_nothing_is_in_window(self):
        parsed = parse(fixture("santarem.xml"), ("2027-01-01", "2027-01-31"))
        self.assertEqual((parsed["items"], parsed["text"], parsed["past"]), ([], None, []))
        self.assertEqual(parsed["note"], "0 items in window")

    def test_a_doctype_is_refused(self):
        raw = b'<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY a "b">]><rss><channel/></rss>'
        with self.assertRaises(AdapterError):
            parse(raw)

    def test_a_utf16_doctype_is_refused(self):
        raw = '<?xml version="1.0" encoding="utf-16"?><!DOCTYPE rss [<!ENTITY a "b">]><rss><channel/></rss>'
        for encoding in ("utf-16", "utf-16-le", "utf-32"):
            with self.assertRaisesRegex(AdapterError, "not ASCII-compatible"):
                parse(raw.encode(encoding))

    def test_consecutive_single_days_with_one_link_stay_separate(self):
        def entry(day, time):
            return ("<item><title>Peça</title><link>https://www.example.pt/p</link>"
                    "<santaremEvent><startTime>%s</startTime><singleDate>%s</singleDate>"
                    "</santaremEvent></item>" % (time, day))
        raw = ('<rss><channel>' + entry("2026-10-23", "21:30") + entry("2026-10-24", "16:00")
               + '</channel></rss>').encode()
        items = parse(raw)["items"]
        self.assertEqual([i["start"] for i in items], ["2026-10-23 21:30", "2026-10-24 16:00"])

    def test_malformed_xml_is_an_error(self):
        with self.assertRaisesRegex(AdapterError, "not valid XML"):
            parse(b"<rss><channel><item>")

    def test_valid_xml_without_a_channel_is_an_error(self):
        with self.assertRaises(AdapterError):
            parse(b"<html><body/></html>")
        with self.assertRaises(AdapterError):
            parse(b'<rss version="2.0"></rss>')


if __name__ == "__main__":
    unittest.main()
