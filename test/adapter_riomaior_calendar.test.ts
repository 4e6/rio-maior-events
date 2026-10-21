// Port of tests/python/test_adapter_riomaior_calendar.py.
import { describe, expect, test } from "bun:test";
import { WINDOW, fixture } from "./helpers.ts";
import { CM_NOTE, parseItems, riomaior_calendar } from "../src/adapters/riomaior_calendar.ts";
import { lisbonTime } from "../src/adapters/common.ts";
import type { Source, Window } from "../src/adapters/types.ts";

const BASE = "https://www.cm-riomaior.pt";
const SOURCE: Source = { name: "cm", label: "cm", group: "g", url: BASE + "/index.php?option=com_ajax", town: "Rio Maior",
  adapter: "riomaior_calendar", options: { categories: ["116", "121"] } };
const enc = (s: string) => new TextEncoder().encode(s);

const items = (raw: Uint8Array, window: Window = WINDOW) => parseItems(raw, window, BASE);

describe("CmJson", () => {
  test("test_keeps_only_the_window_and_unescapes", () => {
    const got = items(fixture("cm.json"));
    expect(got.map((i) => i.title)).toEqual(["Earlier", 'Concerto "Natal" & Coro']);
    expect(got[1]!.date).toBe("2026-10-24");
    expect(got[1]!.start).toBe("2026-10-24T21:00:00+00:00");
    expect(got[1]!.description).toBe("Entrada livre '");
  });

  test("test_local_time_follows_portuguese_summer_time", () => {
    expect(items(fixture("cm.json"))[1]!.local_start).toBe("2026-10-24T22:00+01:00");
  });

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
      expect(lisbonTime(Date.UTC(p[0]!, p[1]! - 1, p[2]!, p[3]!, p[4]!)).isoMinutes).toBe(expected);
    }
  });

  test("test_date_is_the_local_day", () => {
    const raw = enc('[{"title":"Late","start":"2026-07-10T23:30:00+00:00","url":"","description":""}]');
    expect(items(raw, ["2026-07-11", "2026-07-11"])[0]!.date).toBe("2026-07-11");
  });

  test("test_urls_become_absolute", () => {
    expect(items(fixture("cm.json"))[1]!.url).toBe("https://www.cm-riomaior.pt/informacao/agenda-rio-maior/concerto");
  });

  test("test_window_is_inclusive", () => {
    expect(items(fixture("cm.json"), ["2026-10-24", "2026-10-24"]).length).toBe(1);
  });

  test("test_not_an_array_is_an_error", () => {
    expect(() => items(enc('{"a": 1}'))).toThrow();
  });
});

describe("Adapter", () => {
  test("test_one_post_with_the_categories", () => {
    const [request, ...rest] = riomaior_calendar.requests!(SOURCE, WINDOW);
    expect(rest).toEqual([]);
    expect(request!.url).toBe(SOURCE.url);
    const pairs = [...new URLSearchParams(new TextDecoder("ascii").decode(request!.data!))];
    expect(pairs).toEqual([["catid[]", "116"], ["catid[]", "121"], ["description_length", "100"],
      ["show_child_category_articles", "0"], ["moduleId", "223"]]);
  });

  test("test_parse_carries_the_note_and_no_text", () => {
    const parsed = riomaior_calendar.parse(SOURCE, [{ url: SOURCE.url, status: 200, body: fixture("cm.json"), contentType: null }], WINDOW);
    expect(parsed.items.length).toBe(2);
    expect(parsed.note).toBe(CM_NOTE);
    expect(parsed.text).toBeNull();
  });

  test("test_zero_items_is_ok_with_a_note", () => {
    const parsed = riomaior_calendar.parse(SOURCE, [{ url: SOURCE.url, status: 200, body: enc("[]"), contentType: null }], WINDOW);
    expect(parsed.items).toEqual([]);
    expect(parsed.note!.startsWith("0 items in window")).toBe(true);
  });
});
