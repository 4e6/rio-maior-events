"""Offline tests for the text adapter and the helpers it shares (visible text, JSON-LD)."""

import json
import os
import re
import unittest

import helpers
from helpers import WINDOW, fixture
from adapters import text
from adapters.common import (AdapterError, Page, Request, _markup_line, clean_url, extract_jsonld_events,
                             visible_text, visible_text_links)


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


BASE = "https://www.example.pt/agenda/"
EVENTS = re.compile(r"^/agenda/detalhes/\d+$")


def marked(page, links=EVENTS, base=BASE, cap=10 ** 6):
    return visible_text_links(page, cap, base, links)


class Markers(unittest.TestCase):
    def test_a_marker_line_stands_where_the_anchor_starts(self):
        text, _, urls = marked('<h2>Fado</h2><p>Sab 24 out</p>'
                               '<div><a href="/agenda/detalhes/12"><h3>Concerto</h3><p>21h30</p></a></div>')
        self.assertEqual(text, "Fado\nSab 24 out\n<https://www.example.pt/agenda/detalhes/12>\nConcerto\n21h30")
        self.assertEqual(urls, ["https://www.example.pt/agenda/detalhes/12"])

    def test_a_marker_in_the_middle_of_a_line_gets_a_line_of_its_own(self):
        text, _, _ = marked('<p>Antes <a href="/agenda/detalhes/12">titulo</a> depois</p>')
        self.assertEqual(text, "Antes\n<https://www.example.pt/agenda/detalhes/12>\ntitulo depois")

    def test_nothing_is_marked_without_links(self):
        text, _, urls = visible_text_links('<a href="/agenda/detalhes/12">Concerto</a>', 1000, BASE, None)
        self.assertEqual((text, urls), ("Concerto", []))

    def test_a_strict_regex_leaves_menus_and_category_pages_out(self):
        page = ('<p><a href="/agenda/categoria/37">Musica</a> <a href="/agenda/detalhes/12?x=1">Com query</a>'
                ' <a href="/agenda/detalhes/12">Bom</a> <a href="/agenda/detalhes/x">Letras</a>'
                ' <a href="https://www.example.pt/sobre">Sobre</a></p>')
        self.assertEqual(marked(page)[2], ["https://www.example.pt/agenda/detalhes/12"])

    def test_the_query_is_part_of_what_a_regex_sees(self):
        links = re.compile(r"^/pages/\d+\?event_id=\d+$")
        page = '<a href="/pages/1336?event_id=77">Gala</a><a href="/pages/1336">Lista</a>'
        self.assertEqual(marked(page, links)[2], ["https://www.example.pt/pages/1336?event_id=77"])

    def test_empty_and_digit_only_anchors_without_a_title_are_skipped(self):
        page = ('<a href="/agenda/detalhes/1"><img src="x.png"></a><a href="/agenda/detalhes/2"> 27 </a>'
                '<a href="/agenda/detalhes/3"><span>2</span> <span>8</span></a>'
                '<a href="/agenda/detalhes/4">Titulo 4</a>')
        text, _, urls = marked(page)
        self.assertEqual(urls, ["https://www.example.pt/agenda/detalhes/4"])
        self.assertEqual(text, "27 2 8\n<https://www.example.pt/agenda/detalhes/4>\nTitulo 4")

    def test_a_digit_only_or_empty_anchor_with_a_title_is_marked_with_its_title(self):
        page = ('<td><a href="/agenda/detalhes/28" title="M\u00fasica // Banda  da Armada "><span>28</span></a></td>'
                '<td><a href="/agenda/detalhes/29" title="Cinema"><img src="x.png"></a></td>'
                '<td><a href="/agenda/detalhes/30" title="  "><span>30</span></a></td>'
                '<td><a href="/agenda/categoria/9" title="Outro"><span>9</span></a></td>')
        text, _, urls = marked(page)
        self.assertEqual(text, "<https://www.example.pt/agenda/detalhes/28>\nM\u00fasica // Banda da Armada\n28\n"
                               "<https://www.example.pt/agenda/detalhes/29>\nCinema\n30\n9")
        self.assertEqual(urls, ["https://www.example.pt/agenda/detalhes/28",
                                "https://www.example.pt/agenda/detalhes/29"])

    def test_a_text_anchor_ignores_its_title(self):
        text, _, _ = marked('<a href="/agenda/detalhes/5" title="Outro">Fado</a>')
        self.assertEqual(text, "<https://www.example.pt/agenda/detalhes/5>\nFado")

    def test_a_card_whose_image_link_comes_first_is_marked_at_its_titled_link(self):
        page = ('<div><a href="/agenda/detalhes/9"><img src="x.png"></a>'
                '<h3><a href="/agenda/detalhes/9">Titulo</a></h3></div>')
        self.assertEqual(marked(page)[0], "<https://www.example.pt/agenda/detalhes/9>\nTitulo")

    def test_a_marker_repeated_later_is_kept(self):
        page = ('<a href="/agenda/detalhes/9">A</a><p>C</p><a href="/agenda/detalhes/9">Saber mais</a>')
        text, _, urls = marked(page)
        marker = "<https://www.example.pt/agenda/detalhes/9>"
        self.assertEqual(text, "%s\nA\nC\n%s\nSaber mais" % (marker, marker))
        self.assertEqual(len(urls), 1)

    def test_a_marker_equal_to_the_line_before_it_is_dropped(self):
        # The text between the two anchors is leftover markup, so no line of it remains.
        page = '<a href="/agenda/detalhes/9">&lt;br/&gt;</a><a href="/agenda/detalhes/9">Titulo</a>'
        self.assertEqual(marked(page)[0], "<https://www.example.pt/agenda/detalhes/9>\nTitulo")

    def test_page_chrome_gets_no_markers_but_a_card_header_in_an_article_does(self):
        page = ('<header><a href="/agenda/detalhes/1">Destaque</a></header><nav><a href="/agenda/detalhes/2">Menu</a></nav>'
                '<article><header><a href="/agenda/detalhes/3">Cartao</a></header></article>'
                '<footer><a href="/agenda/detalhes/4">Rodape</a></footer>')
        self.assertEqual(marked(page)[2], ["https://www.example.pt/agenda/detalhes/3"])

    def test_script_and_template_links_get_no_markers(self):
        page = '<template><a href="/agenda/detalhes/1">T</a></template><script>x</script><a href="/agenda/detalhes/2">Ok</a>'
        self.assertEqual(marked(page)[2], ["https://www.example.pt/agenda/detalhes/2"])

    def test_hrefs_are_resolved_cleaned_and_encoded(self):
        base = "https://www.example.pt/agenda/lista/"
        links = re.compile(r"/e/")
        page = ('<a href="../../e/rel">a</a><a href="/e/abs#topo">b</a><a href="//www.example.pt/e/proto">c</a>'
                '<a href="https://example.pt/e/bare-host">d</a><a href="/e/caf\u00e9 \u2014 x">e</a>'
                '<a href="/e/a%20b">f</a><a href="/e/q?a=1&amp;b=\u00e9">g</a>'
                '<a href="https://www.example.pt:443/e/port">h</a><a href="https://other.example/e/off">i</a>'
                '<a href="mailto:x@example.pt">j</a><a href="javascript:void(0)">k</a><a href="#e/x">l</a>')
        self.assertEqual(marked(page, links, base)[2], [
            "https://www.example.pt/e/rel", "https://www.example.pt/e/abs", "https://www.example.pt/e/proto",
            "https://example.pt/e/bare-host", "https://www.example.pt/e/caf%C3%A9%20%E2%80%94%20x",
            "https://www.example.pt/e/a%20b", "https://www.example.pt/e/q?a=1&b=%C3%A9",
            "https://www.example.pt/e/port"])

    def test_clean_url_gives_none_for_what_is_not_a_page(self):
        for href in (None, "", "  ", "mailto:a@b.pt", "javascript:void(0)", "tel:123"):
            self.assertIsNone(clean_url(BASE, href), href)

    def test_markers_survive_the_markup_line_filter(self):
        # A URL can look like markup to the filter: attributes, mso- styles.
        urls = ["https://www.example.pt/agenda/a=\"b\" c=\"d\">", "https://www.example.pt/mso-x/e1",
                "https://www.example.pt/agenda/w:Lsd/e2"]
        page = "".join('<a href="%s">T%d</a>' % (u, n) for n, u in enumerate(urls))
        text, _, found = marked(page, re.compile("."))
        self.assertEqual(len(found), 3)
        self.assertTrue(_markup_line("<%s>" % found[1]))
        for url in found:
            self.assertIn("<%s>" % url, text)

    def test_page_text_that_looks_like_a_marker_is_still_filtered(self):
        text, _, _ = marked("<p>&lt;html lang=\"pt\"&gt;</p><p>Ola</p>")
        self.assertEqual(text, "Ola")

    def test_a_private_use_character_in_the_page_cannot_forge_a_marker(self):
        text, _, urls = marked("<p>\ue000https://evil.example/x</p>")
        self.assertEqual(urls, [])
        self.assertNotIn("<https", text)

    def test_the_cap_cuts_markers_and_urls_together(self):
        page = "".join('<p><a href="/agenda/detalhes/%d">Titulo %d</a></p>' % (n, n) for n in range(1, 40))
        text, truncated, urls = marked(page, cap=400)
        self.assertTrue(truncated)
        self.assertEqual(len(text), 400)
        self.assertEqual(urls, re.findall(r"<(https://[^>]+)>", text))
        self.assertTrue(urls)

    def test_an_unclosed_anchor_is_still_marked(self):
        text, _, urls = marked('<a href="/agenda/detalhes/5">Fim')
        self.assertEqual(urls, ["https://www.example.pt/agenda/detalhes/5"])
        self.assertEqual(text, "<https://www.example.pt/agenda/detalhes/5>\nFim")

    def test_visible_text_is_unchanged_by_links_that_do_not_match(self):
        page = fixture("page.html").decode("utf-8")
        self.assertEqual(marked(page, re.compile("^/nothing$"))[:2], visible_text(page))


class Follows(unittest.TestCase):
    source = {"name": "s", "url": "https://example.org/agenda", "town": "T", "adapter": "text",
              "links": r"^/e/[^/?]+$"}

    def parse(self, page, source=None):
        pages = [Page("https://example.org/agenda", 200, page.encode("utf-8"), None)]
        return text.parse(source or self.source, pages, WINDOW)

    def page(self, *slugs):
        return "<p>%s</p>" % ("evento " * 40) + "".join('<p><a href="/e/%s">Titulo %s</a></p>' % (s, s) for s in slugs)

    def test_follow_lists_the_marked_pages_in_page_order_once_each(self):
        parsed = self.parse(self.page("b", "a", "b", "c"))
        self.assertEqual(parsed["follow"], [Request("https://example.org/e/%s" % s) for s in "bac"])
        self.assertEqual(parsed["text"].count("<https://example.org/e/b>"), 2)

    def test_no_links_in_the_source_means_no_markers_and_no_follow(self):
        parsed = self.parse(self.page("a"), dict(self.source, links=None))
        self.assertNotIn("follow", parsed)
        self.assertNotIn("<https", parsed["text"])

    def test_a_page_without_matches_has_an_empty_follow(self):
        self.assertEqual(self.parse(self.page())["follow"], [])

    def test_links_are_resolved_against_the_page_url(self):
        parsed = self.parse(self.page("a"), dict(self.source, url="https://example.org/agenda/"))
        self.assertEqual(parsed["follow"], [Request("https://example.org/e/a")])

    def test_every_sources_links_pattern_matches_its_event_pages_and_not_its_menus(self):
        with open(os.path.join(helpers.SCRIPTS, "sources.json"), encoding="utf-8") as handle:
            sources = {s["name"]: s for s in json.load(handle)["sources"]}
        examples = {
            "cineteatro": ["/pt/cinema/verity-1908", "/pt/diversos/estamos-de-volta-1421"],
            "portugalrunning-leiria": ["/eventos/crp-resistencia-trail/"],
            "santaremcultura": ["/index.php/programacao/1658-ana-bacalhau"],
            "mcr-caldas": ["/agenda/halloween-rollerdisco"],
            "cm-torresnovas": ["/index.php/comunicacao/agenda/exposicoes/exposicao-lancadeira-coletivo-249"],
            "cm-cartaxo": ["/informacao/agenda/feira-de-todos-os-santos-e-expocartaxo-2026"],
            "leiriagenda": ["/pt/agenda/wonderlandi"],
            "teatro-virginia": ["/index.php/as-aguias-da-republica/547"],
            "cm-tvedras-musica": ["/agenda/detalhes/256171"],
            "teatrocine-tvedras": ["/agenda/256055"],
            "cm-alcobaca": ["/84009/encontro-de-orquestras-31-anos-da-orquestra-ligeira-da-cela"],
            "cineteatro-alcobaca": ["/83938/de-gaulle-resistencia"],
            "ccc-caldas": ["/programacao/cinema/as-meninas-exemplares"],
            "agenda-obidos": ["/evento/feira-anual-de-santa-iria/"],
            "cm-portodemos": ["/pages/1290?event_id=4528"],
            "cm-alcanena": ["/index.php/comunicacao/agenda/exposicoes/colecionadores26"],
            "cm-almeirim": ["/informacoes/eventos/almeirim/feira-do-livro-usado-2026"],
            "cm-entroncamento": ["/index.php/agenda/cinema/heart-of-the-beast-ciclo-de-cinema"],
            "cm-peniche": ["/visitar/agenda-de-eventos/evento-36/burlas-contra-idosos-acoes-de-sensibilizacao-2026"],
            "cm-vnbarquinha": ["/index.php/viver/agenda/eventos-literarios/clube-de-leitura"],
        }
        menus = ["/", "/agenda", "/agenda/", "/index.php/agenda", "/pt/agenda", "/pt/agenda/a-decorrer",
                 "/programacao", "/index.php/programacao", "/index.php/programacao/calendario-de-eventos",
                 "/index.php/comunicacao/agenda", "/index.php/comunicacao/agenda/cinema", "/informacao/agenda",
                 "/index.php/tags/cinema/30", "/index.php/agenda/cinema", "/menu/1342/programacao",
                 "/agenda/categoria/37", "/pages/1336", "/pages/364", "/eventos/", "/visitar/agenda-de-eventos",
                 "/visitar/agenda-de-eventos/ambiente-saude-e-bem-estar", "/informacoes/eventos",
                 "/index.php/viver/agenda", "/index.php/agenda/entroncamento/view-map?tmpl=component"]
        for name, paths in examples.items():
            pattern = re.compile(sources[name]["links"])
            for path in paths:
                self.assertTrue(pattern.search(path), (name, path))
            for path in menus:
                self.assertFalse(pattern.search(path), (name, path))
        self.assertEqual(sorted(n for n, s in sources.items() if "links" in s),
                         sorted(list(examples) + ["portugalrunning-santarem", "portugalrunning-lisboa"]))


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
