// Port of tests/python/test_check_candidates.py.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, problemsIn } from "../src/check_candidates.ts";
import { capture } from "./capture.ts";

const STAMP = "2026-10-20T08:00:00+01:00";
const WINDOW = ["2026-10-20", "2026-12-01"] as const;

function event(extra: Record<string, unknown> = {}): Record<string, any> {
  return {
    title_pt: "Concerto", title_en: "Concert", category: "music", kind: "single",
    start_date: "2026-10-25", end_date: null, start_time: null, dates: null,
    recurrence: null, date_tbc: false, venue: null, town: "Rio Maior",
    drive_min: 0, price: null, kids: false, description_en: null,
    sources: [{ name: "A", url: "https://example.org/a" }], confidence: "high", caveat: null,
    ...extra,
  };
}

function good(): Record<string, any> {
  return { collected_at: STAMP, group: "g", events: [event()], hints: [], coverage: "ok" };
}

describe("Check", () => {
  const problems = (data: unknown) => problemsIn(data, "g", STAMP, WINDOW);

  test("test_good", () => {
    expect(problems(good())).toEqual([]);
  });

  test("test_wrong_group_stamp_and_missing_key", () => {
    const d = good();
    d.group = "x";
    d.collected_at = "other";
    expect(problems(d).length).toBe(2);
    delete d.hints;
    expect(problems(d)).toEqual(["missing hints"]);
  });

  test("test_bad_event_and_hint", () => {
    const d = good();
    d.events[0].category = "bogus";
    d.hints = [event({ start_date: "2027-05-01" })];
    const found = problems(d);
    expect(found.some((p) => p.startsWith("events[0]") && p.includes("category"))).toBe(true);
    expect(found.some((p) => p.startsWith("hints[0]"))).toBe(true);
  });

  test("test_cli_exit_codes", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cc-"));
    try {
      const index = join(tmp, "index.json");
      writeFileSync(index, JSON.stringify({ collected_at: STAMP, window: { start: "2026-10-20", end: "2026-12-01" } }));
      const path = join(tmp, "g.json");
      writeFileSync(path, JSON.stringify(good()));
      expect(capture(() => main([path, "--index", index, "--group", "g"])).result).toBe(0);
      writeFileSync(path, "garbage");
      const bad = capture(() => main([path, "--index", index, "--group", "g"]));
      expect(bad.result).toBe(2);
      expect(bad.stdout).toContain("cannot read");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
