// Port of tests/python/test_render.py.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as render from "../src/render.ts";
import { capture } from "./capture.ts";
import { ROOT } from "./helpers.ts";

const SAMPLE_JSON = join(ROOT, "examples", "sample-events.json");
const SAMPLE_HTML = join(ROOT, "examples", "sample-events.html");

type Doc = Record<string, any>;
const sample = (): Doc => JSON.parse(readFileSync(SAMPLE_JSON, "utf8"));
const assetText = (name: string) => readFileSync(join(ROOT, "assets", name), "utf8");
const htmlOf = (data: Doc) => render.build(data, assetText("page.css"), assetText("page.js"));

/** main(), with what it prints captured: (exit code, stdout, stderr). */
function run(args: string[]): [number, string, string] {
  const r = capture(() => render.main(args));
  return [r.result, r.stdout, r.stderr];
}

const first = (data: Doc, kind: string) => data.events.find((e: Doc) => e.kind === kind);

function withTmp<T>(fn: (dir: string) => T): T {
  const d = mkdtempSync(join(tmpdir(), "render-"));
  try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); }
}

describe("SampleTests", () => {
  test("test_sample_validates", () => {
    expect(render.check(sample())).toEqual([]);
  });

  test("test_sample_covers_every_kind_and_state", () => {
    const data = sample();
    expect(new Set(data.events.map((e: Doc) => e.kind))).toEqual(new Set(render.KINDS));
    expect(data.events.some((e: Doc) => e.date_tbc)).toBe(true);
    expect(data.events.some((e: Doc) => e.confidence === "low")).toBe(true);
    expect(data.sources_checked.some((s: Doc) => !s.ok)).toBe(true);
  });

  test("test_sample_has_a_further_ahead_part_that_reaches_every_routing_branch", () => {
    const data = sample();
    const far = data.events.filter((e: Doc) => e.start_date > data.window.near_end);   // "2027-03" and "2026-12-12" compare as strings, like the page
    expect(data.window.near_end > data.window.start && data.window.near_end < data.window.end).toBe(true);
    expect(far.some((e: Doc) => e.date_tbc)).toBe(true);
    expect(far.some((e: Doc) => e.kind === "ongoing")).toBe(true);
    expect(far.some((e: Doc) => e.kind === "multi_day" && e.drive_min >= 50)).toBe(true);
    expect(far.some((e: Doc) => e.kind === "single" && !e.date_tbc)).toBe(true);
    // the dated part is still there
    expect(data.events.some((e: Doc) => e.start_date <= data.window.near_end && !e.date_tbc)).toBe(true);
  });

  test("test_sample_html_matches_committed_file_byte_for_byte", () => {
    const committed = readFileSync(SAMPLE_HTML);
    expect(Buffer.from(htmlOf(sample()), "utf8").equals(committed)).toBe(true);
  });

  test("test_cli_writes_the_page_and_says_so", () => withTmp((d) => {
    const out = join(d, "page.html");
    const [code, said] = run([SAMPLE_JSON, out]);
    expect(code).toBe(0);
    expect(said).toMatch(/^wrote .*: 22 events, from 2026-10-20 to 2027-04-20\n$/);
    expect(readFileSync(out).equals(readFileSync(SAMPLE_HTML))).toBe(true);
  }));

  test("test_cli_exits_2_and_writes_nothing_on_problems", () => withTmp((d) => {
    const data = sample();
    data.events[0].kind = "weekly";
    const src = join(d, "e.json"), out = join(d, "page.html");
    writeFileSync(src, JSON.stringify(data));
    expect(run([src, out])[0]).toBe(2);
    expect(existsSync(out)).toBe(false);
  }));

  test("test_cli_exits_2_on_a_file_that_is_not_json", () => withTmp((d) => {
    const src = join(d, "e.json");
    writeFileSync(src, "{nope");
    expect(run([src, join(d, "o.html")])[0]).toBe(2);
  }));
});

describe("WindowNearEnd", () => {
  const problemsWith = (w: Doc, keepFar = true) => {
    const d = sample(); d.window = w;
    if (!keepFar) d.events = d.events.filter((e: Doc) => e.start_date <= "2026-11-30");   // the far sample events are outside a short window
    return render.check(d);
  };
  const W = { start: "2026-10-20", end: "2027-04-20" };

  test("near_end between start and end, or equal to either, is fine", () => {
    for (const near_end of ["2026-10-20", "2026-11-22", "2026-12-19"]) expect(problemsWith({ ...W, near_end })).toEqual([]);
    expect(problemsWith({ start: "2026-10-20", end: "2026-11-30", near_end: "2026-11-30" }, false)).toEqual([]);
  });
  test("a dated part longer than 60 days is a problem, even when near_end is the window end", () => {
    for (const near_end of ["2026-12-20", "2027-04-20"]) {
      expect(problemsWith({ ...W, near_end }).some((p) => p.includes("more than 60 days after window.start"))).toBe(true);
    }
  });
  test("near_end that is not a real date, or lies outside the window, is a problem", () => {
    for (const near_end of ["soon", "2026-02-30", "2026-10-19", "2027-04-21", null, 20261122]) {
      expect(problemsWith({ ...W, near_end }).some((p) => p.includes("near_end"))).toBe(true);
    }
  });
  test("a short window may leave it out, a long one may not", () => {
    expect(problemsWith({ start: "2026-10-20", end: "2026-11-30" }, false)).toEqual([]);                 // the length the collector has always used
    expect(problemsWith({ start: "2026-10-20", end: "2026-12-19" }, false)).toEqual([]);                 // 60 days
    expect(problemsWith(W).some((p) => p.includes("near_end is required"))).toBe(true);
  });
  test("the schema and the page data carry it", () => {
    expect(readFileSync(join(ROOT, "references", "events-schema.json"), "utf8")).toContain('"near_end"');
    expect(render.pageData(sample()).window.near_end).toBe("2026-11-22");
  });
  test("the no-script line says where the dated weeks end only when the window runs further ahead", () => {
    expect(htmlOf(sample())).toContain("2026-10-20 to 2026-11-22, and further ahead to 2027-04-20.");
    const d = sample(); d.window = { start: "2026-10-20", near_end: "2027-04-20", end: "2027-04-20" };
    expect(htmlOf(d)).toContain("2026-10-20 to 2027-04-20.");
  });
});

describe("IdTests", () => {
  test("test_accents_case_and_spacing_give_the_same_id", () => {
    const a = { title_pt: "Feira do Sal e dos Sabores", start_date: "2026-10-23", town: "Rio Maior" };
    const b = { title_pt: "  FEIRA  do sal e dos  sabóres ", start_date: "2026-10-23", town: "rio  maior" };
    const c = { title_pt: "Feira do Sal", start_date: "2026-10-23", town: "Rio Maior" };
    expect(render.eventId(a)).toBe(render.eventId(b));
    expect(render.eventId(a)).not.toBe(render.eventId(c));
    expect(render.eventId(a)).toMatch(/^[0-9a-f]{10}$/);
  });

  test("test_a_different_date_or_town_is_a_different_id", () => {
    const a = { title_pt: "Mercado", start_date: "2026-10-23", town: "Rio Maior" };
    expect(render.eventId(a)).not.toBe(render.eventId({ ...a, start_date: "2026-10-24" }));
    expect(render.eventId(a)).not.toBe(render.eventId({ ...a, town: "Santarem" }));
  });

  test("test_ids_are_in_the_page_data", () => {
    const data = sample();
    const out = render.pageData(data);
    expect(out.events[0].id).toBe(render.eventId(data.events[0]));
  });

  test("test_the_same_event_twice_is_a_problem", () => {
    const data = sample();
    data.events.push(structuredClone(data.events[0]));
    expect(render.check(data).some((p) => p.includes("same event as events[0]"))).toBe(true);
  });
});

describe("ValidationTests", () => {
  const problemsAfter = (change: (d: Doc) => void) => {
    const data = sample();
    change(data);
    return render.check(data);
  };

  test("test_low_confidence_needs_a_caveat", () => {
    const found = problemsAfter((d) => {
      d.events.find((e: Doc) => e.confidence === "low").caveat = "";
    });
    expect(found.length).toBe(1);
    expect(found[0]).toContain("caveat");
    expect(found[0]).toContain("events[");
  });

  test("test_a_bad_date_is_named_with_its_event", () => {
    const found = problemsAfter((d) => { d.events[2].start_date = "2026-02-30"; });
    expect(found.length).toBe(1);
    expect(found[0]).toContain("events[2]");
    expect(found[0]).toContain("start_date");
  });

  test("test_empty_sources", () => {
    expect(problemsAfter((d) => { d.events[1].sources = []; }).some((p) => p.includes("sources"))).toBe(true);
  });

  test("test_bad_kind", () => {
    expect(problemsAfter((d) => { d.events[0].kind = "weekly"; }).some((p) => p.includes("kind"))).toBe(true);
  });

  test("test_bad_time_and_category", () => {
    const found = problemsAfter((d) => {
      d.events[0].start_time = "25:00";
      d.events[1].category = "party";
    });
    expect(found.some((p) => p.includes("start_time"))).toBe(true);
    expect(found.some((p) => p.includes("category"))).toBe(true);
  });

  test("test_an_ongoing_event_without_an_end_is_not_called_outside_the_window", () => {
    const found = problemsAfter((d) => {
      const e = first(d, "ongoing");
      e.start_date = "2026-10-01";
      e.end_date = null;
    });
    expect(found.length).toBe(1);
    expect(found[0]).toContain("needs an end_date");
    expect(found[0]).not.toContain("outside");
  });

  test("test_multi_day_needs_a_later_end", () => {
    const found = problemsAfter((d) => {
      const e = first(d, "multi_day");
      e.end_date = e.start_date;
    });
    expect(found.some((p) => p.includes("multi_day"))).toBe(true);
  });

  test("test_a_recurring_event_cannot_have_date_tbc", () => {
    const found = problemsAfter((d) => {
      Object.assign(first(d, "recurring"), { date_tbc: true, dates: null, start_time: null, end_date: null });
    });
    expect(found.some((p) => p.includes("recurring") && p.includes("date_tbc"))).toBe(true);
  });

  test("test_multi_day_spans_at_most_seven_days", () => {
    const found = problemsAfter((d) => {
      const e = first(d, "multi_day");
      e.start_date = "2026-10-21";
      e.end_date = "2026-10-28";
    });
    expect(found.some((p) => p.includes("at most 7 days") && p.includes("ongoing"))).toBe(true);
  });

  test("test_multi_day_of_seven_days_is_fine", () => {
    expect(problemsAfter((d) => {
      const e = first(d, "multi_day");
      e.start_date = "2026-10-21";
      e.end_date = "2026-10-27";
    })).toEqual([]);
  });

  test("test_recurring_dates_must_be_inside_the_window", () => {
    const found = problemsAfter((d) => { first(d, "recurring").dates = ["2026-10-24", "2027-05-05"]; });
    expect(found.length).toBe(1);
    expect(found[0]).toContain("2027-05-05");
  });

  test("test_an_event_that_ended_before_the_window_is_rejected", () => {
    const found = problemsAfter((d) => {
      const e = first(d, "multi_day");
      e.start_date = "2026-10-10";
      e.end_date = "2026-10-12";
    });
    expect(found.some((p) => p.includes("outside the window"))).toBe(true);
  });

  test("test_a_single_event_outside_the_window_is_rejected", () => {
    for (const day of ["2026-10-19", "2027-04-21"]) {
      expect(problemsAfter((d) => { first(d, "single").start_date = day; }).some((p) => p.includes("outside the window"))).toBe(true);
    }
  });

  test("test_an_event_that_started_before_the_window_but_runs_into_it_is_kept", () => {
    expect(problemsAfter(() => {})).toEqual([]);
    expect(first(sample(), "ongoing").start_date < sample().window.start).toBe(true);
  });

  test("test_a_month_only_date_is_judged_by_its_month", () => {
    expect(problemsAfter((d) => { d.events.find((e: Doc) => e.date_tbc).start_date = "2027-05"; })
      .some((p) => p.includes("outside the window"))).toBe(true);
    expect(problemsAfter((d) => { d.events.find((e: Doc) => e.date_tbc).start_date = "2026-10"; })).toEqual([]);
  });

  test("test_a_missing_field_is_named", () => {
    expect(problemsAfter((d) => { delete d.events[0].town; }).some((p) => p.includes("missing town"))).toBe(true);
  });

  test("test_problems_are_capped_at_twenty", () => withTmp((d) => {
    const data = sample();
    for (const e of data.events) {
      e.kind = "weekly";
      e.category = "party";
    }
    expect(render.check(data).length).toBeGreaterThan(render.MAX_PROBLEMS);
    const src = join(d, "e.json");
    writeFileSync(src, JSON.stringify(data));
    const [code, , err] = run([src, join(d, "o.html")]);
    expect(code).toBe(2);
    const lines = err.split("\n").filter((l, i, all) => !(i === all.length - 1 && l === ""));
    expect(lines[lines.length - 1]).toContain("and ");
    expect(lines.length).toBe(1 + render.MAX_PROBLEMS + 1);
  }));

  test("drive_min_30.0_is_accepted (new: JSON.parse keeps no int/float distinction)", () => {
    expect(problemsAfter((d) => { d.events[0].drive_min = JSON.parse("30.0"); })).toEqual([]);
    expect(problemsAfter((d) => { d.events[0].drive_min = 1.5; }).some((p) => p.includes("drive_min"))).toBe(true);
  });
});

describe("SafetyTests", () => {
  const dataBlock = (page: string): string => {
    const m = /<script type="application\/json" id="events-data">\n([\s\S]*?)\n<\/script>/.exec(page);
    expect(m).not.toBeNull();
    return m![1]!;
  };

  test("test_javascript_links_are_dropped_and_text_kept", () => {
    const data = sample();
    data.events[0].sources = [{ name: "Evil source", url: "javascript:alert(1)" }];
    data.sources_checked[0].url = "data:text/html,x";
    const page = htmlOf(data);
    expect(page).not.toContain("javascript:");
    expect(page).not.toContain("data:text/html");
    expect(page).toContain("Evil source");
    const embedded = JSON.parse(dataBlock(page));
    expect(embedded.events[0].sources[0].url).toBe("");
    expect(embedded.events[0].sources[0].name).toBeTruthy();
  });

  test("test_a_title_cannot_break_out_of_the_data_block", () => {
    const evil = "</script><script>alert(1)</script>";
    const data = sample();
    data.events[0].title_pt = evil;
    data.events[0].title_en = "A & B <b>";
    const page = htmlOf(data);
    const block = dataBlock(page);
    expect(block.toLowerCase()).not.toContain("</script");
    expect(block).not.toContain("<");
    expect(JSON.parse(block).events[0].title_pt).toBe(evil);
    expect(page).not.toContain(evil);
    expect(page.toLowerCase().split("</script").length - 1).toBe(2);
  });

  test("test_the_noscript_list_is_escaped", () => {
    const data = sample();
    data.events[0].title_en = "<img src=x onerror=alert(1)>";
    const page = htmlOf(data);
    expect(page).not.toContain("<img src=x");
    expect(page).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  test("test_nothing_is_fetched_from_elsewhere", () => {
    const page = htmlOf(sample());
    expect(/<script[^>]*\ssrc=/i.test(page)).toBe(false);
    expect(page.toLowerCase()).not.toContain("<link");
    expect(page.toLowerCase()).not.toContain("@import");
    expect(page.toLowerCase()).not.toContain("url(http");
  });

  test("test_the_page_has_the_title_and_a_noscript_list", () => {
    const page = htmlOf(sample());
    expect(page).toContain("<title>What's on around Rio Maior</title>");
    const m = /<noscript>([\s\S]*?)<\/noscript>/.exec(page);
    expect(m).not.toBeNull();
    expect(m![1]!.split("<li>").length - 1).toBe(sample().events.length);
  });

  test("test_output_does_not_depend_on_anything_but_input", () => {
    expect(htmlOf(sample())).toBe(htmlOf(sample()));
  });
});

describe("PageScriptTests", () => {
  const js = assetText("page.js");

  test("test_dates_are_never_parsed_from_a_bare_string", () => {
    expect(/new Date\(\s*[a-z]\w*\s*\)/.test(js.replaceAll("new Date()", ""))).toBe(false);
    expect(js).not.toContain("Date.parse");
    expect(js).not.toContain("UTC(");
  });

  test("test_calendar_files_use_floating_times_and_data_links", () => {
    expect(js).not.toContain("TZID");
    expect(js).not.toContain("VTIMEZONE");
    expect(js).toContain("DTSTART;VALUE=DATE:");
    expect(js).toContain("DTEND;VALUE=DATE:");
    expect(js).toContain("data:text/calendar");
    expect(js).not.toContain("createObjectURL");
  });

  test("test_the_empty_state_does_not_click_a_button_that_may_be_missing", () => {
    expect(js).not.toContain("clear-filters').click()");
    expect(js).not.toContain("clear-filters\\').click()");
  });

  test("test_the_phone_strip_ends_at_near_end_the_grids_at_the_last_marked_month_and_a_lost_near_end_falls_back_to_the_window", () => {
    expect(js).toContain("WIN.near_end");
    expect(js).toContain("var stale = realToday > NEAR;");
    // the strip and the bands stop at near_end; the grids follow the last month with a marked day, never the window's end
    expect(js).toContain("for (var d = WIN.start; d <= NEAR; d = add(d, 1))");
    expect(js).toContain("d >= b.from && d <= b.to && d <= NEAR");
    expect(js).toContain("while (cur.slice(0, 7) <= GRID_END)");
    expect(/\bcur <= WIN\.end/.test(js)).toBe(false);
    expect(js).not.toContain("9999-12-31");
    // a near_end outside the window is ignored rather than trusted
    expect(js).toContain("WIN.near_end >= WIN.start && WIN.near_end <= WIN.end ? WIN.near_end : WIN.end");
  });

  test("test_the_first_far_band_is_the_ahead_anchor_and_the_hidden_lines_are_drawn", () => {
    expect(js).toContain("hidden by your filters");
    expect(js).toContain('id="ahead" tabindex="-1"');
    expect(js).not.toContain('getElementById("ahead").innerHTML');
    expect(assetText("page.css")).toContain("#ahead");
    // the page no longer carries an empty container for it: far days are in #list, the undated ones in #tbc
    expect(htmlOf(sample())).not.toContain('<div id="ahead"');
    expect(js).toContain("in the agenda above");
    expect(js).toContain("with a date to be confirmed");
  });

  test("test_a_jump_keeps_its_day_until_the_user_scrolls_and_a_rebuilt_calendar_gets_its_mark_back", () => {
    // a smooth scroll from November to March passes every day and cannot put the last days on the line: no fixed timer;
    // an input lets go, and so does the scroll's end (or a jump with nothing to scroll), without moving the mark
    expect(js).not.toContain("jumping++");
    expect(js).toContain("jumpHold = true");
    expect(js).toContain('["wheel", "touchstart", "mousedown", "keydown"]');
    expect(js).toContain('window.addEventListener("scrollend", function () { if (jumpHold) letGo(); });');
    expect(js).toContain('window.addEventListener("hashchange"');
    expect(js).toMatch(/function letGo\(\) \{ requestAnimationFrame\(function \(\) \{ jumpHold = false; \}\); \}/);
    // the keyboard's tab stop is not moved by the scroll while the keyboard is in the rail
    expect(js).toContain("if (keyboardIn(rail)) return stripTo(d);");
    expect(js).toContain("window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2");
    // renderNav draws the rail without the mark and setActive returns early for the day it holds
    expect(js).toContain("var held = activeDay; activeDay = null; setActive(held);");
  });

  test("test_no_demo_leftovers", () => {
    expect(js).not.toContain("__demo");
  });
});

describe("Status link", () => {
  test("the header line links to the status page, the sources list is gone, the footer line stays", () => {
    const html = htmlOf(sample());
    const js = assetText("page.js");
    expect(js).toContain('href="status.html"');
    expect(js).toContain("build status");
    expect(js).toContain("unreachable");
    expect(js).not.toContain("Sources checked");
    expect(js).toContain("Times are local, Portugal. Drive times are estimates from");
    expect(html).toContain('id="foot"');
    expect(html).not.toContain('class="sources"');
    // the no-script view links too, and the events file still carries sources_checked
    expect(html).toContain('<a href="status.html">Build status</a>');
    expect(html).toContain("sources_checked");
  });
});

describe("Status link, as the page draws it", () => {
  /** Runs page.js against a stand-in document that records what is written to each element's innerHTML. */
  function drawn(data: Doc, opt: { today?: string; toggles?: string[] } = {}): Record<string, string> {
    const html: Record<string, string> = {};
    const listeners: Record<string, ((ev: any) => void)[]> = {};
    const make = (id: string): any => {
      const target: any = function () { return proxy; };
      const proxy: any = new Proxy(target, {
        get(_t, key) {
          if (key === "innerHTML") return html[id] ?? "";
          if (key === "textContent") return id === "events-data" ? JSON.stringify(render.pageData(data)) : "";
          if (key === Symbol.toPrimitive) return () => "";
          if (key === "addEventListener") return (type: string, fn: (ev: any) => void) => { (listeners[id + ":" + type] ??= []).push(fn); };
          if (key === "dataset" || key === "style" || key === "classList") return make(id + "." + String(key));
          return proxy;
        },
        set(_t, key, value) { if (key === "innerHTML") html[id] = String(value); return true; },
        apply() { return proxy; },
      });
      return proxy;
    };
    const els = new Map<string, any>();
    const document: any = new Proxy({}, {
      get(_t, key) {
        if (key === "getElementById") return (id: string) => els.get(id) ?? (els.set(id, make(id)), els.get(id));
        if (key === "documentElement" || key === "body") return make(String(key));
        return () => make(String(key));
      },
    });
    const window: any = { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { hash: "" }, innerWidth: 390, scrollTo() {} };
    // The page's "today" is the clock; a fixed one makes the draw repeatable.
    const [ty, tm, td] = (opt.today ?? "2026-10-21").split("-").map(Number) as [number, number, number];
    class FixedDate extends Date { constructor(...a: any[]) { if (a.length) super(...(a as [any])); else super(ty, tm - 1, td); } }
    new Function("document", "window", "localStorage", "navigator", "location", "history", "requestAnimationFrame", "setTimeout", "IntersectionObserver", "getComputedStyle", "Date", assetText("page.js"))(
      document, window, { getItem: () => null, setItem() {} }, {}, window.location, {}, () => 0, () => 0, function () { return { observe() {} }; }, () => make("computed"), FixedDate);
    // press the filter chips the way a click on them reaches the page
    for (const toggle of opt.toggles ?? []) {
      const chip = { dataset: { toggle }, setAttribute() {} };
      for (const fn of listeners["filters:click"] ?? []) fn({ target: { closest: () => chip, id: "" } });
    }
    return html;
  }

  test("the header line says where the dated weeks end and where the agenda ends", () => {
    expect(drawn(sample()).meta).toContain("covers 20 Oct–22 Nov, further ahead to 20 Apr");
    const d = sample(); d.window = { start: "2026-10-20", end: "2026-11-30" };
    expect(drawn(d).meta).toContain("covers 20 Oct–30 Nov ·");
  });

  test("the header line links to status.html with the counts, and the footer line is drawn", () => {
    const data = sample();
    data.sources_checked = [{ name: "a", url: "https://a.example", ok: true }, { name: "b", url: "https://b.example", ok: false, error: "x" }];
    const html = drawn(data);
    expect(html.meta).toContain('<a href="status.html">2 sources, 1 unreachable · build status</a>');
    expect(html.foot).toContain("Times are local, Portugal. Drive times are estimates from");
    expect(html.sources).toBeUndefined();
  });

  const ev = (over: Doc) => ({ ...first(sample(), "single"), start_date: "2026-12-01", end_date: null, dates: null, recurrence: null, date_tbc: false, ...over });
  const farData = (events: Doc[], near_end = "2026-11-22") => {
    const d = sample(); d.window = { start: "2026-10-20", near_end, end: "2027-04-20" }; d.events = events; return d;
  };

  test("the Weekend filter judges each day of a far event, and keeps an ongoing one and the undated list as the dated part does", () => {
    const d = farData([
      ev({ title_pt: "Tue first", title_en: "Tue first", kind: "recurring", dates: ["2026-12-01", "2026-12-05"], recurrence: "Tuesdays and Saturdays" }),
      ev({ title_pt: "Weekday single", title_en: "Weekday single", start_date: "2026-12-02" }),
      ev({ title_pt: "Ongoing far", title_en: "Ongoing far", kind: "ongoing", start_date: "2026-12-01", end_date: "2026-12-03" }),
      ev({ title_pt: "Tbc far", title_en: "Tbc far", date_tbc: true, start_date: "2026-12" }),
    ]);
    const all = drawn(d);
    for (const t of ["Tue first", "Weekday single", "Ongoing far"]) expect(all.list).toContain(t);
    expect(all.tbc).toContain("Tbc far");
    const we = drawn(d, { toggles: ["weekend"] });
    expect(we.list).not.toContain("Weekday single");
    // its Tuesday is gone but its Saturday is a day that qualifies: the card moves there, as a Saturday regular should
    expect(we.list).toContain("Tue first");
    expect(we.list).toContain('id="d-2026-12-05"');
    expect(all.list).toContain("again: <b>Tue first</b>");
    expect(we.list).not.toContain("again: <b>Tue first</b>");   // one qualifying date, so one card and no row
    // the card under Saturday leads with the recurrence text, never with the Tuesday it no longer sits under
    const sat = we.list!.slice(we.list!.indexOf('id="d-2026-12-05"'));
    expect(sat).toContain('<span class="line2">Tuesdays and Saturdays');
    expect(sat).not.toMatch(/line2">[^<]*1 Dec/);
    // an ongoing run opens on a weekday and still shows (its weekday opening keeps a day block while Weekend is on)
    expect(we.list).toContain("Ongoing far");
    expect(we.tbc).toContain("Tbc far");
  });

  test("a far month band names its year, and the rail link names the undated list", () => {
    const events = [ev({ title_pt: "Far one", title_en: "Far one" }), ev({ title_pt: "Far two", title_en: "Far two", start_date: "2027-01-09" }), ev({ title_pt: "Tbc", title_en: "Tbc", date_tbc: true, start_date: "2027-02" })];
    const h = drawn(farData(events));
    expect(h.list).toContain('<h2 id="band-2026-12">December 2026</h2>');
    expect(drawn(farData([ev({ title_pt: "Dec 12", title_en: "Dec 12", start_date: "2026-12-12" })], "2026-12-06")).list).toContain('<h2 id="band-2026-12">December 2026 <small>from 7 Dec</small></h2>');
    expect(h.list).toContain('<h2 id="band-2027-01">January 2027</h2>');
    expect(h.rail).toContain('<a class="ahead-link" href="#band-tbc"><b>Date to be confirmed</b><span>1 event with no day yet</span></a>');
    expect(h.tbc).toContain("February 2027, day tbc");
    // the rail names its months in a paragraph, so heading navigation meets each month once, in the list
    expect(h.rail).not.toContain("<h2");
    const d = farData(events, "2026-10-25"); d.window = { start: "2026-10-20", near_end: "2026-10-25", end: "2026-12-15" };
    const within = drawn(d);
    expect(within.list).toContain('<h2 id="band-2026-12">December 2026 <small>to 15 Dec</small></h2>');
    expect(within.list).not.toContain("2026 <small>from");
  });

  test("the grids run through the last month with a marked day, whatever the window's end", () => {
    const events = [ev({ title_pt: "Near one", title_en: "Near one", start_date: "2026-10-30" }), ev({ title_pt: "Far one", title_en: "Far one", start_date: "2027-03-20" })];
    const rail = drawn(farData(events)).rail!;
    for (const m of ["November 2026", "December 2026", "January 2027", "February 2027", "March 2027"]) expect(rail).toContain(m);
    expect(rail).not.toContain("April 2027");
    // an undated April event has no day to mark, so it does not make an empty April
    expect(drawn(farData([...events, ev({ title_pt: "Apr tbc", title_en: "Apr tbc", date_tbc: true, start_date: "2027-04" })])).rail).not.toContain("April 2027");
    // only near events: the grids end in near_end's month
    const near = drawn(farData([events[0]!])).rail!;
    expect(near).toContain("November 2026");
    expect(near).not.toContain("December 2026");
  });

  test("a far day is a live day button, a day past the window's end is not, and the label names a later year", () => {
    const events = [ev({ title_pt: "Far one", title_en: "Far one", start_date: "2026-12-12" }), ev({ title_pt: "Jan one", title_en: "Jan one", start_date: "2027-01-09" }), ev({ title_pt: "April one", title_en: "April one", start_date: "2027-04-10" })];
    const rail = drawn(farData(events)).rail!;
    expect(rail).toMatch(/data-go="2026-12-12"[^>]*aria-label="Sat 12 Dec: 1 event"/);
    expect(rail).toMatch(/data-go="2027-01-09"[^>]*aria-label="Sat 9 Jan 2027: 1 event"/);
    expect(rail).toContain('aria-label="January 2027"');
    expect(rail).toMatch(/data-go="2027-04-20"/);
    expect(rail).toContain('<span class="day-btn out" aria-hidden="true"><span class="num">21</span>');
    expect(rail).not.toMatch(/data-go="2027-04-21"/);
    // nothing in the window after 31 Dec 7th: a December day with nothing on it is still a button, as a near one is
    expect(rail).toMatch(/data-go="2026-12-31"/);
  });

  test("grid notes: the caveat under near_end's month, and where the marks stop under the last grid", () => {
    const events = [ev({ title_pt: "Near one", title_en: "Near one", start_date: "2026-10-30" }), ev({ title_pt: "Far one", title_en: "Far one", start_date: "2026-12-12" })];
    const rail = drawn(farData(events, "2026-11-22")).rail!;
    expect(rail).toContain("After 22 Nov, only what the sources already list; few list this far ahead.");
    expect(rail).toContain("No dated events after December, other than long runs and regulars; the agenda runs to 20 Apr.");
    expect(rail).not.toContain("are under Further ahead");
    expect(rail.split("grid-note").length - 1).toBe(2);
    // near_end ending the last grid's month: the end note says it, the caveat is not drawn twice
    const edge = drawn(farData([events[0]!], "2026-11-30")).rail!;
    expect(edge.split("grid-note").length - 1).toBe(1);
    expect(edge).toContain("No dated events after November");
    // a window that ends in the last grid's month has no end note
    const d = farData(events); d.window = { start: "2026-10-20", near_end: "2026-11-22", end: "2026-12-20" };
    expect(drawn(d).rail).not.toContain("No dated events after");
  });

  test("a far day has a day block of its own, in a month band, and the first one is the ahead anchor", () => {
    const events = [ev({ title_pt: "Near one", title_en: "Near one", start_date: "2026-10-30" }), ev({ title_pt: "Far one", title_en: "Far one", start_date: "2026-12-12" }), ev({ title_pt: "Far two", title_en: "Far two", start_date: "2027-02-25" })];
    const list = drawn(farData(events)).list!;
    expect(list).toContain('<section class="day" id="d-2026-12-12" data-day="2026-12-12">');
    expect(list).toContain('<section class="day" id="d-2027-02-25" data-day="2027-02-25">');
    expect(list.match(/class="band far"/g)?.length).toBe(2);
    expect(list.match(/class="band far" id="ahead" tabindex="-1"/g)?.length).toBe(1);
    expect(list.match(/id="ahead"/g)?.length).toBe(1);
    expect(list).toContain("From 23 Nov, what the sources already list. Few list this far ahead");
    // the near band does not draw a far day, and the days are in order
    expect(list.indexOf("d-2026-12-12")).toBeLessThan(list.indexOf("d-2027-02-25"));
  });

  test("a run that crosses near_end gets a row on each later day", () => {
    const events = [ev({ title_pt: "Long fair", title_en: "Long fair", kind: "multi_day", start_date: "2026-12-05", end_date: "2026-12-08", start_time: null })];
    const list = drawn(farData(events, "2026-12-06")).list!;
    expect(list).toContain("continues: <b>Long fair</b> (day 3 of 4)");
    expect(list).toContain("continues: <b>Long fair</b> (day 4 of 4)");
    expect(list.match(/<article class="card/g)?.length).toBe(1);
  });

  test("a far regular has one card and a row on its other dates; a far ongoing event sits on its opening day", () => {
    const rec = { title_pt: "Sunday market", title_en: "Sunday market", kind: "recurring", start_date: "2027-01-10", dates: ["2027-01-10", "2027-01-17", "2027-01-24", "2027-01-31"], recurrence: "Sundays from 10 Jan" };
    const h = drawn(farData([ev(rec)]));
    expect(h.list!.match(/<article class="card/g)?.length).toBe(1);
    expect(h.list!.match(/again: <b>Sunday market<\/b> \(Sundays from 10 Jan\)/g)?.length).toBe(3);
    expect(h.rail).toMatch(/data-go="2027-01-31"[^>]*aria-label="Sun 31 Jan 2027: 1 event"/);
    // with no recurrence text the row counts, without saying the series ends (the merge keeps only the first few far dates)
    const bare = drawn(farData([ev({ ...rec, recurrence: null })])).list!;
    expect(bare).toContain("again: <b>Sunday market</b> (date 2 of 4)");
    const og = drawn(farData([ev({ title_pt: "Nativity", title_en: "Nativity", kind: "ongoing", start_date: "2026-12-01", end_date: "2027-01-06", start_time: null })]));
    expect(og.list!.match(/<article class="card/g)?.length).toBe(1);
    expect(og.list).toContain("opens · until 6 Jan");
    expect(og.blocks ?? "").not.toContain("Nativity");
  });

  test("the strip ends at near_end and carries one chip a far month, and one for the undated list", () => {
    const events = [
      ev({ title_pt: "Dec one", title_en: "Dec one", start_date: "2026-12-12" }), ev({ title_pt: "Dec two", title_en: "Dec two", start_date: "2026-12-13" }),
      ev({ title_pt: "Jan Sat", title_en: "Jan Sat", start_date: "2027-01-09" }), ev({ title_pt: "Tbc", title_en: "Tbc", date_tbc: true, start_date: "2026-12" }),
    ];
    const strip = drawn(farData(events)).strip!;
    expect(strip.match(/data-go="/g)?.length).toBe(34);   // 20 Oct to 22 Nov
    expect(strip).toContain('href="#band-2026-12"');
    expect(strip).toContain('aria-label="December 2026: 2 events"');
    expect(strip).toContain('aria-label="January 2027: 1 event"');
    expect(strip).toContain('href="#band-tbc"');
    // Weekend empties December: no chip for a month with nothing to show
    const we = drawn(farData([ev({ title_pt: "Dec Mon", title_en: "Dec Mon", start_date: "2026-12-14" }), events[2]!]), { toggles: ["weekend"] }).strip!;
    expect(we).not.toContain("band-2026-12");
    expect(we).toContain("band-2027-01");
    // the empty state draws none
    expect(drawn(farData(events), { toggles: ["picks"] }).strip).not.toContain("band-20");
  });

  test("a run that began in the coming weeks is counted in a far month's chip, as its rows there are", () => {
    const events = [ev({ title_pt: "Long fair", title_en: "Long fair", kind: "multi_day", start_date: "2026-12-05", end_date: "2026-12-08" }), ev({ title_pt: "Dec one", title_en: "Dec one", start_date: "2026-12-12" })];
    expect(drawn(farData(events, "2026-12-06")).strip).toContain('aria-label="December 2026: 2 events"');
    // only its continues rows in December: the chip still names it, never "0 events"
    expect(drawn(farData([events[0]!], "2026-12-06")).strip).toContain('aria-label="December 2026: 1 event"');
  });

  test("each month grid is one tab stop, in the markup, with a skip link before the grids", () => {
    const events = [ev({ title_pt: "Dec one", title_en: "Dec one", start_date: "2026-12-12" }), ev({ title_pt: "Mar one", title_en: "Mar one", start_date: "2027-03-20" })];
    const rail = drawn(farData(events)).rail!;
    const grids = rail.split('class="grid"').length - 1;
    expect(grids).toBe(6);
    expect(rail.match(/tabindex="0"/g)?.length).toBe(grids);
    expect(rail.match(/tabindex="-1"/g)!.length).toBeGreaterThan(150);
    // the stop is today in its grid (the harness's clock is 21 Oct), the first day not past in the others
    expect(rail).toMatch(/data-go="2026-10-21" tabindex="0"/);
    expect(rail).toMatch(/data-go="2026-12-01" tabindex="0"/);
    expect(rail).toMatch(/data-go="2027-03-01" tabindex="0"/);
    expect(rail.indexOf('<a class="skip-link" href="#main">')).toBe(0);
    // the strip's buttons are not in that order
    expect(drawn(farData(events)).strip).not.toContain("tabindex");
  });

  test("Date to be confirmed is the one list: near and far, by the month the source gave, with a deterministic order", () => {
    const events = [
      ev({ title_pt: "March", title_en: "March", date_tbc: true, start_date: "2027-03" }), ev({ title_pt: "Nodate", title_en: "Nodate", date_tbc: true, start_date: null }),
      ev({ title_pt: "Dec full", title_en: "Dec full", date_tbc: true, start_date: "2026-12-12" }), ev({ title_pt: "Nov tbc", title_en: "Nov tbc", date_tbc: true, start_date: "2026-11" }),
    ];
    const t = drawn(farData(events)).tbc!;
    expect(t).toContain("Listed by a source, but with no day to put on the calendar yet.");
    expect(t).toContain("Date to be confirmed <small>4</small>");
    expect(t).toContain("November, day tbc");
    expect(t).toContain("March 2027, day tbc");
    expect(t).toContain("Sat 12 Dec, to be confirmed");
    expect(t).toContain("date tbc");
    const order = ["Nov tbc", "Dec full", "March", "Nodate"].map((x) => t.indexOf(">" + x + "<") >= 0 ? t.indexOf(">" + x + "<") : t.indexOf(x));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // none of them is on the calendar
    const rail = drawn(farData(events)).rail!;
    expect(rail).not.toContain("March 2027");
  });

  test("with nothing matching, the empty-state card stands alone for the dated part and the undated list keeps its hidden line", () => {
    const events = [ev({ title_pt: "Near one", title_en: "Near one", start_date: "2026-10-30" }), ev({ title_pt: "Far one", title_en: "Far one" }), ev({ title_pt: "Tbc", title_en: "Tbc", date_tbc: true, start_date: "2026-12" })];
    const h = drawn(farData(events), { toggles: ["picks"] });
    expect(h.list).toContain("No events match these filters.");
    expect(h.tbc).not.toContain("in the agenda above hidden");
    expect(h.tbc).toContain("Date to be confirmed");
    expect(h.tbc).toContain("Nothing without a date matches your filters.");
    expect(h.tbc).toContain("1 more event with a date to be confirmed hidden by your filters");
    expect((h.list!.match(/Clear filters/g) ?? []).length).toBe(1);
    // with something still showing, the dated part reports what its filters hide: the near and the far day alike
    const w = drawn(farData([ev({ title_pt: "Near one", title_en: "Near one", start_date: "2026-10-28" }), ev({ title_pt: "Near two", title_en: "Near two", start_date: "2026-10-30" }), ev({ title_pt: "Far wed", title_en: "Far wed", start_date: "2026-12-02" })]), { toggles: ["weekend"] });
    expect(w.tbc).toContain("2 more events in the agenda above hidden by your filters");
    expect(w.list).toContain("Nothing after 22 Nov matches your filters.");
    // no undated list, no undated hidden line
    expect(w.tbc).not.toContain("Date to be confirmed");
  });

  test("an old file without near_end draws the grids it always did, and nothing of the far part", () => {
    const d = farData([ev({ title_pt: "Near one", title_en: "Near one", start_date: "2026-11-10" })]); d.window = { start: "2026-10-20", end: "2026-11-30" };
    const h = drawn(d);
    expect(h.rail).toContain("November 2026");
    expect(h.rail).not.toContain("December 2026");
    for (const k of ["list", "rail", "strip"]) {
      expect(h[k]).not.toContain("band far");
      expect(h[k]).not.toContain("grid-note");
      expect(h[k]).not.toContain("ahead-chip");
    }
  });

  test("a page opened after near_end still says it is out of date", () => {
    expect(drawn(farData([ev({ title_pt: "Far one", title_en: "Far one" })]), { today: "2026-12-20" }).notice).toContain("out of date");
    expect(drawn(farData([ev({ title_pt: "Far one", title_en: "Far one" })])).notice ?? "").not.toContain("out of date");
  });

  test("text from a source is escaped in the far rows", () => {
    const rec = { title_pt: "<img src=x onerror=alert(1)>", title_en: "<img src=x onerror=alert(1)>", kind: "recurring", start_date: "2027-01-10", dates: ["2027-01-10", "2027-01-17"], recurrence: "<u>" };
    const h = drawn(farData([ev(rec)]));
    for (const k of ["list", "rail", "tbc", "strip"]) {
      expect(h[k] ?? "").not.toContain("<img");
      expect(h[k] ?? "").not.toContain("<u>");
    }
    expect(h.list).toContain("again: <b>&lt;img src=x onerror=alert(1)&gt;</b> (&lt;u&gt;)");
  });

  test("the Big event tag is on every card from 50 minutes away, near or far", () => {
    const events = [ev({ title_pt: "Near big", title_en: "Near big", start_date: "2026-10-30", drive_min: 60 }), ev({ title_pt: "Near small", title_en: "Near small", start_date: "2026-10-31", drive_min: 10 }), ev({ title_pt: "Far big", title_en: "Far big", drive_min: 55 })];
    const list = drawn(farData(events)).list!;
    expect(list.match(/far-tag/g)?.length).toBe(2);
    expect(list.indexOf("far-tag")).toBeLessThan(list.indexOf("Near small"));
  });

  test("a near regular's dots stop at near_end: no far grid or dot for a day the list has no block for", () => {
    // merge trims a regular's dates only when recurrence has text, so a bare one can reach the page with far dates
    const reg = ev({ title_pt: "Bare regular", title_en: "Bare regular", kind: "recurring", start_date: "2026-10-24", dates: ["2026-10-24", "2026-11-21", "2027-02-13"], recurrence: null });
    const h = drawn(farData([reg]));
    expect(h.rail).not.toContain("February 2027");
    expect(h.rail).not.toContain("December 2026");
    expect(h.rail).toMatch(/data-go="2026-11-21"[^>]*aria-label="Sat 21 Nov: 1 event"/);
    expect(h.blocks).toContain("Bare regular");
    // with a far single in February the grid is there, but the regular's February date is no dot on it
    const f = drawn(farData([reg, ev({ title_pt: "Feb one", title_en: "Feb one", start_date: "2027-02-20" })]));
    expect(f.rail).toMatch(/data-go="2027-02-13"[^>]*aria-label="Sat 13 Feb 2027: no events"/);
    expect(f.list).not.toContain("d-2027-02-13");
  });

  test("a far month's chip counts the events on its days, again and continues rows too, so it never reads 0", () => {
    const market = ev({ title_pt: "Market", title_en: "Market", kind: "recurring", start_date: "2026-12-27", dates: ["2026-12-27", "2027-01-03", "2027-01-10"], recurrence: "Sundays" });
    const strip = drawn(farData([market])).strip!;
    expect(strip).toContain('aria-label="January 2027: 1 event"');
    expect(strip).not.toContain('<span class="n">0</span>');
    const run = ev({ title_pt: "Year run", title_en: "Year run", kind: "multi_day", start_date: "2026-12-30", end_date: "2027-01-02" });
    expect(drawn(farData([run])).strip).toContain('aria-label="January 2027: 1 event"');
  });

  test("an undated event whose month, or the day it gave, is past leaves the undated list", () => {
    const events = [
      ev({ title_pt: "Oct tbc", title_en: "Oct tbc", date_tbc: true, start_date: "2026-10" }), ev({ title_pt: "Day gone", title_en: "Day gone", date_tbc: true, start_date: "2026-11-01" }),
      ev({ title_pt: "Nov tbc", title_en: "Nov tbc", date_tbc: true, start_date: "2026-11" }), ev({ title_pt: "Day ahead", title_en: "Day ahead", date_tbc: true, start_date: "2026-11-05" }),
      ev({ title_pt: "Nodate", title_en: "Nodate", date_tbc: true, start_date: null }),
    ];
    const h = drawn(farData(events), { today: "2026-11-05" });
    for (const t of ["Nov tbc", "Day ahead", "Nodate"]) expect(h.tbc).toContain(t);
    for (const t of ["Oct tbc", "Day gone"]) expect(h.tbc).not.toContain(t);
    expect(h.tbc).toContain("Date to be confirmed <small>3</small>");
    expect(h.strip).toContain('Date tbc <span class="n">3</span>');
    expect(h["result-line"]).toContain("3 of 3 events");
  });

  test("the dated hidden line counts what the agenda above hides, a regular kept by its recurrence text included", () => {
    const events = [
      ev({ title_pt: "Sunday text", title_en: "Sunday text", kind: "recurring", start_date: "2026-10-27", dates: ["2026-10-27", "2026-11-03"], recurrence: "Tuesdays, and some Sundays" }),
      ev({ title_pt: "Tuesday only", title_en: "Tuesday only", kind: "recurring", start_date: "2026-10-27", dates: ["2026-10-27", "2026-11-03"], recurrence: "Tuesdays" }),
      ev({ title_pt: "Weekday one", title_en: "Weekday one", start_date: "2026-10-28" }), ev({ title_pt: "Sat one", title_en: "Sat one", start_date: "2026-10-24" }),
    ];
    const h = drawn(farData(events), { toggles: ["weekend"] });
    expect(h.blocks).toContain("Sunday text");
    expect(h.blocks).not.toContain("Tuesday only");
    expect(h["result-line"]).toContain("2 of 4 events match");
    expect(h.tbc).toContain("2 more events in the agenda above hidden by your filters");
  });

  test("a grid whose days are all past has no tab stop, and no past day is one", () => {
    const events = [ev({ title_pt: "Dec one", title_en: "Dec one", start_date: "2026-12-12" })];
    const rail = drawn(farData(events, "2026-11-30"), { today: "2026-11-05" }).rail!;
    expect(rail.match(/tabindex="0"/g)?.length).toBe(2);   // November and December; October is behind us
    expect(rail).toMatch(/data-go="2026-11-05" tabindex="0"/);
    expect(rail).not.toMatch(/past"[^>]*tabindex="0"/);
  });

  test("the unfiltered counts are worked out once, from one filter factory", () => {
    const js = assetText("page.js");
    expect(js).toContain("ALL || (ALL = sections(NOFILTER))");
    expect(js).not.toContain("all = sections(NOFILTER)");
    expect(js.match(/\{ cats: new Set\(\)/g)?.length).toBe(1);
  });
});
