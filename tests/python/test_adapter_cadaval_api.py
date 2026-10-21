"""Offline tests for the Cadaval portal adapter."""

import json
import unittest

from helpers import WINDOW, fixture
from adapters import cadaval_api
from adapters.common import Page

SOURCE = {"name": "c", "adapter": "cadaval_api", "town": "C",
          "url": "https://api.example.test/website/Events/1?page=1&lang=pt",
          "options": {"site": "https://www.cm-cadaval.pt"}}


def parse(raw, window=None):
    return cadaval_api.parse(SOURCE, [Page(SOURCE["url"], 200, raw, None)], window)


class Cadaval(unittest.TestCase):
    def test_mapping(self):
        parsed = parse(fixture("cadaval.json"), WINDOW)
        items = parsed["items"]
        self.assertEqual([i["title"] for i in items], ["Festa das Adiafas & Vinho", "Sem link"])
        self.assertEqual(items[0]["start"], "2026-10-17")
        self.assertEqual(items[0]["end"], "2026-10-25")
        self.assertEqual(items[0]["url"], "https://www.cm-cadaval.pt/2716/festa-das-adiafas")
        self.assertEqual(items[1]["url"], "https://www.cm-cadaval.pt/")
        self.assertIsNone(parsed["text"])

    def test_the_request_is_the_plain_url(self):
        self.assertFalse(hasattr(cadaval_api, "requests"))

    def test_odd_entries_are_skipped(self):
        raw = json.dumps({"items": [3, None, {"date": "2026-10-22"},
                                    {"title": "Bom", "date": "2026-10-22T00:00:00"}]}).encode()
        self.assertEqual([i["title"] for i in parse(raw)["items"]], ["Bom"])

    def test_zero_items_is_ok_with_a_note(self):
        self.assertEqual(parse(b'{"items": []}', WINDOW)["note"], "0 items in window")

    def test_wrong_shape_is_an_error(self):
        with self.assertRaises(ValueError):
            parse(b"[1]")


if __name__ == "__main__":
    unittest.main()
