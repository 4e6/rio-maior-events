"""Offline tests for the Next.js adapter."""

import unittest

from helpers import WINDOW, fixture
from adapters import nextjs
from adapters.common import EXCERPT_CAP, Page, Request

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

    def test_follow_is_the_in_window_links_in_date_order(self):
        follow = parse(page())["follow"]
        self.assertEqual([r.url for r in follow], [
            "https://www.example.pt/agenda/feira", "https://www.example.pt/agenda/concerto--primavera"])
        self.assertEqual(follow[0], Request("https://www.example.pt/agenda/feira"))


def event(name="nextjs_event.html"):
    return Page("https://www.example.pt/agenda/e", 200, fixture(name), None)


def with_schedule(value):
    text = fixture("nextjs_event.html").decode("utf-8").replace(
        '\\"schedule\\":\\"15 horas\\"', '\\"schedule\\":\\"%s\\"' % value)
    return Page("u", 200, text.encode("utf-8"), None)


class EventPages(unittest.TestCase):
    def test_a_single_clock_time_in_the_schedule_sets_the_start(self):
        self.assertEqual(nextjs.details(SOURCE, [event()], WINDOW)[0]["start"], "2026-10-25 15:00")
        for value in ("15h", "15h30", "21:30", "\u00e0s 10h00", "15 horas", "9h"):
            got = nextjs.details(SOURCE, [with_schedule(value)], WINDOW)[0]
            self.assertEqual(got["start"], "2026-10-25 " + nextjs.clocks(value)[0], value)
            self.assertTrue(got["excerpt"].startswith("Hor\u00e1rio: %s\n" % value))
        self.assertEqual(nextjs.clocks("15h30"), ["15:30"])
        self.assertEqual(nextjs.clocks("9h"), ["09:00"])

    def test_a_bare_duration_is_not_a_time_of_day(self):
        for value in ("2h", "1 hora", "2 horas", "3h a 5h"):
            self.assertEqual(nextjs.clocks(value), [], value)
        self.assertEqual(nextjs.clocks("\u00e0s 2h"), ["02:00"])
        self.assertEqual(nextjs.clocks("a partir das 21 horas"), ["21:00"])
        self.assertEqual(nextjs.clocks("2h30"), ["02:30"])
        self.assertEqual(nextjs.clocks("das 10h \u00e0s 18h"), ["10:00", "18:00"])

    def test_a_run_of_days_keeps_dates_and_the_schedule_in_the_excerpt(self):
        text = fixture("nextjs_event.html").decode("utf-8").replace(
            '\\"endDate\\":\\"2026-10-24T23:00', '\\"endDate\\":\\"2026-11-05T00:00')
        got = nextjs.details(SOURCE, [Page("u", 200, text.encode("utf-8"), None)], WINDOW)[0]
        self.assertEqual((got["start"], got["end"]), ("2026-10-25", "2026-11-05"))
        self.assertTrue(got["excerpt"].startswith("Hor\u00e1rio: 15 horas\n"))

    def test_a_range_sets_start_and_end(self):
        got = nextjs.details(SOURCE, [with_schedule("10h \u00e0s 18h")], WINDOW)[0]
        self.assertEqual((got["start"], got["end"]), ("2026-10-25 10:00", "2026-10-25 18:00"))

    def test_a_vague_schedule_leaves_the_date_and_is_still_shown(self):
        for value in ("Todo o dia", "Manh\u00e3 e tarde", "25h", "10h e 15h", "15h30 hor\u00e1rio a confirmar"):
            got = nextjs.details(SOURCE, [with_schedule(value)], WINDOW)[0]
            self.assertEqual((got["start"], got["end"]), ("2026-10-25", None), value)
            self.assertTrue(got["excerpt"].startswith("Hor\u00e1rio: %s\n" % value))

    def test_details_read_the_payload_split_over_chunks(self):
        found = nextjs.details(SOURCE, [event()], WINDOW)
        self.assertEqual(len(found), 1)
        detail = found[0]
        self.assertEqual(detail["url"], "https://www.example.pt/agenda/e")
        self.assertEqual(detail["title"], 'Encontro "Bandas" \u00e0 tarde')
        self.assertEqual(detail["excerpt"],
                         "Hor\u00e1rio: 15 horas\nA partir das 15 horas, na sede da Sociedade Filarm\u00f3nica.\n"
                         "A entrada \u00e9 gratuita.")
        self.assertIsNone(detail["venue"])

    def test_utc_midnight_in_summer_time_is_the_next_local_day(self):
        detail = nextjs.details(SOURCE, [with_schedule("")], WINDOW)[0]
        self.assertEqual(detail["start"], "2026-10-25")
        self.assertNotIn("Hor\u00e1rio", detail["excerpt"])
        self.assertIsNone(detail["end"])

    def test_local_time_is_kept_and_the_clock_follows_the_season(self):
        self.assertEqual(nextjs.local_stamp("2026-07-10T18:30:00+00:00"), "2026-07-10 19:30")
        self.assertEqual(nextjs.local_stamp("2026-12-10T18:30:00+00:00"), "2026-12-10 18:30")
        self.assertIsNone(nextjs.local_stamp(None))

    def test_end_after_start_is_kept(self):
        text = fixture("nextjs_event.html").decode("utf-8").replace(
            '\\"endDate\\":\\"2026-10-24T23:00', '\\"endDate\\":\\"2026-10-25T16:00')
        body = Page("u", 200, text.encode("utf-8"), None)
        self.assertEqual(nextjs.details(SOURCE, [body], WINDOW)[0]["end"], "2026-10-25 16:00")

    def test_a_streamed_description_is_read_from_its_text_row(self):
        text = fixture("nextjs_event.html").decode("utf-8")
        text = text.replace("<p>A partir das 15 horas, na sede da Sociedade Filarm", "$21")
        text = text.replace("\\u00f3nica.</p>\\\\n<p>A entrada \\u00e9 gratuita.</p>", "")
        body = "çã <p>Às 21h, no <b>Teatro</b>.</p>"
        row = "21:T%x,%s" % (len(body.encode("utf-8")), body)
        text = text.replace("</body>", '<script>self.__next_f.push([1,"\\n%s\\n22:[]"])</script></body>' % row)
        found = nextjs.details(SOURCE, [Page("u", 200, text.encode("utf-8"), None)], WINDOW)[0]
        self.assertEqual(found["excerpt"], "Horário: 15 horas\nçã\nÀs 21h, no Teatro.")

    def test_long_description_is_capped(self):
        self.assertLessEqual(len(nextjs.excerpt_of("<p>" + "palavra " * 300 + "</p>")), EXCERPT_CAP)

    def test_a_page_without_payload_is_read_as_any_page(self):
        html = b"<html><head><title>Um Concerto Especial</title></head><body><p>Texto do evento.</p></body></html>"
        found = nextjs.details(SOURCE, [Page("https://www.example.pt/x", 200, html, None)], WINDOW)
        self.assertEqual(found[0]["title"], "Um Concerto Especial")
        self.assertIn("Texto do evento.", found[0]["excerpt"])

    def test_a_payload_without_a_description_module_falls_back(self):
        html = fixture("nextjs.html")
        found = nextjs.details(SOURCE, [Page("https://www.example.pt/x", 200, html, None)], WINDOW)
        self.assertEqual(len(found), 1)
        self.assertIn("Agenda", found[0]["excerpt"])


if __name__ == "__main__":
    unittest.main()
