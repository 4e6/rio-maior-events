// Port of tests/python/test_adapter_municipal_rss.py.
import { beforeAll, describe, expect, test } from "bun:test";
import { fixture } from "./helpers.ts";
import { municipal_rss } from "../src/adapters/municipal_rss.ts";
import { AdapterError } from "../src/adapters/common.ts";
import type { Source, Window } from "../src/adapters/types.ts";

const URL = "https://www.example.pt/pages/agenda.rss";
const SOURCE: Source = { name: "t", adapter: "municipal_rss", town: "T", label: "T", group: "g", url: URL };
const WINDOW: Window = ["2026-10-20", "2026-11-22"];
const enc = (s: string) => new TextEncoder().encode(s);

function parse(raw: Uint8Array, window: Window = WINDOW) {
  return municipal_rss.parse(SOURCE, [{ url: URL, status: 200, body: raw, contentType: null }], window);
}
const feed = (...items: string[]) =>
  enc(`<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items.join("")}</channel></rss>`);

describe("MunicipalRss", () => {
  let result: ReturnType<typeof parse>;
  let items: Record<string, any>;
  beforeAll(() => {
    result = parse(fixture("municipal.rss"));
    items = Object.fromEntries(result.items.map((i: any) => [i.title, i]));
  });

  test("test_the_offset_is_applied_across_the_change", () => {
    expect(items["Corrida"].start).toBe("2026-10-25 09:00");
    expect(items["Meia-noite de verão"].start).toBe("2026-10-26 22:00");
  });

  test("test_summer_offset_before_the_change_is_kept", () => {
    const raw = feed("<item><title>A</title><pubDate>Sat, 24 Oct 2026 10:00:00 +0100</pubDate></item>");
    expect((parse(raw).items[0] as any).start).toBe("2026-10-24 10:00");
  });

  test("test_utc_before_the_change_is_summer_time", () => {
    expect(items["Teatro de verão"].start).toBe("2026-10-24 00:30");
  });

  test("test_utc_after_the_change_is_the_same_clock", () => {
    const item = items["Concerto & Fado"];
    expect(item.start).toBe("2026-10-31 21:00");
    expect(item.description).toBe("Noite de fado");
    expect(item.url).toBe("https://www.example.pt/agenda/evento/fado");
    expect(item.end).toBeNull();
    expect(item.venue).toBeNull();
  });

  test("test_midnight_local_is_a_date_only", () => {
    expect(items["CINEMA"].start).toBe("2026-11-22");
  });

  test("test_midnight_from_an_offset", () => {
    const raw = feed("<item><title>A</title><pubDate>Sat, 24 Oct 2026 23:00:00 +0000</pubDate></item>");
    expect((parse(raw).items[0] as any).start).toBe("2026-10-25");
  });

  test("test_image_only_description_is_none", () => {
    expect(items["CINEMA"].description).toBeNull();
  });

  test("test_window_filter_and_unreadable_dates", () => {
    expect(new Set(Object.keys(items))).toEqual(
      new Set(["Concerto & Fado", "CINEMA", "Corrida", "Teatro de verão", "Meia-noite de verão"]));
  });

  test("test_items_ascend_and_follow_matches", () => {
    const starts = result.items.map((i: any) => i.start);
    expect(starts).toEqual([...starts].sort());
    expect(starts[0]).toBe("2026-10-24 00:30");
    const follow = result.follow!;
    expect(follow.map((r) => r.url)).toEqual(result.items.map((i: any) => i.url));
    expect(follow.every((r) => r.data === null)).toBe(true);
    expect(follow.map((r) => r.url)).toContain("https://www.example.pt/agenda/evento/teatro");
  });

  test("test_no_items_in_window_is_ok_with_a_note", () => {
    const r = parse(fixture("municipal.rss"), ["2027-01-01", "2027-01-31"]);
    expect([r.items, r.follow, r.note]).toEqual([[], [], "0 items in window"]);
  });

  test("test_doctype_is_refused", () => {
    const raw = enc('<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY x "y">]><rss><channel></channel></rss>');
    expect(() => parse(raw)).toThrow(AdapterError);
  });

  test("test_missing_channel", () => {
    expect(() => parse(enc('<rss version="2.0"></rss>'))).toThrow(AdapterError);
    expect(() => parse(enc("<html><body>no</body></html>"))).toThrow(AdapterError);
  });

  test("test_not_xml", () => {
    expect(() => parse(enc("<rss><channel>"))).toThrow(AdapterError);
  });
});
