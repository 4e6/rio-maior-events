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
SKILL = os.path.join(HERE, "..", "..", "skills", "rio-maior-events")


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


if __name__ == "__main__":
    unittest.main()
