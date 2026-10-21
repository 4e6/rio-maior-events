import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultEnd, localIsoNow, lisbonToday, lisbonTime, parseIsoDate, parseIsoDatetime, parseRfc822 } from "../src/py/datetime";

const vectors = JSON.parse(readFileSync(join(import.meta.dir, "vectors", "py-datetime.json"), "utf8"));
const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

// tests/python/test_adapter_riomaior_calendar.py
describe("lisbon_time", () => {
  test("test_lisbon_time_switches_on_the_last_sundays", () => {
    const cases: [number[], string][] = [
      [[2026, 10, 24, 20, 30], "2026-10-24T21:30+01:00"],
      [[2026, 10, 25, 0, 59], "2026-10-25T01:59+01:00"],
      [[2026, 10, 25, 1, 0], "2026-10-25T01:00+00:00"],
      [[2026, 10, 29, 21, 30], "2026-10-29T21:30+00:00"],
      [[2026, 3, 29, 0, 59], "2026-03-29T00:59+00:00"],
      [[2026, 3, 29, 1, 0], "2026-03-29T02:00+01:00"],
      [[2026, 12, 31, 23, 30], "2026-12-31T23:30+00:00"],
    ];
    for (const [p, expected] of cases) {
      expect(lisbonTime(utc(p[0]!, p[1]!, p[2]!, p[3], p[4])).isoMinutes).toBe(expected);
    }
  });

  test("vectors from Python 3.14: DST edges 2025-2030", () => {
    expect(vectors.lisbon.length).toBeGreaterThan(60);
    for (const v of vectors.lisbon) {
      const l = lisbonTime(v.ms);
      expect([l.isoMinutes, l.date, l.time, l.hour, l.minute]).toEqual([v.iso, v.date, v.time, v.hour, v.minute]);
    }
  });
});

// tests/python/test_runner.py
describe("default window", () => {
  test("test_default_end_is_the_first_sunday_at_least_28_days_on", () => {
    const cases: [string, string][] = [
      ["2026-10-19", "2026-11-22"],
      ["2026-10-20", "2026-11-22"],
      ["2026-10-24", "2026-11-22"],
      ["2026-10-25", "2026-11-22"],
      ["2026-10-26", "2026-11-29"],
      ["2026-12-28", "2027-01-31"],
    ];
    for (const [start, end] of cases) {
      const e = defaultEnd(start);
      expect(e).toBe(end);
      expect(new Date(`${e}T00:00:00Z`).getUTCDay()).toBe(0);
      const days = (Date.parse(`${e}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(28);
      expect(days).toBeLessThan(35);
    }
  });

  test("test_today_is_lisbon_today", () => {
    expect(lisbonToday(new Date(utc(2026, 3, 28, 23, 30)))).toBe("2026-03-28");
    expect(lisbonToday(new Date(utc(2026, 7, 1, 23, 30)))).toBe("2026-07-02");
    expect(lisbonToday(new Date(utc(2026, 12, 1, 23, 30)))).toBe("2026-12-01");
  });

  test("vectors from Python 3.14: default_end over 800 days and lisbon_today at DST edges", () => {
    for (const v of vectors.end) expect(defaultEnd(v.in)).toBe(v.out);
    for (const v of vectors.today) expect(lisbonToday(new Date(v.ms))).toBe(v.out);
  });
});

describe("fromisoformat", () => {
  test("datetime vectors from Python 3.14", () => {
    for (const v of vectors.datetime) expect([v.in, parseIsoDatetime(v.in)]).toEqual([v.in, v.out]);
  });
  test("date vectors from Python 3.14", () => {
    for (const v of vectors.date) expect([v.in, parseIsoDate(v.in)]).toEqual([v.in, v.out]);
  });
  test("an offset and Z give the same instant", () => {
    expect(parseIsoDatetime("2026-10-24T22:00:00+01:00")).toEqual({ ms: utc(2026, 10, 24, 21), aware: true });
    expect(parseIsoDatetime("2026-10-24T21:00:00Z")).toEqual({ ms: utc(2026, 10, 24, 21), aware: true });
    expect(parseIsoDatetime("2026-10-24T21:00:00")).toEqual({ ms: utc(2026, 10, 24, 21), aware: false });
  });
});

describe("parsedate_to_datetime", () => {
  test("pubDate vectors from Python 3.14", () => {
    for (const v of vectors.rfc) expect([v.in, parseRfc822(v.in)]).toEqual([v.in, v.out]);
  });
  test("-0000 and a missing zone are not aware", () => {
    expect(parseRfc822("Sat, 24 Oct 2026 21:00:00 -0000")?.aware).toBe(false);
    expect(parseRfc822("Sat, 24 Oct 2026 21:00:00")?.aware).toBe(false);
    expect(parseRfc822("Sat, 24 Oct 2026 21:00:00 +0100")).toEqual({ ms: utc(2026, 10, 24, 20), aware: true });
  });
});

describe("local ISO now", () => {
  test("seconds precision with the machine's offset", () => {
    const now = new Date(utc(2026, 10, 21, 12, 34) + 5678);
    const s = localIsoNow(now);
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(Date.parse(s)).toBe(Math.floor(now.getTime() / 1000) * 1000);
  });
  test("offset format for Lisbon summer and winter", () => {
    const old = process.env.TZ;
    try {
      process.env.TZ = "Europe/Lisbon";
      expect(localIsoNow(new Date(utc(2026, 7, 1, 11, 0)))).toBe("2026-07-01T12:00:00+01:00");
      expect(localIsoNow(new Date(utc(2026, 12, 1, 11, 0)))).toBe("2026-12-01T11:00:00+00:00");
      process.env.TZ = "America/St_Johns";
      expect(localIsoNow(new Date(utc(2026, 12, 1, 11, 0)))).toBe("2026-12-01T07:30:00-03:30");
    } finally {
      if (old === undefined) delete process.env.TZ; else process.env.TZ = old;
    }
  });
});
