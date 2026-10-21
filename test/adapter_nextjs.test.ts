// Port of tests/python/test_adapter_nextjs.py.
import { describe, expect, test } from "bun:test";
import { EXCERPT_CAP, type Page } from "../src/adapters/common.ts";
import { clocks, excerptOf, localStamp, nextjs, parseNextjs } from "../src/adapters/nextjs.ts";
import type { Source } from "../src/adapters/types.ts";
import { WINDOW, fixture, fixtureText } from "./helpers.ts";

const URL = "https://www.example.pt/agenda";
const SOURCE: Source = { name: "s", url: URL, town: "T", adapter: "nextjs", label: "", group: "" };
const enc = (s: string) => new TextEncoder().encode(s);

const page = (name = "nextjs.html") => fixtureText(name);
const mk = (url: string, body: Uint8Array | string): Page => ({
  url, status: 200, body: typeof body === "string" ? enc(body) : body, contentType: null,
});
const parse = (text: string) => nextjs.parse(SOURCE, [mk(URL, text)], WINDOW);
const details = (pages: Page[]) => nextjs.details!(SOURCE, pages, WINDOW);

describe("NextJs", () => {
  test("test_event_list_split_over_two_chunks_is_decoded", () => {
    const { items } = parseNextjs(page(), URL, null);
    expect(items.map((i) => i.title)).toEqual(['Concerto "Primavera" | Ensaio à luz', "Antigo", "Feira longa"]);
  });

  test("test_fields_dates_are_days_and_links_are_absolute", () => {
    const item = parseNextjs(page(), URL, null).items[0]!;
    expect(item.start).toBe("2026-10-24");
    expect(item.end).toBeNull();
    expect(item.venue).toBe("Teatro São João");
    expect(item.url).toBe("https://www.example.pt/agenda/concerto--primavera");
  });

  test("test_window_keeps_running_events_and_drops_past_ones", () => {
    const { items } = parseNextjs(page(), URL, WINDOW);
    expect(items.map((i) => i.title).slice(1)).toEqual(["Feira longa"]);
    expect(items.length).toBe(2);
  });

  test("test_later_pages_are_noted", () => {
    const paged = page().replace('\\"count\\": 3, \\"totalPages\\": 1', '\\"count\\": 17, \\"totalPages\\": 2');
    const note = "page 1 of 2, 17 events in all; later events are not in this file";
    expect(parseNextjs(paged, URL, null).note).toBe(note);
    expect(parseNextjs(page(), URL, null).note).toBeNull();
    expect(parse(paged).note).toBe(note);
  });

  test("test_odd_entries_are_skipped", () => {
    const odd = page().replace('[{\\"id\\": 1,', '[7, null, {\\"id\\": 9}, {\\"id\\": 1,');
    expect(parseNextjs(odd, URL, null).items.length).toBe(3);
  });

  test("test_a_page_without_event_list_is_an_error", () => {
    expect(() => parseNextjs("<p>nothing</p>", URL, WINDOW)).toThrow();
  });

  test("test_zero_items_is_ok_with_a_note", () => {
    const parsed = parse(page("nextjs_empty.html"));
    expect(parsed.items).toEqual([]);
    expect(parsed.note).toBe("0 items in window");
  });

  test("test_parse_returns_items_and_text", () => {
    const parsed = parse(page());
    expect(parsed.items.length).toBe(2);
    expect(parsed.text).toContain("Agenda");
  });

  test("test_follow_is_the_in_window_links_in_date_order", () => {
    const follow = parse(page()).follow!;
    expect(follow.map((r) => r.url)).toEqual([
      "https://www.example.pt/agenda/feira", "https://www.example.pt/agenda/concerto--primavera"]);
    expect(follow[0]).toEqual({ url: "https://www.example.pt/agenda/feira", data: null });
  });
});

const event = (name = "nextjs_event.html"): Page => mk("https://www.example.pt/agenda/e", fixture(name));
const withSchedule = (value: string): Page =>
  mk("u", fixtureText("nextjs_event.html").replace('\\"schedule\\":\\"15 horas\\"', () => `\\"schedule\\":\\"${value}\\"`));

describe("EventPages", () => {
  test("test_a_single_clock_time_in_the_schedule_sets_the_start", () => {
    expect(details([event()])[0]!.start).toBe("2026-10-25 15:00");
    for (const value of ["15h", "15h30", "21:30", "\u00e0s 10h00", "15 horas", "9h"]) {
      const got = details([withSchedule(value)])[0]!;
      expect(got.start).toBe("2026-10-25 " + clocks(value)[0]);
      expect(got.excerpt!.startsWith(`Hor\u00e1rio: ${value}\n`)).toBe(true);
    }
    expect(clocks("15h30")).toEqual(["15:30"]);
    expect(clocks("9h")).toEqual(["09:00"]);
  });

  test("test_a_bare_duration_is_not_a_time_of_day", () => {
    for (const value of ["2h", "1 hora", "2 horas", "3h a 5h"]) expect(clocks(value)).toEqual([]);
    expect(clocks("\u00e0s 2h")).toEqual(["02:00"]);
    expect(clocks("a partir das 21 horas")).toEqual(["21:00"]);
    expect(clocks("2h30")).toEqual(["02:30"]);
    expect(clocks("das 10h \u00e0s 18h")).toEqual(["10:00", "18:00"]);
  });

  test("test_a_run_of_days_keeps_dates_and_the_schedule_in_the_excerpt", () => {
    const text = fixtureText("nextjs_event.html").replace('\\"endDate\\":\\"2026-10-24T23:00', '\\"endDate\\":\\"2026-11-05T00:00');
    const got = details([mk("u", text)])[0]!;
    expect([got.start, got.end]).toEqual(["2026-10-25", "2026-11-05"]);
    expect(got.excerpt!.startsWith("Hor\u00e1rio: 15 horas\n")).toBe(true);
  });

  test("test_a_range_sets_start_and_end", () => {
    const got = details([withSchedule("10h \u00e0s 18h")])[0]!;
    expect([got.start, got.end]).toEqual(["2026-10-25 10:00", "2026-10-25 18:00"]);
  });

  test("test_a_vague_schedule_leaves_the_date_and_is_still_shown", () => {
    for (const value of ["Todo o dia", "Manh\u00e3 e tarde", "25h", "10h e 15h", "15h30 hor\u00e1rio a confirmar"]) {
      const got = details([withSchedule(value)])[0]!;
      expect([got.start, got.end]).toEqual(["2026-10-25", null]);
      expect(got.excerpt!.startsWith(`Hor\u00e1rio: ${value}\n`)).toBe(true);
    }
  });

  test("test_details_read_the_payload_split_over_chunks", () => {
    const found = details([event()]);
    expect(found.length).toBe(1);
    const detail = found[0]!;
    expect(detail.url).toBe("https://www.example.pt/agenda/e");
    expect(detail.title).toBe('Encontro "Bandas" \u00e0 tarde');
    expect(detail.excerpt).toBe(
      "Hor\u00e1rio: 15 horas\nA partir das 15 horas, na sede da Sociedade Filarm\u00f3nica.\nA entrada \u00e9 gratuita.");
    expect(detail.venue).toBeNull();
  });

  test("test_utc_midnight_in_summer_time_is_the_next_local_day", () => {
    const detail = details([withSchedule("")])[0]!;
    expect(detail.start).toBe("2026-10-25");
    expect(detail.excerpt).not.toContain("Hor\u00e1rio");
    expect(detail.end).toBeNull();
  });

  test("test_local_time_is_kept_and_the_clock_follows_the_season", () => {
    expect(localStamp("2026-07-10T18:30:00+00:00")).toBe("2026-07-10 19:30");
    expect(localStamp("2026-12-10T18:30:00+00:00")).toBe("2026-12-10 18:30");
    expect(localStamp(null)).toBeNull();
  });

  test("test_end_after_start_is_kept", () => {
    const text = fixtureText("nextjs_event.html").replace('\\"endDate\\":\\"2026-10-24T23:00', '\\"endDate\\":\\"2026-10-25T16:00');
    expect(details([mk("u", text)])[0]!.end).toBe("2026-10-25 16:00");
  });

  test("test_a_streamed_description_is_read_from_its_text_row", () => {
    let text = fixtureText("nextjs_event.html");
    text = text.replace("<p>A partir das 15 horas, na sede da Sociedade Filarm", "$21");
    text = text.replace("\\u00f3nica.</p>\\\\n<p>A entrada \\u00e9 gratuita.</p>", "");
    const body = "çã <p>Às 21h, no <b>Teatro</b>.</p>";
    const row = `21:T${enc(body).length.toString(16)},${body}`;
    text = text.replace("</body>", () => `<script>self.__next_f.push([1,"\\n${row}\\n22:[]"])</script></body>`);
    expect(details([mk("u", text)])[0]!.excerpt).toBe("Horário: 15 horas\nçã\nÀs 21h, no Teatro.");
  });

  test("test_long_description_is_capped", () => {
    expect(excerptOf("<p>" + "palavra ".repeat(300) + "</p>")!.length).toBeLessThanOrEqual(EXCERPT_CAP);
  });

  test("test_a_page_without_payload_is_read_as_any_page", () => {
    const html = "<html><head><title>Um Concerto Especial</title></head><body><p>Texto do evento.</p></body></html>";
    const found = details([mk("https://www.example.pt/x", html)]);
    expect(found[0]!.title).toBe("Um Concerto Especial");
    expect(found[0]!.excerpt).toContain("Texto do evento.");
  });

  test("test_a_payload_without_a_description_module_falls_back", () => {
    const found = details([mk("https://www.example.pt/x", fixture("nextjs.html"))]);
    expect(found.length).toBe(1);
    expect(found[0]!.excerpt).toContain("Agenda");
  });
});
