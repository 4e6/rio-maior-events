"""Offline tests for the text adapter and the helpers it shares (visible text, JSON-LD)."""

import unittest

import helpers
from helpers import WINDOW, fixture
from adapters import text
from adapters.common import AdapterError, Page, extract_jsonld_events, visible_text


class JsonLd(unittest.TestCase):
    def setUp(self):
        self.page = fixture("page.html").decode("utf-8")

    def test_flattens_item_lists_and_graphs(self):
        names = [e["name"] for e in extract_jsonld_events(self.page)]
        self.assertEqual(names, ["Trail & Serra", "Past gig", "Long fair"])

    def test_event_fields(self):
        event = extract_jsonld_events(self.page)[0]
        self.assertEqual(event["location"], "Pavilhão")
        self.assertEqual(event["addressLocality"], "Rio Maior")
        self.assertEqual(event["price"], "12")
        self.assertEqual(event["url"], "https://example.org/trail")

    def test_window_keeps_events_still_running(self):
        names = [e["name"] for e in extract_jsonld_events(self.page, WINDOW)]
        self.assertEqual(names, ["Trail & Serra", "Long fair"])

    def test_description_is_cut(self):
        page = ('<script type="application/ld+json">{"@type":"Event","name":"x",'
                '"description":"%s"}</script>' % ("a" * 500))
        self.assertEqual(len(extract_jsonld_events(page)[0]["description"]), 300)


class VisibleText(unittest.TestCase):
    def test_drops_chrome_and_collapses_whitespace(self):
        result, truncated = visible_text(fixture("page.html").decode("utf-8"))
        self.assertFalse(truncated)
        self.assertNotIn("Site header", result)
        self.assertNotIn("Menu", result)
        self.assertNotIn("Footer text", result)
        self.assertNotIn("hidden", result)
        self.assertNotIn("color:red", result)
        self.assertIn("Sáb 24 out & mais\nConcerto às 21:30", result)
        self.assertIn("Item um\nItem dois", result)

    def test_a_card_keeps_its_header_inside_an_article(self):
        result, _ = visible_text(fixture("page.html").decode("utf-8"))
        self.assertIn("Cartao Titulo\n24 out", result)
        self.assertIn("Cartao rodape", result)
        self.assertNotIn("Site header", result)
        self.assertNotIn("Footer text", result)

    def test_a_page_header_after_an_article_is_still_dropped(self):
        result, _ = visible_text(
            "<article><p>Card</p></article><header>Top</header><main><p>Body</p></main>")
        self.assertEqual(result, "Card\nBody")

    def test_cap_sets_truncated(self):
        result, truncated = visible_text("<p>%s</p>" % ("a" * 100), cap=40)
        self.assertEqual((len(result), truncated), (40, True))


class InlineText(unittest.TestCase):
    def text(self, page):
        return visible_text("<p>%s</p>" % page)[0]

    def test_fields_in_spans_are_kept_apart(self):
        self.assertEqual(self.text("<span>Trail 2026</span><span>dom</span><span>15</span><span>nov</span>"),
                         "Trail 2026 dom 15 nov")

    def test_fields_in_adjacent_ems_are_kept_apart(self):
        self.assertEqual(self.text("<em>sab</em><em>24</em><em>out</em><em>Dia</em>"), "sab 24 out Dia")

    def test_markup_inside_a_word_or_number_joins(self):
        self.assertEqual(self.text("Sá<b>b</b> 6<sup>ª</sup>"), "Sáb 6ª")
        self.assertEqual(self.text("<span>21</span>:<span>30</span> €<span>8</span>"), "21:30 €8")
        self.assertEqual(self.text("<a href=x>Concerto</a>, hoje"), "Concerto, hoje")


class TextCapAndMarkup(unittest.TestCase):
    def test_office_xml_spread_over_lines_is_dropped_but_less_than_survives(self):
        page = ("<p>Agenda</p><p>&lt;18 anos: entrada gratuita</p>"
                "<p>&lt;w:LsdException Locked=\"false\" Priority=\"9\"</p>"
                "<p>UnhideWhenUsed=\"true\" QFormat=\"true\" Name=\"heading 2\"/&gt;</p>"
                "<p>SemiHidden=\"false\" Name=\"x\" Priority=\"1\"</p>"
                "<p>&lt;!--[if gte mso 9]&gt;&lt;xml&gt;</p><p>&lt;![endif]--&gt;</p>"
                "<p>&lt;/w:LatentStyles&gt;</p><p>Concerto &lt;b&gt; &gt; dia 3</p>")
        result, _ = visible_text(page)
        self.assertEqual(result, "Agenda\n<18 anos: entrada gratuita\nConcerto <b> > dia 3")

    def test_markup_lines_are_dropped(self):
        result, _ = visible_text(fixture("markup.html").decode("utf-8"))
        self.assertEqual(result, "Agenda de eventos\nConcerto no sábado < 18h")


class Parse(unittest.TestCase):
    source = {"name": "s", "url": "https://example.org/", "town": "T", "adapter": "text"}

    def parse(self, page, source=None):
        pages = [Page("https://example.org/", 200, page.encode("utf-8"), None)]
        return text.parse(source or self.source, pages, WINDOW)

    def test_empty_page_is_a_failure(self):
        with self.assertRaises(AdapterError) as caught:
            self.parse("<html><body><p>Ola</p></body></html>")
        self.assertIn("layout may have changed", str(caught.exception))

    def test_page_with_text_is_ok(self):
        parsed = self.parse("<p>%s</p>" % ("evento " * 60))
        self.assertEqual(parsed["items"], [])
        self.assertIsNone(parsed["note"])

    def test_a_source_cap_overrides_the_default(self):
        parsed = self.parse("<p>%s</p>" % ("evento " * 100), dict(self.source, cap=250))
        self.assertEqual(len(parsed["text"]), 250)
        self.assertTrue(parsed["truncated"])

    def test_peniche_has_a_cap(self):
        import json
        import os
        with open(os.path.join(helpers.SCRIPTS, "sources.json"), encoding="utf-8") as handle:
            sources = json.load(handle)["sources"]
        self.assertEqual([s["cap"] for s in sources if s["name"] == "cm-peniche"], [4000])

    def test_jsonld_events_come_with_the_text(self):
        parsed = self.parse(fixture("page.html").decode("utf-8"))
        self.assertEqual(len(parsed["items"]), 2)
        self.assertIn("Concerto", parsed["text"])


if __name__ == "__main__":
    unittest.main()
