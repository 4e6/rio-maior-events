// Port of tests/python/test_adapter_events_calendar.py.
import { describe, expect, test } from "bun:test";
import { WINDOW, fixture } from "./helpers.ts";
import { events_calendar, requestUrl } from "../src/adapters/events_calendar.ts";
import type { Source, Window } from "../src/adapters/types.ts";

const SOURCE: Source = { name: "t", adapter: "events_calendar", town: "T", label: "T", group: "g",
  url: "https://www.example.pt/wp-json/tribe/events/v1/events?per_page=50",
  options: { window_params: ["start_date", "end_date"] } };
const enc = (s: string) => new TextEncoder().encode(s);

function parse(raw: Uint8Array, window: Window | null = null) {
  return events_calendar.parse(SOURCE, [{ url: SOURCE.url, status: 200, body: raw, contentType: null }], window as Window);
}

describe("Tribe", () => {
  test("test_titles_are_unescaped_and_venue_may_be_empty", () => {
    const items = parse(fixture("tribe.json")).items as any[];
    expect(items[0].title).toBe("Feira – Santa & Iria");
    expect(items[0].venue).toBeNull();
    expect(items[0].start).toBe("2026-10-22 18:00:00");
    expect(items[0].end).toBe("2026-10-25 22:30:00");
    expect(items[0].description).toBe("Quatro dias de feira .");
    expect(items[1].venue).toBe("Auditório & Sala");
    expect(items[1].price).toBe("5 €");
    expect(items[1].url).toBe("https://www.example.pt/evento/aula/");
  });

  test("test_window_and_description_cap", () => {
    const items = parse(fixture("tribe.json"), WINDOW).items as any[];
    expect(items.map((i) => i.title)).toEqual(["Feira – Santa & Iria", "Aula", "Muito longo"]);
    expect([...items[2].description].length).toBe(300);
  });

  test("test_the_window_is_added_to_the_request_url", () => {
    const [request, ...rest] = events_calendar.requests!(SOURCE, WINDOW);
    expect(rest).toEqual([]);
    expect(request!.url).toBe(SOURCE.url + "&start_date=2026-10-20&end_date=2026-12-01+23%3A59%3A59");
    expect(request!.data).toBeNull();
    const bare = { ...SOURCE, url: "https://www.example.pt/e" };
    expect(requestUrl(bare, WINDOW)).toBe("https://www.example.pt/e?start_date=2026-10-20&end_date=2026-12-01+23%3A59%3A59");
  });

  test("test_no_text_and_three_items", () => {
    const parsed = parse(fixture("tribe.json"), WINDOW);
    expect(parsed.text).toBeNull();
    expect(parsed.items.length).toBe(3);
  });

  test("test_odd_entries_are_skipped", () => {
    const raw = enc(JSON.stringify({ events: [3, null, { start_date: "2026-10-22" }, { title: "Bom", start_date: "2026-10-22" }] }));
    expect(parse(raw).items.map((i: any) => i.title)).toEqual(["Bom"]);
  });

  test("test_zero_items_is_ok_with_a_note", () => {
    expect(parse(enc('{"events": []}'), WINDOW).note).toBe("0 items in window");
  });

  test("test_wrong_shape_is_an_error", () => {
    expect(() => parse(enc("[1]"))).toThrow();
  });
});
