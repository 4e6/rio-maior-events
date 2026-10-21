// Port of tests/python/test_adapter_santarem_rss.py.
import { beforeAll, describe, expect, test } from "bun:test";
import { WINDOW, fixture } from "./helpers.ts";
import { santarem_rss } from "../src/adapters/santarem_rss.ts";
import { AdapterError } from "../src/adapters/common.ts";
import type { Source, Window } from "../src/adapters/types.ts";

const SOURCE: Source = { name: "t", adapter: "santarem_rss", town: "T", label: "T", group: "g", url: "https://www.example.pt/rss_eventos" };
const enc = (s: string) => new TextEncoder().encode(s);

function parse(raw: Uint8Array, window: Window | null = null) {
  return santarem_rss.parse(SOURCE, [{ url: SOURCE.url, status: 200, body: raw, contentType: null }], window as Window);
}
type It = ReturnType<typeof parse>["items"][number] & Record<string, any>;
const byTitle = (items: It[], title: string) => items.filter((i) => i.title === title);

describe("SantaremRss", () => {
  let items: It[];
  beforeAll(() => { items = parse(fixture("santarem.xml"), WINDOW).items as It[]; });

  test("test_single_date_has_local_times_and_clean_text", () => {
    const [item, ...rest] = byTitle(items, "Concerto & Fado");
    expect(rest).toEqual([]);
    expect([item!.start, item!.end]).toEqual(["2026-10-22 21:30", "2026-10-22 23:00"]);
    expect(item!.venue).toBe("Teatro Exemplo");
    expect(item!.url).toBe("https://www.example.pt/agenda-de-eventos/1-concerto");
    expect(item!.description).toBe("Noite de fado com &guitarra");
    expect(item!.price).toBeNull();
  });

  test("test_touching_ranges_with_one_link_are_joined", () => {
    const [item, ...rest] = byTitle(items, "Exposição");
    expect(rest).toEqual([]);
    expect([item!.start, item!.end]).toEqual(["2026-10-20", "2026-11-10"]);
    expect(item!.description).toBe("Horário diário: 17:00–17:30. Patente");
  });

  test("test_separate_dates_stay_separate", () => {
    expect(byTitle(items, "Oficina").map((i) => i.start)).toEqual(["2026-10-24 10:00", "2026-10-31 10:00"]);
  });

  test("test_same_day_sessions_become_one_item", () => {
    const [item, ...rest] = byTitle(items, "Teatro escolar");
    expect(rest).toEqual([]);
    expect([item!.start, item!.end]).toEqual(["2026-11-17 10:30", "2026-11-17 11:30"]);
    expect(item!.description).toBe("Outras sessões: 14:00–15:00. Duas sessões");
  });

  test("test_midnight_times_mean_no_time", () => {
    const [item, ...rest] = byTitle(items, "Feira");
    expect(rest).toEqual([]);
    expect([item!.start, item!.end]).toEqual(["2026-11-01", "2026-11-02"]);
    expect(item!.description).toBe("Sem horas");
  });

  test("test_no_date_is_dropped_and_the_window_applies", () => {
    expect(items.map((i) => i.title)).toEqual(["Concerto & Fado", "Exposição", "Oficina", "Oficina", "Teatro escolar", "Feira"]);
    const everything = parse(fixture("santarem.xml")).items as It[];
    expect(everything.length).toBe(8);
    expect(everything.map((i) => i.title)).not.toContain("Sem data");
  });

  test("test_no_text_and_a_note_when_nothing_is_in_window", () => {
    const parsed = parse(fixture("santarem.xml"), ["2027-01-01", "2027-01-31"]);
    expect([parsed.items, parsed.text, parsed.past]).toEqual([[], null, []]);
    expect(parsed.note).toBe("0 items in window");
  });

  test("test_a_doctype_is_refused", () => {
    const raw = enc('<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY a "b">]><rss><channel/></rss>');
    expect(() => parse(raw)).toThrow(AdapterError);
  });

  test("test_a_utf16_doctype_is_refused", () => {
    const text = '<?xml version="1.0" encoding="utf-16"?><!DOCTYPE rss [<!ENTITY a "b">]><rss><channel/></rss>';
    const le = (s: string) => { const b = new Uint8Array(s.length * 2); s.split("").forEach((c, i) => { b[2 * i] = c.charCodeAt(0); }); return b; };
    const be = (s: string) => { const b = new Uint8Array(s.length * 2); s.split("").forEach((c, i) => { b[2 * i + 1] = c.charCodeAt(0); }); return b; };
    const u32 = (s: string) => { const b = new Uint8Array(s.length * 4); s.split("").forEach((c, i) => { b[4 * i] = c.charCodeAt(0); }); return b; };
    const bom = (b: Uint8Array) => new Uint8Array([0xff, 0xfe, ...b]);
    for (const raw of [bom(le(text)), le(text), be(text), u32(text)]) {
      expect(() => parse(raw)).toThrow(/not ASCII-compatible/);
    }
  });

  test("test_consecutive_single_days_with_one_link_stay_separate", () => {
    const entry = (day: string, time: string) =>
      "<item><title>Peça</title><link>https://www.example.pt/p</link>" +
      `<santaremEvent><startTime>${time}</startTime><singleDate>${day}</singleDate></santaremEvent></item>`;
    const raw = enc("<rss><channel>" + entry("2026-10-23", "21:30") + entry("2026-10-24", "16:00") + "</channel></rss>");
    expect(parse(raw).items.map((i: any) => i.start)).toEqual(["2026-10-23 21:30", "2026-10-24 16:00"]);
  });

  test("test_malformed_xml_is_an_error", () => {
    expect(() => parse(enc("<rss><channel><item>"))).toThrow(/not valid XML/);
  });

  test("test_valid_xml_without_a_channel_is_an_error", () => {
    expect(() => parse(enc("<html><body/></html>"))).toThrow(AdapterError);
    expect(() => parse(enc('<rss version="2.0"></rss>'))).toThrow(AdapterError);
  });
});
