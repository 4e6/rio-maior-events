"""Tests for the rio-maior-events merge script, offline, on small fixtures built here.

    python3 -m unittest discover -s evals/rio-maior-events -p 'test_merge.py'

The script joins the readers' candidate files into one events file. These tests
build a collected folder and candidate files in a temporary directory, then
check the happy path (and that render.py accepts the result), a missing group,
a stale one, manual overrides, duplicate detection and the printed hints and
coverage.

The tests live here, outside the skill, because anything inside a skill's folder
ships with it.
"""

import contextlib
import datetime
import importlib.util
import io
import json
import os
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.join(HERE, "..", "..")


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(SKILL, "scripts", name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


merge = load("merge")
render = load("render")

STAMP = "2026-10-20T08:00:00+01:00"
NOW = datetime.datetime(2026, 10, 20, 9, 30, 15, 123, tzinfo=datetime.timezone(datetime.timedelta(hours=1)))


def event(title, start, town="Rio Maior", **extra):
    e = {
        "title_pt": title, "title_en": title, "category": "music", "kind": "single",
        "start_date": start, "end_date": None, "start_time": None, "dates": None,
        "recurrence": None, "date_tbc": False, "venue": None, "town": town,
        "drive_min": 0, "price": None, "kids": False, "description_en": None,
        "sources": [{"name": "A", "url": "https://example.org/a"}],
        "confidence": "high", "caveat": None,
    }
    e.update(extra)
    return e


def write(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)


class Case(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.col = os.path.join(self.tmp.name, "collected")
        self.cand = os.path.join(self.tmp.name, "cand")
        self.out = os.path.join(self.tmp.name, "events.json")
        os.makedirs(self.col)
        os.makedirs(self.cand)
        write(os.path.join(self.col, "index.json"), {
            "collected_at": STAMP,
            "window": {"start": "2026-10-20", "end": "2026-11-30"},
            "groups": {"g1": {"file": "g1.json", "sources": ["s1", "s2"]},
                       "g2": {"file": "g2.json", "sources": ["s3"]}},
            "sources": [
                {"name": "s1", "group": "g1", "url": "https://example.org/1", "ok": True, "error": None},
                {"name": "s2", "group": "g1", "url": "https://example.org/2", "ok": False, "error": "HTTP 403"},
                {"name": "s3", "group": "g2", "url": "https://example.org/3", "ok": True, "error": None},
            ],
        })
        self.cand_file("g1", [event("Concerto de Outono", "2026-10-25")])
        self.cand_file("g2", [event("Feira do Livro", "2026-11-02", "Caldas da Rainha")])

    def cand_file(self, group, events, **extra):
        data = {"collected_at": STAMP, "group": group, "events": events, "hints": [], "coverage": group + " ok"}
        data.update(extra)
        write(os.path.join(self.cand, group + ".json"), data)

    def run_merge(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = merge.main([self.col, self.cand, self.out], now=NOW)
        return code, buf.getvalue()

    def output(self):
        with open(self.out, encoding="utf-8") as f:
            return json.load(f)


class HappyPath(Case):
    def test_writes_a_file_render_accepts(self):
        code, _ = self.run_merge()
        self.assertEqual(code, 0)
        doc = self.output()
        self.assertEqual(doc["generated_at"], "2026-10-20T09:30:15+01:00")
        self.assertEqual(doc["origin"], "Rio Maior")
        self.assertNotIn("note", doc)
        self.assertEqual(doc["window"], {"start": "2026-10-20", "end": "2026-11-30"})
        self.assertEqual([e["title_pt"] for e in doc["events"]], ["Concerto de Outono", "Feira do Livro"])
        self.assertEqual(doc["sources_checked"], [
            {"name": "s1", "url": "https://example.org/1", "ok": True},
            {"name": "s2", "url": "https://example.org/2", "ok": False, "error": "HTTP 403"},
            {"name": "s3", "url": "https://example.org/3", "ok": True},
        ])
        self.assertEqual(render.check(doc), [])

    def test_deterministic(self):
        self.run_merge()
        with open(self.out, encoding="utf-8") as f:
            first = f.read()
        self.run_merge()
        with open(self.out, encoding="utf-8") as f:
            self.assertEqual(first, f.read())


class Failures(Case):
    def test_missing_group(self):
        os.remove(os.path.join(self.cand, "g2.json"))
        code, out = self.run_merge()
        self.assertEqual(code, 2)
        self.assertIn("g2", out)
        self.assertNotIn("g1", out)
        self.assertFalse(os.path.exists(self.out))

    def test_stale_group(self):
        self.cand_file("g1", [], collected_at="2026-10-19T08:00:00+01:00")
        code, out = self.run_merge()
        self.assertEqual(code, 2)
        self.assertIn("group g1: stale", out)
        self.assertFalse(os.path.exists(self.out))

    def test_wrong_group_name_inside(self):
        write(os.path.join(self.cand, "g1.json"), {"collected_at": STAMP, "group": "g2", "events": []})
        self.assertEqual(self.run_merge()[0], 2)

    def test_no_index(self):
        os.remove(os.path.join(self.col, "index.json"))
        self.assertEqual(self.run_merge()[0], 2)

    def test_manual_for_unknown_source(self):
        write(os.path.join(self.cand, "manual.json"),
              {"collected_at": STAMP, "events": [], "sources": [{"name": "nope", "ok": True}]})
        code, out = self.run_merge()
        self.assertEqual(code, 2)
        self.assertIn("nope", out)

    def test_stale_manual(self):
        write(os.path.join(self.cand, "manual.json"),
              {"collected_at": "2026-10-19T00:00:00+01:00", "events": [], "sources": []})
        code, out = self.run_merge()
        self.assertEqual(code, 2)
        self.assertIn("delete", out)
        self.assertIn("manual.json", out)


class Manual(Case):
    def test_events_and_overrides(self):
        write(os.path.join(self.cand, "manual.json"), {
            "collected_at": STAMP,
            "events": [event("Mercado Manual", "2026-11-07")],
            "sources": [{"name": "s2", "ok": True, "error": "ignored"},
                        {"name": "s3", "ok": False, "error": "read by hand, empty"}],
        })
        code, _ = self.run_merge()
        self.assertEqual(code, 0)
        doc = self.output()
        self.assertEqual(doc["events"][-1]["title_pt"], "Mercado Manual")
        by_name = {s["name"]: s for s in doc["sources_checked"]}
        self.assertEqual(by_name["s2"], {"name": "s2", "url": "https://example.org/2", "ok": True})
        self.assertEqual(by_name["s3"]["error"], "read by hand, empty")
        self.assertEqual(render.check(doc), [])


class Duplicates(Case):
    def pairs(self, events):
        self.cand_file("g1", events)
        self.cand_file("g2", [])
        _, out = self.run_merge()
        return out.split("possible duplicates:")[1]

    def test_true_pair_across_groups_and_accents(self):
        self.cand_file("g1", [event("Concerto de Natal da Banda", "2026-11-20")])
        self.cand_file("g2", [event("CONCERTO NATAL — Banda Filarmónica", "2026-11-21", "rio maior")])
        _, out = self.run_merge()
        tail = out.split("possible duplicates:")[1]
        self.assertIn("events[0]", tail)
        self.assertIn("events[1]", tail)
        self.assertIn("Concerto de Natal da Banda", tail)
        self.assertIn("2026-11-21", tail)
        self.assertEqual(len(self.output()["events"]), 2)

    def test_lookalike_letters_do_not_hide_a_pair(self):
        self.cand_file("g1", [event("Ana Bacalhau", "2026-11-20")])
        # Cyrillic "а" in the title and a Cyrillic "о" in the town
        self.cand_file("g2", [event("Ana Bacalhau".replace("a", "\u0430"), "2026-11-20", "Rio Mai\u043er")])
        tail = self.pairs_after_merge()
        self.assertIn("events[0]", tail)
        self.assertIn("events[1]", tail)

    def pairs_after_merge(self):
        _, out = self.run_merge()
        return out.split("possible duplicates:")[1]

    def test_normalise_folds_cyrillic_greek_and_compatibility_forms(self):
        self.assertEqual(merge.normalise("\u0410n\u0430 B\u0430c\u0430lh\u0430u"), "ana bacalhau")
        self.assertEqual(merge.normalise("\u03bf\u03b1\u03b5"), "oae")
        self.assertEqual(merge.normalise("\uff21na"), "ana")

    def test_near_misses(self):
        tail = self.pairs([
            event("Grande Concerto Natal", "2026-11-20"),
            event("Grande Concerto Natal", "2026-11-23"),            # too far apart
            event("Grande Concerto Natal", "2026-11-20", "Caldas"),   # other town
            event("Feira de Artesanato", "2026-11-20"),           # other title
            event("Grande Jazz Festival", "2026-11-20"), # 1 of 3 words shared
        ])
        self.assertEqual(tail.strip(), "")

    def test_month_only_event_does_not_crash(self):
        tail = self.pairs([
            event("Tasquinhas", "2026-11", date_tbc=True, confidence="low", caveat="yearly"),
            event("Tasquinhas", "2026-11-10"),
        ])
        self.assertEqual(tail.strip(), "")


class RangesAndTowns(Case):
    def test_a_range_that_holds_the_other_day_is_a_pair(self):
        # the Nazaré half-marathon: a reader's range in one group, a single day in another
        self.cand_file("g1", [event("MEIA MARATONA", "2026-11-11", "Nazaré", kind="multi_day",
                                    end_date="2026-11-15")])
        self.cand_file("g2", [event("50ª Meia Maratona Internacional da Nazaré 2026", "2026-11-15", "Nazaré")])
        tail = self.run_merge()[1].split("possible duplicates:")[1]
        self.assertIn("events[0]", tail)
        self.assertIn("events[1]", tail)

    def test_ranges_a_day_apart_pair_and_further_apart_do_not(self):
        self.cand_file("g1", [event("Feira Grande", "2026-11-01", end_date="2026-11-03", kind="multi_day"),
                              event("Feira Grande", "2026-11-04"),
                              event("Feira Grande", "2026-11-06", "Caldas da Rainha")])
        self.cand_file("g2", [event("Feira Grande", "2026-11-05", "Caldas da Rainha")])
        tail = self.run_merge()[1].split("possible duplicates:")[1]
        self.assertIn("events[0]", tail)   # 1-3 Nov and 4 Nov
        self.assertIn("events[3]", tail)   # 6 Nov and 5 Nov, Caldas
        self.assertEqual(tail.count("<->"), 2)

    def test_a_parenthetical_town_matches_its_municipality(self):
        self.cand_file("g1", [event("Festa do Vinho", "2026-11-07", "Cambelas (Torres Vedras)")])
        self.cand_file("g2", [event("Festa do Vinho", "2026-11-07", "Torres Vedras")])
        self.assertIn("<->", self.run_merge()[1].split("possible duplicates:")[1])

    def test_two_different_parentheticals_are_not_a_match(self):
        self.cand_file("g1", [event("Festa do Vinho", "2026-11-07", "Cambelas (Torres Vedras)")])
        self.cand_file("g2", [event("Festa do Vinho", "2026-11-07", "Alcanede (Santarém)")])
        self.assertNotIn("<->", self.run_merge()[1])


class Problems(Case):
    def test_render_problems_are_printed_with_their_group_and_exit_is_zero(self):
        bad = event("Sem fim", "2026-10-25", kind="ongoing")
        self.cand_file("g2", [bad])
        code, out = self.run_merge()
        self.assertEqual(code, 0)
        block = out.split("problems:")[1].split("possible duplicates:")[0]
        self.assertIn("needs an end_date", block)
        self.assertIn("[group g2]", block)
        self.assertNotIn("[group g1]", block)

    def test_no_problems_leaves_the_block_empty(self):
        block = self.run_merge()[1].split("problems:")[1].split("possible duplicates:")[0]
        self.assertEqual(block.strip(), "")

    def test_a_manual_event_is_tagged_manual(self):
        write(os.path.join(self.cand, "manual.json"),
              {"collected_at": STAMP, "events": [event("Sem fim", "2026-10-25", kind="ongoing")], "sources": []})
        self.assertIn("[group manual]", self.run_merge()[1])

    def test_a_hint_that_is_not_an_object_is_refused(self):
        self.cand_file("g1", [], hints=["Frimor"])
        code, out = self.run_merge()
        self.assertEqual(code, 2)
        self.assertIn("group g1: hints", out)


class Report(Case):
    def test_hints_and_coverage_printed(self):
        hint = event("Frimor", "2026-11", date_tbc=True, confidence="low", caveat="Seen 2025-09 in past")
        self.cand_file("g1", [], hints=[hint], coverage="s2 failed; reaches 2026-11-15")
        code, out = self.run_merge()
        self.assertEqual(code, 0)
        self.assertIn("hints:\n  [g1] Frimor | 2026-11 | Rio Maior | Seen 2025-09 in past", out)
        self.assertIn("coverage:\n  g1: s2 failed; reaches 2026-11-15\n  g2: g2 ok", out)
        self.assertEqual(self.output()["events"][0]["title_pt"], "Feira do Livro")


class MissingOk(Case):
    def run_ok(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = merge.main([self.col, self.cand, self.out, "--missing-ok"], now=NOW)
        return code, buf.getvalue()

    def test_a_missing_group_is_skipped_and_its_sources_marked(self):
        os.remove(os.path.join(self.cand, "g1.json"))
        code, out = self.run_ok()
        self.assertEqual(code, 0)
        self.assertIn("missing group: g1 (missing (", out)
        self.assertNotIn("missing group: g2", out)
        doc = self.output()
        self.assertEqual([e["title_pt"] for e in doc["events"]], ["Feira do Livro"])
        self.assertEqual(doc["sources_checked"], [
            {"name": "s1", "url": "https://example.org/1", "ok": False, "error": "not read"},
            # s2 had failed with its own error: it keeps it
            {"name": "s2", "url": "https://example.org/2", "ok": False, "error": "HTTP 403"},
            {"name": "s3", "url": "https://example.org/3", "ok": True},
        ])
        self.assertEqual(render.check(doc), [])

    def test_an_unparsable_file_is_skipped(self):
        with open(os.path.join(self.cand, "g2.json"), "w") as f:
            f.write("{not json")
        code, out = self.run_ok()
        self.assertEqual(code, 0)
        self.assertIn("missing group: g2", out)
        self.assertEqual(self.output()["sources_checked"][2]["error"], "not read")

    def test_a_stale_file_is_skipped(self):
        self.cand_file("g2", [event("Old", "2026-11-02")], collected_at="2026-10-19T08:00:00+01:00")
        code, out = self.run_ok()
        self.assertEqual(code, 0)
        self.assertIn("missing group: g2", out)
        self.assertEqual([e["title_pt"] for e in self.output()["events"]], ["Concerto de Outono"])

    def test_the_reason_is_printed(self):
        self.cand_file("g1", [], collected_at="2026-10-19T08:00:00+01:00")
        write(os.path.join(self.cand, "g2.json"), {"collected_at": STAMP, "group": "other", "events": []})
        _, out = self.run_ok()
        self.assertIn("missing group: g1 (stale, its collected_at is 2026-10-19", out)
        self.assertIn("missing group: g2 (the file says group other)", out)

    def test_bad_hints_skip_the_group_only_under_the_flag(self):
        for bad in ("none", ["Frimor"]):
            self.cand_file("g1", [event("X", "2026-10-26")], hints=bad)
            code, out = self.run_ok()
            self.assertEqual(code, 0)
            self.assertIn("missing group: g1 (hints must be a list of events)", out)
            self.assertEqual([e["title_pt"] for e in self.output()["events"]], ["Feira do Livro"])

    def test_no_readable_group_exits_2_and_writes_nothing(self):
        for g in ("g1", "g2"):
            os.remove(os.path.join(self.cand, g + ".json"))
        code, out = self.run_ok()
        self.assertEqual(code, 2)
        self.assertIn("every group is missing", out)
        self.assertIn("missing group: g1", out)
        self.assertFalse(os.path.exists(self.out))

    def test_without_the_flag_it_still_exits_2(self):
        os.remove(os.path.join(self.cand, "g2.json"))
        code, out = self.run_merge()
        self.assertEqual(code, 2)
        self.assertNotIn("missing group:", out)
        self.assertFalse(os.path.exists(self.out))

    def test_nothing_missing_prints_no_line_and_changes_nothing(self):
        code, out = self.run_ok()
        self.assertEqual(code, 0)
        self.assertNotIn("missing group", out)
        self.assertEqual(self.output()["sources_checked"][0], {"name": "s1", "url": "https://example.org/1", "ok": True})

    def test_a_broken_index_still_exits_2(self):
        os.remove(os.path.join(self.col, "index.json"))
        code, _ = self.run_ok()
        self.assertEqual(code, 2)


class Finalize(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "events.json")

    def doc(self, events, **extra):
        d = {
            "generated_at": "2026-10-20T09:30:15+01:00",
            "window": {"start": "2026-10-20", "end": "2026-11-30"},
            "origin": "Rio Maior",
            "sources_checked": [
                {"name": "s1", "url": "https://example.org/1", "ok": False, "error": "not read"},
                {"name": "s2", "url": "https://example.org/2", "ok": False, "error": "HTTP 403"},
                {"name": "s3", "url": "https://example.org/3", "ok": True},
            ],
            "events": events,
        }
        d.update(extra)
        return d

    def run_final(self, doc):
        write(self.path, doc)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = merge.main(["--finalize", self.path])
        with open(self.path, encoding="utf-8") as f:
            self.result = json.load(f)
        self.stdout = buf.getvalue()
        return code

    def src(self, name, url="https://example.org/x"):
        return [{"name": name, "url": url}]

    def test_a_clean_file_only_gains_a_note(self):
        events = [event("Concerto", "2026-10-25"), event("Feira", "2026-11-02")]
        self.assertEqual(self.run_final(self.doc(events)), 0)
        self.assertEqual(self.result["events"], events)
        self.assertEqual(render.check(self.result), [])
        self.assertIn("finalized", self.stdout)

    def test_rejected_events_are_dropped_and_named(self):
        bad = [event("Fora", "2027-03-01"), event("Sem data", "soon"), event("Boa", "2026-10-25")]
        bad.append("not an object")
        self.assertEqual(self.run_final(self.doc(bad, note="Thin coverage.")), 0)
        self.assertEqual([e["title_pt"] for e in self.result["events"]], ["Boa"])
        note = self.result["note"]
        self.assertTrue(note.startswith("Thin coverage. "), note)
        self.assertIn("Fora (2027-03-01)", note)
        self.assertIn("Sem data (soon)", note)
        self.assertIn("untitled (None)", note)
        self.assertEqual(render.check(self.result), [])

    def test_a_tbc_event_is_kept_unless_render_rejects_it(self):
        ok = event("Frimor", "2026-11", date_tbc=True, confidence="low", caveat="check")
        bad = event("Frimor 2", "2027-05", date_tbc=True, confidence="low", caveat="check")
        self.assertEqual(self.run_final(self.doc([ok, bad])), 0)
        self.assertEqual([e["title_pt"] for e in self.result["events"]], ["Frimor"])
        self.assertIn("Frimor 2 (2027-05)", self.result["note"])

    def test_same_id_collapses_and_sources_combine(self):
        a = event("Feira", "2026-11-02", sources=self.src("A", "https://a"))
        b = event("FEIRA", "2026-11-02", sources=self.src("B", "https://b") + self.src("A", "https://a"))
        other = event("Outra", "2026-11-03")
        self.assertEqual(self.run_final(self.doc([a, other, b])), 0)
        self.assertEqual([e["title_pt"] for e in self.result["events"]], ["Feira", "Outra"])
        self.assertEqual(self.result["events"][0]["sources"], self.src("A", "https://a") + self.src("B", "https://b"))
        self.assertEqual(render.check(self.result), [])

    def test_a_stated_time_beats_none(self):
        a = event("Feira", "2026-11-02", sources=self.src("Município de Rio Maior"))
        b = event("Feira", "2026-11-02", start_time="21:00", sources=self.src("B"))
        self.run_final(self.doc([a, b]))
        [e] = self.result["events"]
        self.assertEqual(e["start_time"], "21:00")
        self.assertEqual([s["name"] for s in e["sources"]], ["B", "Município de Rio Maior"])

    def test_a_single_day_beats_a_range(self):
        a = event("Feira", "2026-11-02", kind="multi_day", end_date="2026-11-04", sources=self.src("cm-x"))
        b = event("Feira", "2026-11-02", sources=self.src("B"))
        self.run_final(self.doc([a, b]))
        [e] = self.result["events"]
        self.assertIsNone(e["end_date"])
        self.assertEqual(e["kind"], "single")

    def test_time_outranks_single_day_outranks_municipal(self):
        timed_range = event("Feira", "2026-11-02", kind="multi_day", end_date="2026-11-04",
                            start_time="10:00", sources=self.src("B"))
        single = event("Feira", "2026-11-02", sources=self.src("B"))
        self.run_final(self.doc([single, timed_range]))
        self.assertEqual(self.result["events"][0]["start_time"], "10:00")

    def test_municipal_or_venue_source_breaks_the_tie(self):
        for name, venue in (("cm-peniche", None), ("Município de Peniche", None), ("Câmara Municipal", None),
                            ("Cineteatro de Rio Maior", "Cineteatro de Rio Maior")):
            plain = event("Feira", "2026-11-02", venue=venue, description_en="plain", sources=self.src("Eventbrite"))
            official = event("Feira", "2026-11-02", venue=venue, description_en="official", sources=self.src(name))
            self.run_final(self.doc([plain, official]))
            self.assertEqual(self.result["events"][0]["description_en"], "official", name)
        # neither municipal: the first one stays
        a = event("Feira", "2026-11-02", description_en="first", sources=self.src("Eventbrite"))
        b = event("Feira", "2026-11-02", description_en="second", sources=self.src("Facebook"))
        self.run_final(self.doc([a, b]))
        self.assertEqual(self.result["events"][0]["description_en"], "first")

    def test_the_winner_is_chosen_from_each_events_own_sources(self):
        a = event("Feira", "2026-11-02", start_time="21:00", sources=self.src("Blog"))
        b = event("Feira", "2026-11-02", sources=self.src("Município de Rio Maior"))
        c = event("Feira", "2026-11-02", start_time="21:00", venue="Pavilhão", price={"free": True, "text": "Free"},
                  sources=self.src("Município de Rio Maior", "https://c"))
        for order in ([a, b, c], [c, b, a], [b, a, c], [a, c]):
            self.run_final(self.doc(order))
            [e] = self.result["events"]
            self.assertEqual(e["venue"], "Pavilhão", [x["sources"][0]["name"] for x in order])
            self.assertEqual(e["start_time"], "21:00")

    def test_null_fields_are_filled_from_the_others_in_preference_order(self):
        blog = event("Feira", "2026-11-02", start_time="21:00", sources=self.src("Blog"))
        town = event("Feira", "2026-11-02", venue="Pavilhão", description_en="Official", drive_min=0,
                     sources=self.src("cm-x"))
        other = event("Feira", "2026-11-02", venue="Other", description_en="Other", drive_min=9,
                      price={"free": False, "text": "5 EUR"}, sources=self.src("Eventbrite"))
        self.run_final(self.doc([other, blog, town]))
        [e] = self.result["events"]
        self.assertEqual((e["start_time"], e["venue"], e["description_en"], e["drive_min"]),
                         ("21:00", "Pavilhão", "Official", 0))
        self.assertEqual(e["price"], {"free": False, "text": "5 EUR"})
        self.assertEqual(render.check(self.result), [])

    def test_a_town_name_is_not_a_venue_source(self):
        a = event("Feira", "2026-11-02", venue="Casa da Cultura de Óbidos", description_en="first",
                  sources=self.src("Óbidos"))
        b = event("Feira", "2026-11-02", venue="Casa da Cultura de Óbidos", description_en="second",
                  sources=self.src("Casa da Cultura de Óbidos — agenda"))
        self.run_final(self.doc([a, b]))
        self.assertEqual(self.result["events"][0]["description_en"], "second")
        c = event("Feira", "2026-11-03", venue="Casa da Cultura de Óbidos", description_en="first", sources=self.src("Casa"))
        d = event("Feira", "2026-11-03", venue="Casa da Cultura de Óbidos", description_en="second", sources=self.src("Óbidos"))
        self.run_final(self.doc([c, d]))
        self.assertEqual(self.result["events"][0]["description_en"], "first")

    def test_note_is_written_from_unread_sources(self):
        for note in (None, "", "  "):
            self.run_final(self.doc([event("A", "2026-10-25")], note=note))
            self.assertIn("Not read: s1.", self.result["note"])
            self.assertNotIn("s2", self.result["note"])  # failed with its own error, not a missing group
            self.assertIn("without a final edit", self.result["note"])
            self.assertEqual(render.check(self.result), [])

    def test_note_without_missing_groups_is_generic(self):
        d = self.doc([event("A", "2026-10-25")])
        d["sources_checked"] = d["sources_checked"][2:]
        self.run_final(d)
        self.assertNotIn("Not read", self.result["note"])
        self.assertIn("without a final edit", self.result["note"])

    def test_an_existing_note_is_kept_and_not_extended_when_nothing_dropped(self):
        self.run_final(self.doc([event("A", "2026-10-25")], note="Only the Cineteatro was thin."))
        self.assertEqual(self.result["note"], "Only the Cineteatro was thin.")

    def test_idempotent(self):
        self.run_final(self.doc([event("Fora", "2027-03-01"), event("A", "2026-10-25")]))
        first = self.result
        self.run_final(first)
        self.assertEqual(self.result, first)

    def test_the_result_passes_render_on_merges_raw_output_with_duplicates_and_junk(self):
        events = [event("A", "2026-10-25"), event("A", "2026-10-25", start_time="20:00"),
                  event("Junk", "2026-02-30"), event("B", "2026-11-01", category="nonsense")]
        self.assertEqual(self.run_final(self.doc(events)), 0)
        self.assertEqual(render.check(self.result), [])
        self.assertEqual(len(self.result["events"]), 1)

    def test_unusable_files_exit_2_and_stay_as_they_were(self):
        with open(self.path, "w") as f:
            f.write("{nope")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(merge.main(["--finalize", self.path]), 2)
        with open(self.path) as f:
            self.assertEqual(f.read(), "{nope")
        self.assertEqual(self.run_final({"events": "x"}), 2)
        broken = self.doc([event("A", "2026-10-25")], window={"start": "x", "end": "y"})
        self.assertEqual(self.run_final(broken), 2)
        self.assertIn("window", self.stdout)
        self.assertEqual(self.result, broken)

    def test_finalize_takes_no_folders(self):
        with self.assertRaises(SystemExit):
            with contextlib.redirect_stderr(io.StringIO()):
                merge.main(["--finalize", self.path, "a", "b", "c"])


if __name__ == "__main__":
    unittest.main()
