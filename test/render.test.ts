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
    expect(said).toMatch(/^wrote .*: 21 events, from 2026-10-20 to 2027-04-20\n$/);
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
  test("the no-script line says where the dated weeks end only when there is a Further ahead", () => {
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

  test("test_the_dated_part_ends_at_near_end_and_a_lost_near_end_falls_back_to_the_window", () => {
    expect(js).toContain("WIN.near_end");
    expect(js).toContain("var stale = realToday > NEAR;");
    // neither the strip nor the grids run to the far end, and "Later" is not open-ended
    expect(/\bd <= WIN\.end/.test(js)).toBe(false);
    expect(/\bcur <= WIN\.end/.test(js)).toBe(false);
    expect(js).not.toContain("9999-12-31");
    // a near_end outside the window is ignored rather than trusted
    expect(js).toContain("WIN.near_end >= WIN.start && WIN.near_end <= WIN.end ? WIN.near_end : WIN.end");
  });

  test("test_further_ahead_and_the_hidden_lines_are_drawn", () => {
    expect(js).toContain("Further ahead");
    expect(js).toContain("hidden by your filters");
    expect(js).toContain('getElementById("ahead")');
    expect(assetText("page.css")).toContain("#ahead");
    expect(htmlOf(sample())).toContain('<div id="ahead" tabindex="-1"></div>');
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

  test("the header line says where the dated weeks end and where Further ahead ends", () => {
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

  test("the Weekend filter on Further ahead judges a recurring event by its next date, and keeps ongoing and tbc as the dated part does", () => {
    const d = farData([
      ev({ title_pt: "Tue first", title_en: "Tue first", kind: "recurring", dates: ["2026-12-01", "2026-12-05"], recurrence: "Tuesdays and Saturdays" }),
      ev({ title_pt: "Sat first", title_en: "Sat first", kind: "recurring", dates: ["2026-12-05", "2026-12-08"], recurrence: "Saturdays and Tuesdays" }),
      ev({ title_pt: "Weekday single", title_en: "Weekday single", start_date: "2026-12-02" }),
      ev({ title_pt: "Ongoing far", title_en: "Ongoing far", kind: "ongoing", start_date: "2026-12-01", end_date: "2026-12-03" }),
      ev({ title_pt: "Tbc far", title_en: "Tbc far", date_tbc: true, start_date: "2026-12" }),
    ]);
    const all = drawn(d).ahead!;
    for (const t of ["Tue first", "Sat first", "Weekday single", "Ongoing far", "Tbc far"]) expect(all).toContain(t);
    const we = drawn(d, { toggles: ["weekend"] }).ahead!;
    expect(we).not.toContain("Tue first");
    expect(we).not.toContain("Weekday single");
    for (const t of ["Sat first", "Ongoing far", "Tbc far"]) expect(we).toContain(t);
  });

  test("Further ahead names the year only when its range crosses a year boundary", () => {
    const events = [ev({ title_pt: "Far one", title_en: "Far one" })];
    const crossing = drawn(farData(events, "2026-11-22"));
    expect(crossing.ahead).toContain("23 Nov 2026–20 Apr 2027");
    expect(crossing.rail).toContain("to 20 Apr 2027</span>");
    const d = farData(events, "2026-10-25"); d.window = { start: "2026-10-20", near_end: "2026-10-25", end: "2026-12-15" };
    const within = drawn(d);
    expect(within.ahead).toContain("26 Oct–15 Dec ·");
    expect(within.ahead).not.toContain("26 Oct 2026");
    expect(within.rail).toContain("to 15 Dec</span>");
  });

  test("the last month grid says where Further ahead starts, also when the dated part ends on a month end", () => {
    const events = [ev({ title_pt: "Near one", title_en: "Near one", start_date: "2026-10-30" }), ev({ title_pt: "Far one", title_en: "Far one" })];
    expect(drawn(farData(events, "2026-11-30")).rail).toContain("Events after 30 Nov are under Further ahead.");
    expect(drawn(farData(events, "2026-11-22")).rail).toContain("Events after 22 Nov are under Further ahead.");
    const rail = drawn(farData(events, "2026-11-30")).rail!;
    expect(rail.split("grid-note").length - 1).toBe(1);
    expect(drawn(farData([events[0]!], "2026-11-30")).rail).not.toContain("grid-note");
  });

  test("with nothing matching, the empty-state card stands alone for the dated part and Further ahead keeps its hidden line", () => {
    const events = [ev({ title_pt: "Near one", title_en: "Near one", start_date: "2026-10-30" }), ev({ title_pt: "Far one", title_en: "Far one" })];
    const h = drawn(farData(events), { toggles: ["picks"] });
    expect(h.list).toContain("No events match these filters.");
    expect(h.tbc).not.toContain("hidden by your filters");
    expect(h.ahead).toContain("1 more event further ahead hidden by your filters");
    expect((h.list!.match(/Clear filters/g) ?? []).length).toBe(1);
    // with something still showing, the dated part reports what its filters hide
    const w = drawn(farData([ev({ title_pt: "Near one", title_en: "Near one", start_date: "2026-10-28" }), ev({ title_pt: "Near two", title_en: "Near two", start_date: "2026-10-30" })]), { toggles: ["weekend"] });
    expect(w.tbc).toContain("1 more event in the coming weeks hidden by your filters");
  });

  test("the unfiltered counts are worked out once, from one filter factory", () => {
    const js = assetText("page.js");
    expect(js).toContain("ALL || (ALL = sections(NOFILTER))");
    expect(js).not.toContain("all = sections(NOFILTER)");
    expect(js.match(/\{ cats: new Set\(\)/g)?.length).toBe(1);
  });
});
