"""Offline tests for common.extract_detail and the XML guards, on small pages
modelled on real event pages (atc_* elements, JSON-LD, inline iCal, og:title)."""

import unittest
import urllib.parse

import helpers  # noqa: F401  (puts the scripts folder on the path)
from adapters import common
from adapters.common import AdapterError, Page, default_details, extract_detail, xml_root

URL = "https://www.example.pt/agenda/evento/fado"


def page(head="", body="", url=URL):
    html = "<!doctype html><html><head><title>Fado</title>%s</head><body>%s</body></html>" % (head, body)
    return Page(url, 200, html.encode("utf-8"), "text/html; charset=utf-8")


def og(title):
    return '<meta property="og:title" content="%s" />' % title


def atc(start, end="", location="", title="Fado"):
    return ('<var class="atc_event rs_skip"><var class="atc_date_start">%s</var>'
            '<var class="atc_date_end">%s</var><var class="atc_timezone">Europe/Lisbon</var>'
            '<var class="atc_title">%s</var><var class="atc_location">%s</var></var>'
            % (start, end, title, location))


def ical(text):
    encoded = urllib.parse.quote(text.replace("\n", "\r\n"), safe="")
    return '<a href="data:text/calendar;charset=utf8,%s">Apple / ICS</a>' % encoded


class Title(unittest.TestCase):
    def test_og_title_is_the_title_unescaped_and_trimmed(self):
        self.assertEqual(extract_detail(page(og("Cave &amp; Co.  "))).get("title"), "Cave & Co.")

    def test_the_title_tag_is_the_fallback_without_its_site_suffix(self):
        found = extract_detail(Page(URL, 200, "<title>Ana Bacalhau | Santarém</title>".encode("utf-8"), None))
        self.assertEqual(found["title"], "Ana Bacalhau")

    def test_a_bare_category_word_is_no_title(self):
        for word in ("CONCERTO ", "Cinema", "teatro", "Dança", "EXPOSIÇÃO", "Música", "Evento"):
            self.assertIsNone(extract_detail(page(og(word)))["title"], word)

    def test_a_title_that_only_starts_with_a_category_word_is_kept(self):
        self.assertEqual(extract_detail(page(og("Concerto de Natal")))["title"], "Concerto de Natal")

    def test_the_url_is_the_pages_final_url(self):
        self.assertEqual(extract_detail(page(url="https://www.example.pt/final"))["url"], "https://www.example.pt/final")


class Dates(unittest.TestCase):
    def test_atc_elements_give_start_end_and_venue(self):
        found = extract_detail(page(body=atc("2026-10-30 18:00:00", "2026-10-30 23:00:00", "Biblioteca Municipal")))
        self.assertEqual((found["start"], found["end"], found["venue"]),
                         ("2026-10-30 18:00", "2026-10-30 23:00", "Biblioteca Municipal"))

    def test_atc_classes_on_spans_work_too(self):
        body = '<span class="atc_date_start">2026-11-02 21:30:00</span><span class="atc_location">Cine</span>'
        found = extract_detail(page(body=body))
        self.assertEqual((found["start"], found["end"], found["venue"]), ("2026-11-02 21:30", None, "Cine"))

    def test_an_end_equal_to_the_start_is_no_end(self):
        found = extract_detail(page(body=atc("2026-10-31 21:00:00", "2026-10-31 21:00:00")))
        self.assertEqual((found["start"], found["end"]), ("2026-10-31 21:00", None))

    def test_midnight_is_a_date_without_a_time(self):
        found = extract_detail(page(body=atc("2026-11-28 00:00:00", "2026-11-28 00:00:00")))
        self.assertEqual((found["start"], found["end"]), ("2026-11-28", None))
        found = extract_detail(page(body=atc("2026-11-28 00:00", "2026-11-29 00:00")))
        self.assertEqual((found["start"], found["end"]), ("2026-11-28", "2026-11-29"))

    def test_a_placeholder_venue_is_none(self):
        for venue in ("Evento", "evento", ""):
            self.assertIsNone(extract_detail(page(body=atc("2026-10-18 17:00:00", location=venue)))["venue"], venue)

    def test_json_ld_event_comes_first(self):
        ld = ('<script type="application/ld+json">{"@context":"https://schema.org","@graph":['
              '{"@type":"BreadcrumbList","itemListElement":[]},'
              '{"@type":"SportsEvent","name":"20 Kms","startDate":"2026-10-25",'
              '"location":{"@type":"Place","name":"Avenida 25 de Abril, Almeirim"}}]}</script>')
        found = extract_detail(page(head=ld, body=atc("2026-01-01 10:00:00")))
        self.assertEqual((found["start"], found["end"], found["venue"]),
                         ("2026-10-25", None, "Avenida 25 de Abril, Almeirim"))

    def test_json_ld_without_a_start_is_passed_over(self):
        ld = '<script type="application/ld+json">{"@type":"Event","name":"x"}</script>'
        found = extract_detail(page(head=ld, body=atc("2026-10-18 17:00:00")))
        self.assertEqual(found["start"], "2026-10-18 17:00")

    def test_a_json_ld_time_with_an_offset_keeps_its_own_clock(self):
        ld = '<script type="application/ld+json">{"@type":"MusicEvent","startDate":"2026-11-07T21:30:00+00:00"}</script>'
        self.assertEqual(extract_detail(page(head=ld))["start"], "2026-11-07 21:30")

    def test_the_venue_may_come_from_a_later_source(self):
        ld = '<script type="application/ld+json">{"@type":"Event","startDate":"2026-10-25"}</script>'
        found = extract_detail(page(head=ld, body=atc("2026-10-25 10:00:00", location="Pavilhao")))
        self.assertEqual((found["start"], found["venue"]), ("2026-10-25", "Pavilhao"))

    def test_nothing_structured_gives_no_dates(self):
        found = extract_detail(page(og("Fado"), "<p>Sab 24 out</p>"))
        self.assertEqual((found["start"], found["end"], found["venue"]), (None, None, None))


class Ical(unittest.TestCase):
    def test_a_percent_encoded_ical_in_utc_is_read_in_lisbon_time(self):
        winter = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261110T210000Z\nDTEND:20261110T223000Z\nLOCATION:Sala B\nEND:VEVENT\nEND:VCALENDAR"
        found = extract_detail(page(body=ical(winter)))
        self.assertEqual((found["start"], found["end"], found["venue"]), ("2026-11-10 21:00", "2026-11-10 22:30", "Sala B"))
        summer = winter.replace("20261110", "20260810")
        self.assertEqual(extract_detail(page(body=ical(summer)))["start"], "2026-08-10 22:00")

    def test_utc_late_in_the_day_moves_to_the_next_lisbon_day(self):
        text = "BEGIN:VEVENT\nDTSTART:20260810T233000Z\nEND:VEVENT"
        self.assertEqual(extract_detail(page(body=ical(text)))["start"], "2026-08-11 00:30")

    def test_the_day_of_the_clock_change_is_read_by_the_rule(self):
        # 01:00 UTC on the last Sunday of October is the change back to UTC+0.
        for stamp, shown in (("20261025T003000Z", "2026-10-25 01:30"), ("20261025T013000Z", "2026-10-25 01:30")):
            text = "BEGIN:VEVENT\nDTSTART:%s\nEND:VEVENT" % stamp
            self.assertEqual(extract_detail(page(body=ical(text)))["start"], shown, stamp)

    def test_a_local_ical_time_with_entities_is_kept_as_is(self):
        raw = "BEGIN:VCALENDAR%0AVERSION:2.0%0ABEGIN:VEVENT%0ADTSTART:20261024T223000%0ADTEND:20261024T223000%0ASUMMARY:WonderLandi%0ADESCRIPTION:propõe &otilde; e&aacute;%0ALOCATION:Teatro José Lúcio da Silva%0AEND:VEVENT"
        found = extract_detail(page(body='<a href="data:text/calendar;charset=utf8,%s">ics</a>' % raw))
        self.assertEqual((found["start"], found["end"], found["venue"]),
                         ("2026-10-24 22:30", None, "Teatro José Lúcio da Silva"))

    def test_an_empty_location_and_a_date_value_are_handled(self):
        text = "BEGIN:VEVENT\nDTSTART;VALUE=DATE:20261124\nLOCATION:\nEND:VEVENT"
        found = extract_detail(page(body=ical(text)))
        self.assertEqual((found["start"], found["end"], found["venue"]), ("2026-11-24", None, None))

    def test_escaped_commas_in_the_location_are_unescaped(self):
        text = "BEGIN:VEVENT\nDTSTART:20261124T200000\nLOCATION:Rua A\\, 5\\, Lisboa\nEND:VEVENT"
        self.assertEqual(extract_detail(page(body=ical(text)))["venue"], "Rua A, 5, Lisboa")

    def test_an_ical_without_a_readable_start_is_passed_over(self):
        text = "BEGIN:VEVENT\nDTSTART:soon\nEND:VEVENT"
        self.assertEqual(extract_detail(page(body=ical(text) + atc("2026-10-18 17:00:00")))["start"], "2026-10-18 17:00")


class Excerpt(unittest.TestCase):
    def body(self, title="Fado"):
        return ("<nav><a href='/'>Menu</a></nav><ul><li>Inicio</li><li>Agenda</li></ul>"
                "<main><h1>%s</h1><p>Sab 24 out, 21h30</p><p>%s</p></main><footer>Rodape</footer>"
                % (title, "A noite canta. " * 100))

    def test_it_starts_at_the_first_mention_of_the_title_after_the_title_line(self):
        found = extract_detail(page(og("Fado"), self.body()))
        self.assertTrue(found["excerpt"].startswith("Fado\nSab 24 out, 21h30\nA noite canta."))
        self.assertNotIn("Inicio", found["excerpt"])
        self.assertNotIn("Fado\nFado", found["excerpt"])

    def test_it_is_about_800_characters_cut_between_words(self):
        excerpt = extract_detail(page(og("Fado"), self.body()))["excerpt"]
        self.assertTrue(700 < len(excerpt) <= common.EXCERPT_CAP)
        self.assertIn(excerpt.split()[-1], ("A", "noite", "canta."))

    def test_matching_is_case_sensitive_and_falls_back_to_the_text_after_the_title_line(self):
        found = extract_detail(page(og("FADO"), "<p>Inicio</p>" + self.body()))
        self.assertTrue(found["excerpt"].startswith("Inicio"))

    def test_the_part_of_the_title_before_a_separator_is_tried(self):
        found = extract_detail(page(og("Fado - Teatro Municipal"), "<p>Inicio</p>" + self.body()))
        self.assertTrue(found["excerpt"].startswith("Fado\nSab"))
        found = extract_detail(page(og("Fado | Agenda ‹ Cidade"), "<p>Inicio</p>" + self.body()))
        self.assertTrue(found["excerpt"].startswith("Fado\nSab"))

    def test_a_short_page_gives_all_its_text(self):
        found = extract_detail(page(og("Fado"), "<main><h1>Fado</h1><p>So isto.</p></main>"))
        self.assertEqual(found["excerpt"], "Fado\nSo isto.")

    def test_a_page_with_no_text_has_no_excerpt(self):
        found = extract_detail(Page(URL, 200, b"<html><head></head><body></body></html>", None))
        self.assertIsNone(found["excerpt"])


class Details(unittest.TestCase):
    def test_default_details_reads_every_page_and_skips_the_unreadable(self):
        class Broken:
            url = "u"
            content_type = None
            body = None
        found = default_details({}, [page(og("Um")), Broken(), page(og("Dois"))], None)
        self.assertEqual([d["title"] for d in found], ["Um", "Dois"])

    def test_the_keys_are_the_documented_ones(self):
        self.assertEqual(sorted(extract_detail(page())),
                         ["end", "excerpt", "start", "title", "url", "venue"])


class XmlGuards(unittest.TestCase):
    def test_a_safe_feed_is_parsed(self):
        self.assertEqual(xml_root(b"<rss><channel/></rss>").tag, "rss")

    def test_utf16_doctype_entity_and_bad_xml_are_refused(self):
        for body, message in (
                ("<rss/>".encode("utf-16"), "UTF-16"),
                (b"<!DOCTYPE rss [<!ENTITY a 'b'>]><rss/>", "DOCTYPE"),
                (b"<!doctype rss><rss/>", "DOCTYPE"),
                (b"<rss><!ENTITY a 'b'></rss>", "DOCTYPE"),
                (b"<rss><channel></rss>", "not valid XML")):
            with self.assertRaises(AdapterError) as caught:
                xml_root(body)
            self.assertIn(message, str(caught.exception))


if __name__ == "__main__":
    unittest.main()
