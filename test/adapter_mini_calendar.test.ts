// The text adapter's mini_calendar option: the day of each linked event is read from its cell of a Joomla
// "Event Booking" calendar. The HTML is synthetic, modelled on that module's structure.
import { describe, expect, test } from "bun:test";
import { text } from "../src/adapters/text.ts";
import type { Source } from "../src/adapters/types.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const BASE = "https://example.org/index.php/agenda";
const source = { name: "s", url: BASE, town: "T", adapter: "text", label: "", group: "",
  links: "^/index\\.php/agenda/[^/?]+/[^/?]+$", options: { mini_calendar: true } } as Source;

const link = (slug: string, title: string, day: number) =>
  `<td class="nomarl mod_eb_mincalendar_not_today mod_eb_mincalendar_event">
     <a class="eb_minical_link" href="/index.php/agenda/cat/${slug}" title="${title}" rel="nofollow">
       <span class="nomarl">${day}</span></a></td>`;
const many = (day: number, month = 10) =>
  `<td class="nomarl mod_eb_mincalendar_event">
     <a class="eb_minical_link" href="/index.php/agenda?view=calendar&amp;layout=daily&amp;day=2026-${month}-${String(day).padStart(2, "0")}"
        title="2 Eventos" rel="nofollow"><span class="nomarl">${day}</span></a></td>`;
const empty = (day: number) => `<td class="nomarl mod_eb_mincalendar_no_event"><span class="nomarl">${day}</span></td>`;

function calendar(cells: string[], month = 10, year = 2026): string {
  return `<p>${"texto ".repeat(40)}</p>
    <input type="hidden" name="month_ajax" class="month_ajax" value="${month}" />
    <input type="hidden" name="year_ajax" class="year_ajax" value="${year}" />
    <table class="mod_eb_mincalendar_table"><tbody><tr><td class="nomarl">&nbsp;</td>${cells.join("")}</tr></tbody></table>`;
}

function parse(page: string, window: [string, string] = ["2026-10-01", "2026-12-31"], src: Source = source) {
  return text.parse(src, [{ url: BASE, status: 200, body: enc(page), contentType: null }], window);
}
const dates = (page: string, window?: [string, string]) =>
  Object.fromEntries((parse(page, window).items as any[]).map((i) => [i.title, [i.start, i.end]]));

describe("mini_calendar", () => {
  test("a day in the middle of the month, from the cell and the calendar's month and year", () => {
    const page = calendar([empty(26), empty(27), link("banda", "Música // Banda da Armada", 28), empty(29)]);
    const items = parse(page).items as any[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Música // Banda da Armada", start: "2026-10-28", end: null,
      url: "https://example.org/index.php/agenda/cat/banda" });
  });

  test("the 1st and the last day of the month", () => {
    const page = calendar([link("a", "The Uprising", 1), empty(2), link("z", "Ninguém pediu", 31)]);
    expect(dates(page)).toEqual({ "The Uprising": ["2026-10-01", null], "Ninguém pediu": ["2026-10-31", null] });
  });

  test("a calendar showing the next month dates its events in that month and year", () => {
    const page = calendar([link("a", "Natal", 5)], 12, 2026);
    expect(dates(page, ["2026-10-01", "2026-12-31"])).toEqual({ Natal: ["2026-12-05", null] });
    expect(dates(calendar([link("a", "Janeiro", 5)], 1, 2027), ["2026-12-01", "2027-01-31"]))
      .toEqual({ Janeiro: ["2027-01-05", null] });
  });

  test("a day with two events is a link to the day's list and gives no item", () => {
    const page = calendar([many(10), link("b", "Sozinho", 11)]);
    expect(dates(page)).toEqual({ Sozinho: ["2026-10-11", null] });
  });

  test("an event on consecutive days has the first as start and the last as end", () => {
    const page = calendar([link("fest", "Festival", 3), link("fest", "Festival", 4), link("fest", "Festival", 5)]);
    expect(dates(page)).toEqual({ Festival: ["2026-10-03", "2026-10-05"] });
  });

  test("an event on days that are not consecutive gets its first day and no end", () => {
    const page = calendar([link("fest", "Festival", 3), empty(4), link("fest", "Festival", 9)]);
    expect(dates(page)).toEqual({ Festival: ["2026-10-03", null] });
  });

  test("the text keeps the calendar grid and the markers", () => {
    const parsed = parse(calendar([link("banda", "Banda da Armada", 28)]));
    expect(parsed.text).toContain("<https://example.org/index.php/agenda/cat/banda>");
    expect(parsed.follow).toEqual([{ url: "https://example.org/index.php/agenda/cat/banda", data: null }]);
  });

  test("a page without the calendar's month and year fields gives no item", () => {
    const page = calendar([link("a", "X", 3)]).replace(/<input[^>]*>/g, "");
    expect(parse(page).items).toEqual([]);
  });

  test("events outside the window are left out", () => {
    expect(dates(calendar([link("a", "Cedo", 3)]), ["2026-11-01", "2026-11-30"])).toEqual({});
  });

  test("without the option no item is made", () => {
    expect(parse(calendar([link("a", "X", 3)]), ["2026-10-01", "2026-12-31"], { ...source, options: undefined }).items)
      .toEqual([]);
  });
});
