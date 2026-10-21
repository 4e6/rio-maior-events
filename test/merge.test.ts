// Port of tests/python/test_merge.py.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as merge from "../src/merge.ts";
import * as render from "../src/render.ts";
import { capture } from "./capture.ts";

// generated_at is written in the machine's zone; pin it so NOW reads as +01:00.
process.env.TZ = "Etc/GMT-1";

type Doc = Record<string, any>;

const STAMP = "2026-10-20T08:00:00+01:00";
const NOW = new Date(Date.UTC(2026, 9, 20, 8, 30, 15, 0));

function event(title: string, start: string, town = "Rio Maior", extra: Doc = {}): Doc {
  return {
    title_pt: title, title_en: title, category: "music", kind: "single",
    start_date: start, end_date: null, start_time: null, dates: null,
    recurrence: null, date_tbc: false, venue: null, town,
    drive_min: 0, price: null, kids: false, description_en: null,
    sources: [{ name: "A", url: "https://example.org/a" }],
    confidence: "high", caveat: null,
    ...extra,
  };
}

const write = (path: string, data: unknown) => writeFileSync(path, JSON.stringify(data), "utf8");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const tail = (out: string) => out.split("possible duplicates:")[1]!;

let tmp: string, col: string, cand: string, out: string;

function candFile(group: string, events: Doc[], extra: Doc = {}) {
  write(join(cand, group + ".json"), { collected_at: STAMP, group, events, hints: [], coverage: group + " ok", ...extra });
}

function runMerge(extra: string[] = []): [number, string] {
  const r = capture(() => merge.main([col, cand, out, ...extra], NOW));
  return [r.result, r.stdout];
}
const runOk = () => runMerge(["--missing-ok"]);
const output = (): Doc => readJson(out);

function setUpCase() {
  tmp = mkdtempSync(join(tmpdir(), "merge-"));
  col = join(tmp, "collected");
  cand = join(tmp, "cand");
  out = join(tmp, "events.json");
  mkdirSync(col);
  mkdirSync(cand);
  write(join(col, "index.json"), {
    collected_at: STAMP,
    window: { start: "2026-10-20", end: "2026-11-30" },
    groups: { g1: { file: "g1.json", sources: ["s1", "s2"] }, g2: { file: "g2.json", sources: ["s3"] } },
    sources: [
      { name: "s1", group: "g1", url: "https://example.org/1", ok: true, error: null },
      { name: "s2", group: "g1", url: "https://example.org/2", ok: false, error: "HTTP 403" },
      { name: "s3", group: "g2", url: "https://example.org/3", ok: true, error: null },
    ],
  });
  candFile("g1", [event("Concerto de Outono", "2026-10-25")]);
  candFile("g2", [event("Feira do Livro", "2026-11-02", "Caldas da Rainha")]);
}
const tearDownCase = () => rmSync(tmp, { recursive: true, force: true });

describe("HappyPath", () => {
  beforeEach(setUpCase);
  afterEach(tearDownCase);

  test("test_writes_a_file_render_accepts", () => {
    expect(runMerge()[0]).toBe(0);
    const doc = output();
    expect(doc.generated_at).toBe("2026-10-20T09:30:15+01:00");
    expect(doc.origin).toBe("Rio Maior");
    expect("note" in doc).toBe(false);
    expect(doc.window).toEqual({ start: "2026-10-20", end: "2026-11-30" });
    expect(doc.events.map((e: Doc) => e.title_pt)).toEqual(["Concerto de Outono", "Feira do Livro"]);
    expect(doc.sources_checked).toEqual([
      { name: "s1", url: "https://example.org/1", ok: true },
      { name: "s2", url: "https://example.org/2", ok: false, error: "HTTP 403" },
      { name: "s3", url: "https://example.org/3", ok: true },
    ]);
    expect(render.check(doc)).toEqual([]);
  });

  test("test_deterministic", () => {
    runMerge();
    const first = readFileSync(out, "utf8");
    runMerge();
    expect(readFileSync(out, "utf8")).toBe(first);
  });
});

describe("Failures", () => {
  beforeEach(setUpCase);
  afterEach(tearDownCase);

  test("test_missing_group", () => {
    unlinkSync(join(cand, "g2.json"));
    const [code, o] = runMerge();
    expect(code).toBe(2);
    expect(o).toContain("g2");
    expect(o).not.toContain("g1");
    expect(existsSync(out)).toBe(false);
  });

  test("test_stale_group", () => {
    candFile("g1", [], { collected_at: "2026-10-19T08:00:00+01:00" });
    const [code, o] = runMerge();
    expect(code).toBe(2);
    expect(o).toContain("group g1: stale");
    expect(existsSync(out)).toBe(false);
  });

  test("test_wrong_group_name_inside", () => {
    write(join(cand, "g1.json"), { collected_at: STAMP, group: "g2", events: [] });
    expect(runMerge()[0]).toBe(2);
  });

  test("test_no_index", () => {
    unlinkSync(join(col, "index.json"));
    expect(runMerge()[0]).toBe(2);
  });

  test("test_manual_for_unknown_source", () => {
    write(join(cand, "manual.json"), { collected_at: STAMP, events: [], sources: [{ name: "nope", ok: true }] });
    const [code, o] = runMerge();
    expect(code).toBe(2);
    expect(o).toContain("nope");
  });

  test("test_stale_manual", () => {
    write(join(cand, "manual.json"), { collected_at: "2026-10-19T00:00:00+01:00", events: [], sources: [] });
    const [code, o] = runMerge();
    expect(code).toBe(2);
    expect(o).toContain("delete");
    expect(o).toContain("manual.json");
  });
});

describe("Manual", () => {
  beforeEach(setUpCase);
  afterEach(tearDownCase);

  test("test_events_and_overrides", () => {
    write(join(cand, "manual.json"), {
      collected_at: STAMP,
      events: [event("Mercado Manual", "2026-11-07")],
      sources: [{ name: "s2", ok: true, error: "ignored" }, { name: "s3", ok: false, error: "read by hand, empty" }],
    });
    expect(runMerge()[0]).toBe(0);
    const doc = output();
    expect(doc.events[doc.events.length - 1].title_pt).toBe("Mercado Manual");
    const byName = Object.fromEntries(doc.sources_checked.map((s: Doc) => [s.name, s]));
    expect(byName.s2).toEqual({ name: "s2", url: "https://example.org/2", ok: true });
    expect(byName.s3.error).toBe("read by hand, empty");
    expect(render.check(doc)).toEqual([]);
  });
});

describe("Duplicates", () => {
  beforeEach(setUpCase);
  afterEach(tearDownCase);

  function pairs(events: Doc[]): string {
    candFile("g1", events);
    candFile("g2", []);
    return tail(runMerge()[1]);
  }

  test("test_true_pair_across_groups_and_accents", () => {
    candFile("g1", [event("Concerto de Natal da Banda", "2026-11-20")]);
    candFile("g2", [event("CONCERTO NATAL — Banda Filarmónica", "2026-11-21", "rio maior")]);
    const t = tail(runMerge()[1]);
    expect(t).toContain("events[0]");
    expect(t).toContain("events[1]");
    expect(t).toContain("Concerto de Natal da Banda");
    expect(t).toContain("2026-11-21");
    expect(output().events.length).toBe(2);
  });

  test("test_lookalike_letters_do_not_hide_a_pair", () => {
    candFile("g1", [event("Ana Bacalhau", "2026-11-20")]);
    // Cyrillic "а" in the title and a Cyrillic "о" in the town
    candFile("g2", [event("Ana Bacalhau".replaceAll("a", "а"), "2026-11-20", "Rio Maiоr")]);
    const t = tail(runMerge()[1]);
    expect(t).toContain("events[0]");
    expect(t).toContain("events[1]");
  });

  test("test_normalise_folds_cyrillic_greek_and_compatibility_forms", () => {
    expect(merge.normalise("Аnа Bаcаlhаu")).toBe("ana bacalhau");
    expect(merge.normalise("οαε")).toBe("oae");
    expect(merge.normalise("Ａna")).toBe("ana");
  });

  test("test_near_misses", () => {
    const t = pairs([
      event("Grande Concerto Natal", "2026-11-20"),
      event("Grande Concerto Natal", "2026-11-23"), // too far apart
      event("Grande Concerto Natal", "2026-11-20", "Caldas"), // other town
      event("Feira de Artesanato", "2026-11-20"), // other title
      event("Grande Jazz Festival", "2026-11-20"), // 1 of 3 words shared
    ]);
    expect(t.trim()).toBe("");
  });

  test("test_month_only_event_does_not_crash", () => {
    const t = pairs([
      event("Tasquinhas", "2026-11", "Rio Maior", { date_tbc: true, confidence: "low", caveat: "yearly" }),
      event("Tasquinhas", "2026-11-10"),
    ]);
    expect(t.trim()).toBe("");
  });
});

describe("RangesAndTowns", () => {
  beforeEach(setUpCase);
  afterEach(tearDownCase);

  test("test_a_range_that_holds_the_other_day_is_a_pair", () => {
    // the Nazaré half-marathon: a reader's range in one group, a single day in another
    candFile("g1", [event("MEIA MARATONA", "2026-11-11", "Nazaré", { kind: "multi_day", end_date: "2026-11-15" })]);
    candFile("g2", [event("50ª Meia Maratona Internacional da Nazaré 2026", "2026-11-15", "Nazaré")]);
    const t = tail(runMerge()[1]);
    expect(t).toContain("events[0]");
    expect(t).toContain("events[1]");
  });

  test("test_ranges_a_day_apart_pair_and_further_apart_do_not", () => {
    candFile("g1", [event("Feira Grande", "2026-11-01", "Rio Maior", { end_date: "2026-11-03", kind: "multi_day" }),
      event("Feira Grande", "2026-11-04"),
      event("Feira Grande", "2026-11-06", "Caldas da Rainha")]);
    candFile("g2", [event("Feira Grande", "2026-11-05", "Caldas da Rainha")]);
    const t = tail(runMerge()[1]);
    expect(t).toContain("events[0]"); // 1-3 Nov and 4 Nov
    expect(t).toContain("events[3]"); // 6 Nov and 5 Nov, Caldas
    expect(t.split("<->").length - 1).toBe(2);
  });

  test("test_a_parenthetical_town_matches_its_municipality", () => {
    candFile("g1", [event("Festa do Vinho", "2026-11-07", "Cambelas (Torres Vedras)")]);
    candFile("g2", [event("Festa do Vinho", "2026-11-07", "Torres Vedras")]);
    expect(tail(runMerge()[1])).toContain("<->");
  });

  test("test_two_different_parentheticals_are_not_a_match", () => {
    candFile("g1", [event("Festa do Vinho", "2026-11-07", "Cambelas (Torres Vedras)")]);
    candFile("g2", [event("Festa do Vinho", "2026-11-07", "Alcanede (Santarém)")]);
    expect(runMerge()[1]).not.toContain("<->");
  });
});

describe("Problems", () => {
  beforeEach(setUpCase);
  afterEach(tearDownCase);

  const block = (o: string) => o.split("problems:")[1]!.split("possible duplicates:")[0]!;

  test("test_render_problems_are_printed_with_their_group_and_exit_is_zero", () => {
    candFile("g2", [event("Sem fim", "2026-10-25", "Rio Maior", { kind: "ongoing" })]);
    const [code, o] = runMerge();
    expect(code).toBe(0);
    const b = block(o);
    expect(b).toContain("needs an end_date");
    expect(b).toContain("[group g2]");
    expect(b).not.toContain("[group g1]");
  });

  test("test_no_problems_leaves_the_block_empty", () => {
    expect(block(runMerge()[1]).trim()).toBe("");
  });

  test("test_a_manual_event_is_tagged_manual", () => {
    write(join(cand, "manual.json"),
      { collected_at: STAMP, events: [event("Sem fim", "2026-10-25", "Rio Maior", { kind: "ongoing" })], sources: [] });
    expect(runMerge()[1]).toContain("[group manual]");
  });

  test("test_a_hint_that_is_not_an_object_is_refused", () => {
    candFile("g1", [], { hints: ["Frimor"] });
    const [code, o] = runMerge();
    expect(code).toBe(2);
    expect(o).toContain("group g1: hints");
  });
});

describe("Report", () => {
  beforeEach(setUpCase);
  afterEach(tearDownCase);

  test("test_hints_and_coverage_printed", () => {
    const hint = event("Frimor", "2026-11", "Rio Maior", { date_tbc: true, confidence: "low", caveat: "Seen 2025-09 in past" });
    candFile("g1", [], { hints: [hint], coverage: "s2 failed; reaches 2026-11-15" });
    const [code, o] = runMerge();
    expect(code).toBe(0);
    expect(o).toContain("hints:\n  [g1] Frimor | 2026-11 | Rio Maior | Seen 2025-09 in past");
    expect(o).toContain("coverage:\n  g1: s2 failed; reaches 2026-11-15\n  g2: g2 ok");
    expect(output().events[0].title_pt).toBe("Feira do Livro");
  });
});

describe("MissingOk", () => {
  beforeEach(setUpCase);
  afterEach(tearDownCase);

  test("test_a_missing_group_is_skipped_and_its_sources_marked", () => {
    unlinkSync(join(cand, "g1.json"));
    const [code, o] = runOk();
    expect(code).toBe(0);
    expect(o).toContain("missing group: g1 (missing (");
    expect(o).not.toContain("missing group: g2");
    const doc = output();
    expect(doc.events.map((e: Doc) => e.title_pt)).toEqual(["Feira do Livro"]);
    expect(doc.sources_checked).toEqual([
      { name: "s1", url: "https://example.org/1", ok: false, error: "not read" },
      // s2 had failed with its own error: it keeps it
      { name: "s2", url: "https://example.org/2", ok: false, error: "HTTP 403" },
      { name: "s3", url: "https://example.org/3", ok: true },
    ]);
    expect(render.check(doc)).toEqual([]);
  });

  test("test_an_unparsable_file_is_skipped", () => {
    writeFileSync(join(cand, "g2.json"), "{not json");
    const [code, o] = runOk();
    expect(code).toBe(0);
    expect(o).toContain("missing group: g2");
    expect(output().sources_checked[2].error).toBe("not read");
  });

  test("test_a_stale_file_is_skipped", () => {
    candFile("g2", [event("Old", "2026-11-02")], { collected_at: "2026-10-19T08:00:00+01:00" });
    const [code, o] = runOk();
    expect(code).toBe(0);
    expect(o).toContain("missing group: g2");
    expect(output().events.map((e: Doc) => e.title_pt)).toEqual(["Concerto de Outono"]);
  });

  test("test_the_reason_is_printed", () => {
    candFile("g1", [], { collected_at: "2026-10-19T08:00:00+01:00" });
    write(join(cand, "g2.json"), { collected_at: STAMP, group: "other", events: [] });
    const [, o] = runOk();
    expect(o).toContain("missing group: g1 (stale, its collected_at is 2026-10-19");
    expect(o).toContain("missing group: g2 (the file says group other)");
  });

  test("test_bad_hints_skip_the_group_only_under_the_flag", () => {
    for (const bad of ["none", ["Frimor"]]) {
      candFile("g1", [event("X", "2026-10-26")], { hints: bad });
      const [code, o] = runOk();
      expect(code).toBe(0);
      expect(o).toContain("missing group: g1 (hints must be a list of events)");
      expect(output().events.map((e: Doc) => e.title_pt)).toEqual(["Feira do Livro"]);
    }
  });

  test("test_no_readable_group_exits_2_and_writes_nothing", () => {
    for (const g of ["g1", "g2"]) unlinkSync(join(cand, g + ".json"));
    const [code, o] = runOk();
    expect(code).toBe(2);
    expect(o).toContain("every group is missing");
    expect(o).toContain("missing group: g1");
    expect(existsSync(out)).toBe(false);
  });

  test("test_without_the_flag_it_still_exits_2", () => {
    unlinkSync(join(cand, "g2.json"));
    const [code, o] = runMerge();
    expect(code).toBe(2);
    expect(o).not.toContain("missing group:");
    expect(existsSync(out)).toBe(false);
  });

  test("test_nothing_missing_prints_no_line_and_changes_nothing", () => {
    const [code, o] = runOk();
    expect(code).toBe(0);
    expect(o).not.toContain("missing group");
    expect(output().sources_checked[0]).toEqual({ name: "s1", url: "https://example.org/1", ok: true });
  });

  test("test_a_broken_index_still_exits_2", () => {
    unlinkSync(join(col, "index.json"));
    expect(runOk()[0]).toBe(2);
  });
});

describe("Finalize", () => {
  let path: string;
  let result: Doc;
  let stdout: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "final-")); path = join(tmp, "events.json"); });
  afterEach(tearDownCase);

  const doc = (events: unknown[], extra: Doc = {}): Doc => ({
    generated_at: "2026-10-20T09:30:15+01:00",
    window: { start: "2026-10-20", end: "2026-11-30" },
    origin: "Rio Maior",
    sources_checked: [
      { name: "s1", url: "https://example.org/1", ok: false, error: "not read" },
      { name: "s2", url: "https://example.org/2", ok: false, error: "HTTP 403" },
      { name: "s3", url: "https://example.org/3", ok: true },
    ],
    events,
    ...extra,
  });

  function runFinal(d: unknown): number {
    write(path, d);
    const r = capture(() => merge.main(["--finalize", path]));
    result = readJson(path);
    stdout = r.stdout;
    return r.result;
  }

  const src = (name: string, url = "https://example.org/x") => [{ name, url }];

  test("test_a_clean_file_only_gains_a_note", () => {
    const events = [event("Concerto", "2026-10-25"), event("Feira", "2026-11-02")];
    expect(runFinal(doc(events))).toBe(0);
    expect(result.events).toEqual(events);
    expect(render.check(result)).toEqual([]);
    expect(stdout).toContain("finalized");
  });

  test("test_rejected_events_are_dropped_and_named", () => {
    const bad: unknown[] = [event("Fora", "2027-03-01"), event("Sem data", "soon"), event("Boa", "2026-10-25")];
    bad.push("not an object");
    expect(runFinal(doc(bad, { note: "Thin coverage." }))).toBe(0);
    expect(result.events.map((e: Doc) => e.title_pt)).toEqual(["Boa"]);
    const note: string = result.note;
    expect(note.startsWith("Thin coverage. ")).toBe(true);
    expect(note).toContain("Fora (2027-03-01)");
    expect(note).toContain("Sem data (soon)");
    expect(note).toContain("untitled (None)");
    expect(render.check(result)).toEqual([]);
  });

  test("test_a_tbc_event_is_kept_unless_render_rejects_it", () => {
    const ok = event("Frimor", "2026-11", "Rio Maior", { date_tbc: true, confidence: "low", caveat: "check" });
    const bad = event("Frimor 2", "2027-05", "Rio Maior", { date_tbc: true, confidence: "low", caveat: "check" });
    expect(runFinal(doc([ok, bad]))).toBe(0);
    expect(result.events.map((e: Doc) => e.title_pt)).toEqual(["Frimor"]);
    expect(result.note).toContain("Frimor 2 (2027-05)");
  });

  test("test_same_id_collapses_and_sources_combine", () => {
    const a = event("Feira", "2026-11-02", "Rio Maior", { sources: src("A", "https://a") });
    const b = event("FEIRA", "2026-11-02", "Rio Maior", { sources: [...src("B", "https://b"), ...src("A", "https://a")] });
    const other = event("Outra", "2026-11-03");
    expect(runFinal(doc([a, other, b]))).toBe(0);
    expect(result.events.map((e: Doc) => e.title_pt)).toEqual(["Feira", "Outra"]);
    expect(result.events[0].sources).toEqual([...src("A", "https://a"), ...src("B", "https://b")]);
    expect(render.check(result)).toEqual([]);
  });

  test("test_a_stated_time_beats_none", () => {
    const a = event("Feira", "2026-11-02", "Rio Maior", { sources: src("Município de Rio Maior") });
    const b = event("Feira", "2026-11-02", "Rio Maior", { start_time: "21:00", sources: src("B") });
    runFinal(doc([a, b]));
    expect(result.events.length).toBe(1);
    const e = result.events[0];
    expect(e.start_time).toBe("21:00");
    expect(e.sources.map((s: Doc) => s.name)).toEqual(["B", "Município de Rio Maior"]);
  });

  test("test_a_single_day_beats_a_range", () => {
    const a = event("Feira", "2026-11-02", "Rio Maior", { kind: "multi_day", end_date: "2026-11-04", sources: src("cm-x") });
    const b = event("Feira", "2026-11-02", "Rio Maior", { sources: src("B") });
    runFinal(doc([a, b]));
    const e = result.events[0];
    expect(e.end_date).toBeNull();
    expect(e.kind).toBe("single");
  });

  test("test_time_outranks_single_day_outranks_municipal", () => {
    const timedRange = event("Feira", "2026-11-02", "Rio Maior", {
      kind: "multi_day", end_date: "2026-11-04", start_time: "10:00", sources: src("B"),
    });
    const single = event("Feira", "2026-11-02", "Rio Maior", { sources: src("B") });
    runFinal(doc([single, timedRange]));
    expect(result.events[0].start_time).toBe("10:00");
  });

  test("test_municipal_or_venue_source_breaks_the_tie", () => {
    const cases: [string, string | null][] = [["cm-peniche", null], ["Município de Peniche", null], ["Câmara Municipal", null],
      ["Cineteatro de Rio Maior", "Cineteatro de Rio Maior"]];
    for (const [name, venue] of cases) {
      const plain = event("Feira", "2026-11-02", "Rio Maior", { venue, description_en: "plain", sources: src("Eventbrite") });
      const official = event("Feira", "2026-11-02", "Rio Maior", { venue, description_en: "official", sources: src(name) });
      runFinal(doc([plain, official]));
      expect(result.events[0].description_en).toBe("official");
    }
    // neither municipal: the first one stays
    const a = event("Feira", "2026-11-02", "Rio Maior", { description_en: "first", sources: src("Eventbrite") });
    const b = event("Feira", "2026-11-02", "Rio Maior", { description_en: "second", sources: src("Facebook") });
    runFinal(doc([a, b]));
    expect(result.events[0].description_en).toBe("first");
  });

  test("test_the_winner_is_chosen_from_each_events_own_sources", () => {
    const a = event("Feira", "2026-11-02", "Rio Maior", { start_time: "21:00", sources: src("Blog") });
    const b = event("Feira", "2026-11-02", "Rio Maior", { sources: src("Município de Rio Maior") });
    const c = event("Feira", "2026-11-02", "Rio Maior", {
      start_time: "21:00", venue: "Pavilhão", price: { free: true, text: "Free" }, sources: src("Município de Rio Maior", "https://c"),
    });
    for (const order of [[a, b, c], [c, b, a], [b, a, c], [a, c]]) {
      runFinal(doc(order));
      expect(result.events.length).toBe(1);
      const e = result.events[0];
      expect(e.venue).toBe("Pavilhão");
      expect(e.start_time).toBe("21:00");
    }
  });

  test("test_null_fields_are_filled_from_the_others_in_preference_order", () => {
    const blog = event("Feira", "2026-11-02", "Rio Maior", { start_time: "21:00", sources: src("Blog") });
    const town = event("Feira", "2026-11-02", "Rio Maior", { venue: "Pavilhão", description_en: "Official", drive_min: 0, sources: src("cm-x") });
    const other = event("Feira", "2026-11-02", "Rio Maior", {
      venue: "Other", description_en: "Other", drive_min: 9, price: { free: false, text: "5 EUR" }, sources: src("Eventbrite"),
    });
    runFinal(doc([other, blog, town]));
    const e = result.events[0];
    expect([e.start_time, e.venue, e.description_en, e.drive_min]).toEqual(["21:00", "Pavilhão", "Official", 0]);
    expect(e.price).toEqual({ free: false, text: "5 EUR" });
    expect(render.check(result)).toEqual([]);
  });

  test("test_a_town_name_is_not_a_venue_source", () => {
    const venue = "Casa da Cultura de Óbidos";
    const a = event("Feira", "2026-11-02", "Rio Maior", { venue, description_en: "first", sources: src("Óbidos") });
    const b = event("Feira", "2026-11-02", "Rio Maior", { venue, description_en: "second", sources: src("Casa da Cultura de Óbidos — agenda") });
    runFinal(doc([a, b]));
    expect(result.events[0].description_en).toBe("second");
    const c = event("Feira", "2026-11-03", "Rio Maior", { venue, description_en: "first", sources: src("Casa") });
    const d = event("Feira", "2026-11-03", "Rio Maior", { venue, description_en: "second", sources: src("Óbidos") });
    runFinal(doc([c, d]));
    expect(result.events[0].description_en).toBe("first");
  });

  test("test_note_is_written_from_unread_sources", () => {
    for (const note of [null, "", "  "]) {
      runFinal(doc([event("A", "2026-10-25")], { note }));
      expect(result.note).toContain("Not read: s1.");
      expect(result.note).not.toContain("s2"); // failed with its own error, not a missing group
      expect(result.note).toContain("without a final edit");
      expect(render.check(result)).toEqual([]);
    }
  });

  test("test_note_without_missing_groups_is_generic", () => {
    const d = doc([event("A", "2026-10-25")]);
    d.sources_checked = d.sources_checked.slice(2);
    runFinal(d);
    expect(result.note).not.toContain("Not read");
    expect(result.note).toContain("without a final edit");
  });

  test("test_an_existing_note_is_kept_and_not_extended_when_nothing_dropped", () => {
    runFinal(doc([event("A", "2026-10-25")], { note: "Only the Cineteatro was thin." }));
    expect(result.note).toBe("Only the Cineteatro was thin.");
  });

  test("test_idempotent", () => {
    runFinal(doc([event("Fora", "2027-03-01"), event("A", "2026-10-25")]));
    const first = result;
    runFinal(first);
    expect(result).toEqual(first);
  });

  test("test_the_result_passes_render_on_merges_raw_output_with_duplicates_and_junk", () => {
    const events = [event("A", "2026-10-25"), event("A", "2026-10-25", "Rio Maior", { start_time: "20:00" }),
      event("Junk", "2026-02-30"), event("B", "2026-11-01", "Rio Maior", { category: "nonsense" })];
    expect(runFinal(doc(events))).toBe(0);
    expect(render.check(result)).toEqual([]);
    expect(result.events.length).toBe(1);
  });

  test("test_unusable_files_exit_2_and_stay_as_they_were", () => {
    writeFileSync(path, "{nope");
    expect(capture(() => merge.main(["--finalize", path])).result).toBe(2);
    expect(readFileSync(path, "utf8")).toBe("{nope");
    expect(runFinal({ events: "x" })).toBe(2);
    const broken = doc([event("A", "2026-10-25")], { window: { start: "x", end: "y" } });
    expect(runFinal(broken)).toBe(2);
    expect(stdout).toContain("window");
    expect(result).toEqual(broken);
  });

  test("test_finalize_takes_no_folders", () => {
    // argparse raised SystemExit; the port returns exit code 2 with the error on stderr
    const r = capture(() => merge.main(["--finalize", path, "a", "b", "c"]));
    expect(r.result).toBe(2);
    expect(r.stderr).toContain("--finalize takes no folders");
  });
});
