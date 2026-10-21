// Port of tests/python/test_adapter_cadaval_api.py.
import { describe, expect, test } from "bun:test";
import { WINDOW, fixture } from "./helpers.ts";
import { cadaval_api } from "../src/adapters/cadaval_api.ts";
import type { Source, Window } from "../src/adapters/types.ts";

const SOURCE: Source = { name: "c", adapter: "cadaval_api", town: "C", label: "C", group: "g",
  url: "https://api.example.test/website/Events/1?page=1&lang=pt",
  options: { site: "https://www.cm-cadaval.pt" } };
const enc = (s: string) => new TextEncoder().encode(s);

function parse(raw: Uint8Array, window: Window | null = null) {
  return cadaval_api.parse(SOURCE, [{ url: SOURCE.url, status: 200, body: raw, contentType: null }], window as Window);
}

describe("Cadaval", () => {
  test("test_mapping", () => {
    const parsed = parse(fixture("cadaval.json"), WINDOW);
    const items = parsed.items as any[];
    expect(items.map((i) => i.title)).toEqual(["Festa das Adiafas & Vinho", "Sem link"]);
    expect(items[0].start).toBe("2026-10-17");
    expect(items[0].end).toBe("2026-10-25");
    expect(items[0].url).toBe("https://www.cm-cadaval.pt/2716/festa-das-adiafas");
    expect(items[1].url).toBe("https://www.cm-cadaval.pt/");
    expect(parsed.text).toBeNull();
  });

  test("test_the_request_is_the_plain_url", () => {
    expect((cadaval_api as any).requests).toBeUndefined();
  });

  test("test_odd_entries_are_skipped", () => {
    const raw = enc(JSON.stringify({ items: [3, null, { date: "2026-10-22" }, { title: "Bom", date: "2026-10-22T00:00:00" }] }));
    expect(parse(raw).items.map((i: any) => i.title)).toEqual(["Bom"]);
  });

  test("test_zero_items_is_ok_with_a_note", () => {
    expect(parse(enc('{"items": []}'), WINDOW).note).toBe("0 items in window");
  });

  test("test_wrong_shape_is_an_error", () => {
    expect(() => parse(enc("[1]"))).toThrow();
  });
});
