// Port of tests/python/test_runner.py: RunHost, Encoding (the runner part), Pool, Contract, Follow, FollowContract,
// Interrupt, Main, Config, Towns, SourceList. The urllib/ssl/fetch classes (Redirects, FetchFollow, SslContextTests and
// the fetch tests of Encoding) are in net.test.ts. Nothing here reaches the network: fetch, sleep and the clock are fakes.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADAPTERS } from "../src/adapters/index.ts";
import { AdapterError } from "../src/adapters/types.ts";
import type { Adapter, Page, ParseResult, Request, Source } from "../src/adapters/types.ts";
import {
  collectAll, defaultEnd, followRequests, lisbonToday, loadConfig, main, runHost, type Outcome,
} from "../src/collect.ts";
import type { CollectDeps, MainDeps } from "../src/collect.ts";
import { HttpError, NetworkError, RedirectRefused, TimeoutError, garbled } from "../src/net.ts";
import type { FetchResult, Fetcher } from "../src/net.ts";
import { hostOf } from "../src/url.ts";
import { ROOT, WINDOW } from "./helpers.ts";

const enc = new TextEncoder();
const PAGE = enc.encode(`<p>${"evento ".repeat(60)}</p>`);
const ok = (body: Uint8Array = PAGE, contentType: string | null = null): FetchResult => ({ status: 200, body, contentType });
const req = (url: string, data: Uint8Array | null = null): Request => ({ url, data });
const http = (code: number) => new HttpError(code, "x");

/** A clock that only moves when something sleeps or a fetch takes time. */
class Clock {
  now = 100.0;
  sleeps: number[] = [];
  constructor(public took = 0.0) {}
  clock = () => this.now;
  sleep = async (seconds: number) => { this.sleeps.push(seconds); this.now += seconds; };
  fetch: Fetcher = async () => { this.now += this.took; return ok(); };
}

const noSleep = async () => {};
const textOf = (page: Page) => new TextDecoder().decode(page.body).replace(/<[^>]*>/g, "").trim();

/** Stands in for the text adapter (a stub until T8): the visible text, and an error when it is too short, like the real one. */
const fakeText: Adapter = {
  parse(_source, pages) {
    const text = textOf(pages[0]!);
    if (text.length < 200) throw new AdapterError("only a little text; the layout may have changed");
    return { items: [], past: [], text, truncated: false, note: null };
  },
};
const withText = (text: Adapter): Record<string, Adapter> => ({ ...ADAPTERS, text });

/** common.default_details, for the tests that need the default step: the title of an event page. */
const fakeDefaultDetails: Adapter["details"] = (_source, pages) => pages.map((p) => ({
  url: p.url, title: /<title>(.*?) - /.exec(new TextDecoder().decode(p.body))?.[1] ?? null,
  start: null, end: null, venue: null, excerpt: null,
}));

/** A threading.Barrier(parties, timeout) as promises. */
class Barrier {
  private waiting: (() => void)[] = [];
  private broken = false;
  constructor(private parties: number, private timeoutMs: number) {}
  wait(): Promise<void> {
    if (this.broken) return Promise.reject(new Error("BrokenBarrierError"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.broken = true; reject(new Error("BrokenBarrierError")); }, this.timeoutMs);
      this.waiting.push(() => { clearTimeout(timer); resolve(); });
      if (this.waiting.length >= this.parties) { const all = this.waiting; this.waiting = []; all.forEach((f) => f()); }
    });
  }
}

function runHostWith(jobs: [string, Request[]][], fetch: Fetcher, delay = 2.0, clock = new Clock()) {
  return { clock, promise: runHost("h.example", jobs, { fetch, sleep: clock.sleep, clock: clock.clock, delay }) };
}
const jobs = (...names: string[]): [string, Request[]][] => names.map((n) => [n, [req("https://h.example/" + n)]]);

describe("RunHost", () => {
  test("test_requests_are_spaced_from_the_end_of_the_previous_response", async () => {
    const clock = new Clock(0.5);
    const outcomes = await runHostWith(jobs("a", "b", "c"), clock.fetch, 2.0, clock).promise;
    expect(clock.sleeps).toEqual([2.0, 2.0]);
    expect(Object.values(outcomes).map((o) => o.error)).toEqual([null, null, null]);
  });

  test("test_time_spent_between_requests_counts_towards_the_delay", async () => {
    const clock = new Clock();
    await runHost("h.example", jobs("a", "b"), {
      fetch: clock.fetch, sleep: clock.sleep, clock: clock.clock, delay: 2.0,
      onDone: () => { clock.now += 0.5; return undefined; },
    });
    expect(clock.sleeps).toEqual([1.5]);
  });

  test("test_one_source_can_make_several_requests_with_a_body", async () => {
    const clock = new Clock();
    const seen: [string, Uint8Array | null][] = [];
    const fetch: Fetcher = async (url, data) => { seen.push([url, data]); return ok(); };
    const many: [string, Request[]][] = [["a", [req("https://h.example/1", enc.encode("x=1")), req("https://h.example/2")]]];
    const outcomes = await runHostWith(many, fetch, 2.0, clock).promise;
    expect(seen).toEqual([["https://h.example/1", enc.encode("x=1")], ["https://h.example/2", null]]);
    expect(outcomes.a!.pages!.length).toBe(2);
    expect(clock.sleeps).toEqual([2.0]);
  });

  test("test_a_refusal_timeout_or_connection_error_skips_the_rest_of_the_host", async () => {
    const errors = [http(403), http(429), http(503), new TimeoutError("timed out"),
      new NetworkError("refused"), new NetworkError("reset", "ECONNRESET")];
    for (const error of errors) {
      const calls: string[] = [];
      const fetch: Fetcher = async (url) => { calls.push(url); throw error; };
      const outcomes = await runHostWith(jobs("a", "b", "c"), fetch).promise;
      expect(calls.length).toBe(1);
      expect(outcomes.a!.error).not.toBeNull();
      for (const name of ["b", "c"]) {
        expect(outcomes[name]!.error).toBe("skipped: h.example refused or did not answer");
        expect(outcomes[name]!.pages).toBeNull();
      }
    }
  });

  test("test_a_404_or_other_failure_fails_only_its_source", async () => {
    for (const error of [http(404), new Error("down")]) {
      const calls: string[] = [];
      const fetch: Fetcher = async (url) => { calls.push(url); if (url.endsWith("a")) throw error; return ok(); };
      const outcomes = await runHostWith(jobs("a", "b", "c"), fetch).promise;
      expect(calls.length).toBe(3);
      expect(outcomes.a!.error).not.toBeNull();
      expect(outcomes.b!.error).toBeNull();
      expect(outcomes.c!.error).toBeNull();
    }
  });

  test("test_a_failed_request_fails_its_source_and_stops_its_other_requests", async () => {
    const calls: string[] = [];
    const fetch: Fetcher = async (url) => { calls.push(url); if (url.endsWith("1")) throw http(404); return ok(); };
    const two: [string, Request[]][] = [["a", [req("https://h.example/1"), req("https://h.example/2")]],
      ["b", [req("https://h.example/3")]]];
    const outcomes = await runHostWith(two, fetch).promise;
    expect(calls).toEqual(["https://h.example/1", "https://h.example/3"]);
    expect(outcomes.a!.error).toBe("HTTP 404 x");
    expect(outcomes.a!.status).toBe(404);
    expect(outcomes.b!.error).toBeNull();
  });

  test("test_on_done_is_called_for_every_source_in_turn", async () => {
    const done: string[] = [];
    const clock = new Clock();
    await runHost("h.example", jobs("a", "b"), {
      fetch: clock.fetch, sleep: clock.sleep, clock: clock.clock, delay: 1.0, onDone: (name) => { done.push(name); return undefined; },
    });
    expect(done).toEqual(["a", "b"]);
  });
});

describe("Encoding", () => {
  const runOne = (body: Uint8Array, contentType: string | null = null) => {
    const clock = new Clock();
    return runHost("h.example", [["a", [req("u")]]], {
      fetch: async () => ok(body, contentType), sleep: clock.sleep, clock: clock.clock, delay: 2.0,
    });
  };
  const gzipBytes = () => new Uint8Array(Bun.gzipSync(enc.encode("<p>Concerto no Cineteatro. ".repeat(40))));

  test("test_garbled_text_fails_its_source", async () => {
    const body = new Uint8Array(900);
    for (let i = 0; i < body.length; i++) body[i] = i % 9;
    const outcomes = await runOne(body);
    expect(outcomes.a!.error).toBe("unreadable response (binary or garbled)");
    expect(outcomes.a!.pages).toBeNull();
  });

  test("test_normal_text_is_unaffected", async () => {
    const outcomes = await runOne(PAGE, "text/html; charset=utf-8");
    expect(outcomes.a!.error).toBeNull();
    expect(garbled(enc.encode("Olá, São João – ação"), null)).toBe(false);
  });

  test("test_undecoded_gzip_reaching_the_runner_fails_the_source_as_unreadable", async () => {
    // run_host receives what fetch returns; fetch has already inflated, so compressed bytes arriving here mean an
    // encoding it could not undo.
    const outcomes = await runOne(gzipBytes(), "text/html; charset=utf-8");
    expect(outcomes.a!.error).toBe("unreadable response (binary or garbled)");
    expect(outcomes.a!.pages).toBeNull();
  });
});

const sources = (...names: string[]): Source[] => names.map((n) => ({
  name: n, label: n, adapter: "text", town: "T", group: "g", url: `https://${n.split("-")[0]}.example/page`,
}));
const collect = (list: Source[], delays: Record<string, { delay?: number }>, defaultDelay: number, deps: CollectDeps) =>
  collectAll(list, WINDOW, delays, defaultDelay, { adapters: withText(fakeText), report: () => {}, ...deps });

describe("Pool", () => {
  test("test_results_follow_the_order_of_the_sources_whatever_finishes_first", async () => {
    const list = sources("a-1", "b-1", "a-2", "c-1", "b-2");
    for (const maxWorkers of [1, 3, 8]) {
      const lines: string[] = [];
      const results = await collect(list, {}, 0, {
        fetch: async (url) => { if (url.includes("a.example")) await Bun.sleep(5); return ok(); },
        sleep: noSleep, clock: () => 0.0, maxWorkers, report: (l) => lines.push(l),
      });
      expect(results.map((r) => r.name)).toEqual(list.map((s) => s.name));
      expect(lines.length).toBe(5);
      expect(results.every((r) => r.ok)).toBe(true);
    }
  });

  test("test_a_refused_host_does_not_touch_the_others", async () => {
    const results = await collect(sources("a-1", "b-1", "a-2"), {}, 0, {
      fetch: async (url) => { if (url.includes("a.example")) throw http(403); return ok(); },
      sleep: noSleep, clock: () => 0.0, maxWorkers: 2,
    });
    expect(results.map((r) => r.ok)).toEqual([false, true, false]);
    expect(results[2]!.error).toBe("skipped: a.example refused or did not answer");
    expect(results.map((r) => r.refused === true)).toEqual([true, false, true]);
  });

  test("a plain error is not a refusal, and the index (not the group file) says which sources were refused", async () => {
    const r = await runMain(["--only", "cineteatro", "mcr-caldas", "cm-peniche"], {
      fetch: async (url) => { if (url.includes("mcr.pt")) throw http(403); if (url.includes("cineteatrorm")) throw http(404); return ok(); },
    });
    const byName = Object.fromEntries(r.read("index.json").sources.map((s: any) => [s.name, s]));
    expect(byName["mcr-caldas"].refused).toBe(true);
    expect(byName["cineteatro"].refused).toBe(false);
    expect(JSON.stringify(r.read("oeste-norte.json"))).not.toContain("refused");
  });

  test("test_the_slowest_host_is_submitted_first", async () => {
    const started: (string | null)[] = [];
    await collect(sources("a-1", "b-1", "b-2", "c-1"), { "c.example": { delay: 15 } }, 1.5, {
      fetch: async (url) => { started.push(hostOf(url)); return ok(); }, sleep: noSleep, clock: () => 0.0, maxWorkers: 1,
    });
    expect(started[0]).toBe("c.example");
    expect(started.slice(1)).toEqual(["b.example", "b.example", "a.example"]);
  });

  test("test_the_host_delay_comes_from_the_table_else_the_default", async () => {
    const clock = new Clock();
    await collect(sources("a-1", "a-2", "v-1", "v-2"), { "v.example": { delay: 15 } }, 1.5, {
      fetch: clock.fetch, sleep: clock.sleep, clock: clock.clock, maxWorkers: 1,
    });
    expect([...clock.sleeps].sort((a, b) => a - b)).toEqual([1.5, 15]);
  });

  test("test_an_adapter_that_cannot_read_its_pages_fails_only_its_source", async () => {
    const results = await collect(sources("a-1", "b-1"), {}, 0, {
      fetch: async (url) => ok(url.includes("a.example") ? enc.encode("<p>Ola</p>") : PAGE),
      sleep: noSleep, clock: () => 0.0, maxWorkers: 2,
    });
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.error).toContain("layout may have changed");
    expect(results[1]!.ok).toBe(true);
  });
});

describe("Contract", () => {
  const source = (name = "a-1", host = "a.example"): Source =>
    ({ name, label: name, adapter: "text", town: "T", group: "g", url: `https://${host}/page` });
  const run = (list: Source[], deps: CollectDeps = {}, adapters = withText(fakeText)) =>
    collectAll(list, WINDOW, {}, 0, { fetch: async () => ok(), sleep: noSleep, clock: () => 0.0, maxWorkers: 2, report: () => {}, adapters, ...deps });
  const fake = (parsed: unknown, requests?: Request[]) => withText({
    parse: () => parsed as ParseResult, ...(requests ? { requests: () => requests } : {}),
  });

  test("test_two_hosts_are_fetched_at_the_same_time", async () => {
    const barrier = new Barrier(2, 5000);
    const results = await run([source("a-1", "a.example"), source("b-1", "b.example")],
      { fetch: async () => { await barrier.wait(); return ok(); } }); // passes only when both hosts are inside fetch together
    expect(results.map((r) => r.ok)).toEqual([true, true]);
  });

  test("test_one_worker_cannot_overlap_two_hosts", async () => {
    const barrier = new Barrier(2, 200);
    const results = await run([source("a-1", "a.example"), source("b-1", "b.example")],
      { fetch: async () => { await barrier.wait(); return ok(); }, maxWorkers: 1 });
    expect(results.map((r) => r.ok)).toEqual([false, false]);
  });

  test("test_a_malformed_adapter_result_fails_only_its_source", async () => {
    const bad: unknown[] = [
      "not a dict", { items: "x" }, { items: ["x"] }, { items: [], past: {} },
      { items: [], text: 5 }, { items: [], truncated: "yes" }, { items: [], note: [] },
    ];
    for (const parsed of bad) {
      const results = await run([source()], {}, fake(parsed));
      expect(results[0]!.ok).toBe(false);
      expect(results[0]!.error).toBe("adapter returned a malformed result");
      expect(results[0]!.items).toEqual([]);
    }
  });

  test("test_a_well_formed_result_passes", async () => {
    const results = await run([source()], {}, fake({ items: [{ title: "x" }], past: [], text: null, truncated: false, note: "n" }));
    expect(results[0]!.ok).toBe(true);
    expect(results[0]!.items).toEqual([{ title: "x" }] as never);
  });

  test("test_a_request_to_another_host_fails_the_source_and_is_not_made", async () => {
    const called: string[] = [];
    const results = await run([source()], { fetch: async (url) => { called.push(url); return ok(); } },
      fake({ items: [] }, [req("https://evil.example/x")]));
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.error).toContain("evil.example");
    expect(called).toEqual([]);
  });

  test("test_a_request_to_its_own_host_is_fine", async () => {
    expect((await run([source()], {}, fake({ items: [] }, [req("https://a.example/other")])))[0]!.ok).toBe(true);
  });

  test("test_a_stopped_host_makes_no_more_requests", async () => {
    const stop = new AbortController();
    stop.abort();
    const calls: string[] = [];
    const outcomes = await runHost("h.example", [["a", [req("https://h.example/a")]]], {
      fetch: async (url) => { calls.push(url); return ok(); }, sleep: noSleep, clock: () => 0.0, delay: 1.0, signal: stop.signal,
    });
    expect([calls, outcomes]).toEqual([[], {}]);
  });

  test("test_the_stop_is_checked_after_the_wait_too", async () => {
    const stop = new AbortController();
    const calls: string[] = [];
    const clock = new Clock();
    await runHost("h.example", [["a", [req("https://h.example/a"), req("https://h.example/b")]]], {
      fetch: async (url) => { calls.push(url); return ok(); }, sleep: async () => stop.abort(), clock: clock.clock, delay: 5.0,
      signal: stop.signal,
    });
    expect(calls).toEqual(["https://h.example/a"]);
  });
});

const EVENT = enc.encode(`<html><head><title>Fado - Teatro</title><meta property="og:title" content="Fado"></head><body><h1>Fado</h1><p>${"noite ".repeat(30)}</p></body></html>`);

describe("Follow", () => {
  /** jobs is [(name, list url)]; follows {name: [urls]}. */
  async function follow(list: [string, string][], follows: Record<string, string[]>,
    opts: { fetch?: Fetcher; followFetch?: Fetcher; delay?: number; signal?: AbortSignal } = {}) {
    const clock = new Clock();
    const calls: string[] = [];
    const got: Record<string, string[]> = {};
    const fetching: Fetcher = async (url, data) => { calls.push(url); return (opts.fetch ?? clock.fetch)(url, data); };
    const outcomes = await runHost("h.example", list.map(([n, u]) => [n, [req(u)]] as [string, Request[]]), {
      fetch: fetching, sleep: clock.sleep, clock: clock.clock, delay: opts.delay ?? 2.0, signal: opts.signal,
      onDone: (name) => (follows[name] ?? []).map((u) => req(u)),
      followFetch: opts.followFetch && (async (url, data) => { calls.push(url); return opts.followFetch!(url, data); }),
      onFollowed: (name, pages) => { got[name] = pages.map((p) => p.url); },
    });
    return { clock, calls, got, outcomes };
  }

  test("test_all_list_pages_come_first_then_the_event_pages_once_each", async () => {
    const list: [string, string][] = [["a", "https://h.example/la"], ["b", "https://h.example/lb"]];
    const follows = { a: ["https://h.example/e1", "https://h.example/e2"], b: ["https://h.example/e2", "https://h.example/e3"] };
    const { clock, calls, got } = await follow(list, follows);
    expect(calls.map((u) => u.split("/").pop())).toEqual(["la", "lb", "e1", "e2", "e3"]);
    expect(got).toEqual({ a: ["https://h.example/e1", "https://h.example/e2"], b: ["https://h.example/e2", "https://h.example/e3"] });
    expect(clock.sleeps).toEqual([2.0, 2.0, 2.0, 2.0]);
  });

  test("test_a_page_carries_its_final_url_when_the_fetch_gives_one", async () => {
    const { got } = await follow([["a", "https://h.example/la"]], { a: ["https://h.example/e1"] },
      { followFetch: async (url) => ({ ...ok(), url: url + "/final" }) });
    expect(got).toEqual({ a: ["https://h.example/e1/final"] });
  });

  test("test_a_failed_event_page_is_skipped_and_the_rest_are_fetched", async () => {
    const errors: Record<string, Error> = { e1: http(404), e2: new RedirectRefused("elsewhere"), e3: new Error("odd") };
    const fetch: Fetcher = async (url) => { const e = errors[url.slice(-2)]; if (e) throw e; return ok(); };
    const follows = { a: ["e1", "e2", "e3", "e4"].map((n) => "https://h.example/" + n) };
    const { calls, got, outcomes } = await follow([["a", "https://h.example/la"]], follows, { fetch });
    expect(calls.length).toBe(5);
    expect(got).toEqual({ a: ["https://h.example/e4"] });
    expect(outcomes.a!.error).toBeNull();
  });

  test("test_a_refusal_ends_the_event_pages_but_the_list_results_stand", async () => {
    const errors = [http(403), http(429), http(503), new TimeoutError("t"), new NetworkError("r", "ECONNRESET"), new NetworkError("refused")];
    for (const error of errors) {
      const fetch: Fetcher = async (url) => { if (url.endsWith("e2")) throw error; return ok(); };
      const follows = { a: ["https://h.example/e1", "https://h.example/e2", "https://h.example/e3"], b: ["https://h.example/e4"] };
      const list: [string, string][] = [["a", "https://h.example/la"], ["b", "https://h.example/lb"]];
      const { calls, got, outcomes } = await follow(list, follows, { fetch });
      expect(calls.length).toBe(4);
      expect(got).toEqual({ a: ["https://h.example/e1"] });
      expect(Object.values(outcomes).map((o) => o.error)).toEqual([null, null]);
    }
  });

  test("test_no_event_pages_after_a_refused_list_page", async () => {
    const fetch: Fetcher = async (url) => { if (url.endsWith("lb")) throw http(403); return ok(); };
    const list: [string, string][] = [["a", "https://h.example/la"], ["b", "https://h.example/lb"]];
    const { calls, got } = await follow(list, { a: ["https://h.example/e1"] }, { fetch });
    expect([calls.length, got]).toEqual([2, {}]);
  });

  test("test_a_source_whose_list_page_failed_gets_no_event_pages", async () => {
    const fetch: Fetcher = async (url) => { if (url.endsWith("la")) throw http(404); return ok(); };
    const { calls, got } = await follow([["a", "https://h.example/la"]], { a: ["https://h.example/e1"] }, { fetch });
    expect([calls, got]).toEqual([["https://h.example/la"], {}]);
  });

  test("test_a_garbled_event_page_is_skipped", async () => {
    const junk = new Uint8Array(900);
    for (let i = 0; i < junk.length; i++) junk[i] = i % 9;
    const fetch: Fetcher = async (url) => ok(url.endsWith("e1") ? junk : PAGE);
    const { got } = await follow([["a", "https://h.example/la"]], { a: ["https://h.example/e1", "https://h.example/e2"] }, { fetch });
    expect(got).toEqual({ a: ["https://h.example/e2"] });
  });

  test("test_the_stop_ends_the_event_pages_too", async () => {
    const stop = new AbortController();
    const calls: string[] = [];
    const clock = new Clock();
    await runHost("h.example", [["a", [req("https://h.example/la")]]], {
      fetch: async (url) => { calls.push(url); if (url.endsWith("e1")) stop.abort(); return ok(); },
      sleep: clock.sleep, clock: clock.clock, delay: 1.0, signal: stop.signal,
      onDone: () => [req("https://h.example/e1"), req("https://h.example/e2")],
    });
    expect(calls.map((u) => u.slice(-2))).toEqual(["la", "e1"]);
  });
});

describe("FollowContract", () => {
  const source = (extra: Partial<Source> = {}): Source =>
    ({ name: "a-1", label: "a", adapter: "text", town: "T", group: "g", url: "https://a.example/page", ...extra });

  /** collectAll with a fake `text` adapter whose parse returns `parsed`. */
  async function run(list: Source[], parsed: unknown, fetch?: Fetcher, adapter: Partial<Adapter> = {}) {
    const calls: string[] = [];
    const fetching: Fetcher = async (url, data) => {
      calls.push(url);
      return (fetch ?? (async (u) => ok(u.includes("/e") ? EVENT : PAGE)))(url, data);
    };
    const results = await collectAll(list, WINDOW, {}, 0, {
      fetch: fetching, sleep: noSleep, clock: () => 0.0, maxWorkers: 2, report: () => {},
      adapters: withText({ parse: () => parsed as ParseResult, ...adapter }), defaultDetails: fakeDefaultDetails,
    });
    return { results, calls };
  }
  const follow = (...paths: string[]) => ({ items: [], follow: paths.map((p) => req("https://a.example" + p)) });

  test("test_nothing_is_followed_unless_the_source_allows_it", async () => {
    const { results, calls } = await run([source()], follow("/e1"));
    expect(calls).toEqual(["https://a.example/page"]);
    expect(results[0]!.details).toEqual([]);
  });

  test("test_only_the_sources_own_host_is_followed_in_order_up_to_the_cap", async () => {
    const parsed = { items: [], follow: [
      req("https://evil.example/e0"), req("https://a.example/e1"), req("https://a.example/e1"),
      req("https://a.example/e2"), req("https://a.example/e3")] };
    const { results, calls } = await run([source({ follow: 2 })], parsed);
    expect(calls).toEqual(["https://a.example/page", "https://a.example/e1", "https://a.example/e2"]);
    expect(results[0]!.details.map((d) => d.url)).toEqual(["https://a.example/e1", "https://a.example/e2"]);
  });

  test("test_the_other_www_variant_of_the_sources_host_is_followed", () => {
    const s = source({ follow: 3, url: "https://www.a.example/page" });
    const wanted = [req("https://a.example/e1"), req("https://www.a.example/e2"), req("https://b.example/e3")];
    expect(followRequests(s, wanted).map((r) => r.url)).toEqual(["https://a.example/e1", "https://www.a.example/e2"]);
  });

  test("test_a_follow_over_plain_http_is_dropped", async () => {
    const parsed = { items: [], follow: [req("http://a.example/e1"), req("https://a.example/e2")] };
    const { calls } = await run([source({ follow: 2 })], parsed);
    expect(calls).toEqual(["https://a.example/page", "https://a.example/e2"]);
  });

  test("test_a_non_ascii_url_is_percent_encoded", async () => {
    const { calls } = await run([source({ follow: 1 })], follow("/e/café x"));
    expect(calls[1]).toBe("https://a.example/e/caf%C3%A9%20x");
  });

  test("test_the_default_details_read_the_event_pages", async () => {
    // The default step is injected: common.defaultDetails is T6's.
    const { results } = await run([source({ follow: 1 })], follow("/e1"));
    expect(results[0]!.details.length).toBe(1);
    const detail = results[0]!.details[0]!;
    expect([detail.url, detail.title]).toEqual(["https://a.example/e1", "Fado"]);
    expect(results[0]!.ok).toBe(true);
  });

  test("test_the_adapters_own_details_step_is_used", async () => {
    const seen: [string[], readonly string[]][] = [];
    const details: Adapter["details"] = (_s, pages, window) => {
      seen.push([pages.map((p) => p.url), window]);
      return [{ url: "u", title: "own" } as never];
    };
    const { results } = await run([source({ follow: 1 })], follow("/e1"), undefined, { details });
    expect(results[0]!.details).toEqual([{ url: "u", title: "own" }] as never);
    expect(seen).toEqual([[["https://a.example/e1"], WINDOW]]);
  });

  test("test_a_failing_or_malformed_details_step_keeps_the_source_without_details", async () => {
    const steps = [() => { throw new Error("x"); }, () => "x", () => [1], () => null];
    for (const step of steps) {
      const { results } = await run([source({ follow: 1 })], follow("/e1"), undefined, { details: step as never });
      expect(results[0]!.ok).toBe(true);
      expect(results[0]!.details).toEqual([]);
    }
  });

  test("test_failed_and_refused_event_pages_leave_the_source_ok", async () => {
    const fetch: Fetcher = async (url) => { if (url.includes("/e")) throw http(403); return ok(); };
    const { results, calls } = await run([source({ follow: 3 })], follow("/e1", "/e2"), fetch);
    expect(calls.length).toBe(2);
    expect(results[0]!.ok).toBe(true);
    expect(results[0]!.details).toEqual([]);
  });

  test("test_a_malformed_follow_fails_the_source", async () => {
    const bad: unknown[] = ["x", ["https://a.example/e1"], [req("https://a.example/e1", enc.encode("x=1"))], [{ url: 5, data: null }], { a: 1 }];
    for (const follow of bad) {
      const { results, calls } = await run([source({ follow: 1 })], { items: [], follow });
      expect(results[0]!.ok).toBe(false);
      expect(results[0]!.error).toBe("adapter returned a malformed result");
      expect(calls).toEqual(["https://a.example/page"]);
    }
  });

  test("test_the_same_page_for_two_sources_is_fetched_once", async () => {
    const list = [source({ follow: 1 }), { ...source({ follow: 1 }), name: "a-2" }];
    const { results, calls } = await run(list, follow("/e1"));
    expect(calls.filter((u) => u === "https://a.example/e1").length).toBe(1);
    expect(results.map((r) => r.details.length)).toEqual([1, 1]);
  });

  test("test_a_real_follow_fetch_is_used_only_for_the_real_fetch", async () => {
    const seen: [string, string][] = [];
    await collectAll([source({ follow: 1 })], WINDOW, {}, 0, {
      fetch: async (url) => { seen.push(["fetch", url]); return ok(url.includes("/e") ? EVENT : PAGE); },
      followFetch: async (url) => { seen.push(["follow", url]); return { ...ok(EVENT), url }; },
      sleep: noSleep, clock: () => 0.0, maxWorkers: 1, report: () => {}, defaultDetails: fakeDefaultDetails,
      adapters: withText({ parse: () => follow("/e1") as unknown as ParseResult }),
    });
    expect(seen).toEqual([["fetch", "https://a.example/page"], ["follow", "https://a.example/e1"]]);
  });
});

/** main() with the buffers a test reads. */
async function runMain(args: string[], deps: Partial<MainDeps> = {}) {
  const dir = join(mkdtempSync(join(tmpdir(), "collect-")), "collected");
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await main([dir, ...args], {
    fetch: async () => ok(), sleep: noSleep, clock: () => 0.0, maxWorkers: 2, adapters: withText(fakeText),
    out: (l) => stdout.push(l), err: (l) => stderr.push(l), ...deps,
  });
  const read = (name: string) => JSON.parse(readFileSync(join(dir, name), "utf8"));
  return { code, dir, stdout, stderr, read };
}

describe("Interrupt", () => {
  test("test_ctrl_c_writes_nothing_exits_130_and_stops_the_other_hosts", async () => {
    const calls: string[] = [];
    const stop = new AbortController();
    const fetch: Fetcher = async (url) => {
      calls.push(url);
      stop.abort(); // KeyboardInterrupt
      throw Object.assign(new Error("interrupted"), { name: "AbortError" });
    };
    const r = await runMain(["--only", "cineteatro", "mcr-caldas", "cm-peniche"], { fetch, maxWorkers: 1, signal: stop.signal });
    expect(r.code).toBe(130);
    expect(existsSync(r.dir)).toBe(false);
    expect(r.stderr.join("\n")).toContain("interrupted");
    expect(calls.length).toBe(1);
  });
});

describe("Main", () => {
  test("test_unknown_source_is_a_usage_error", async () => {
    expect((await runMain(["--only", "nope"])).code).toBe(2);
  });

  test("test_bad_date_is_a_usage_error", async () => {
    expect((await runMain(["--from", "soon"])).code).toBe(2);
  });

  test("test_every_source_failing_is_exit_2_and_writes_nothing", async () => {
    const r = await runMain(["--only", "cineteatro"], { fetch: async () => { throw new Error("down"); } });
    expect(r.code).toBe(2);
    expect(existsSync(r.dir)).toBe(false);
  });

  test("test_the_folder_has_an_index_and_a_file_per_group", async () => {
    const r = await runMain(["--only", "cineteatro", "mcr-caldas", "cm-peniche", "--from", "2026-10-20"]);
    expect(r.code).toBe(0);
    const index = r.read("index.json");
    expect(index.window).toEqual({ start: "2026-10-20", end: "2026-11-22" });
    expect(index.groups).toEqual({
      "rio-maior": { file: "rio-maior.json", sources: ["cineteatro"] },
      "oeste-norte": { file: "oeste-norte.json", sources: ["mcr-caldas", "cm-peniche"] },
    });
    expect(readdirSync(r.dir).sort()).toEqual(["index.json", "oeste-norte.json", "rio-maior.json"]);
    expect(index.sources[0]).toEqual({
      name: "cineteatro", group: "rio-maior", town: "Rio Maior", adapter: "text",
      url: "https://www.cineteatrorm.pt/pt/agenda/", ok: true, status: 200, error: null, refused: false,
      note: null, items: 0, past: 0, chars: "evento ".repeat(60).length - 1, details: 0,
    });
    // the keys come in the order Python writes them
    expect(Object.keys(index)).toEqual(["collected_at", "window", "groups", "sources"]);
    expect(Object.keys(index.sources[0])).toEqual(["name", "group", "town", "adapter", "url", "ok", "status", "error", "refused",
      "note", "items", "past", "chars", "details"]);
    const group = r.read("oeste-norte.json");
    expect(Object.keys(group)).toEqual(["collected_at", "window", "group", "sources"]);
    expect(group.group).toBe("oeste-norte");
    expect(group.collected_at).toBe(index.collected_at);
    expect(group.window).toEqual(index.window);
    expect(group.sources.map((s: { name: string }) => s.name)).toEqual(["mcr-caldas", "cm-peniche"]);
    expect(Object.keys(group.sources[0]).sort()).toEqual(
      ["name", "url", "town", "adapter", "ok", "status", "error", "note", "items", "past", "text", "truncated", "label", "details"].sort());
    expect(Object.keys(group.sources[0])).toEqual(["name", "label", "url", "town", "adapter", "ok", "status", "error", "note",
      "items", "past", "text", "truncated", "details"]);
    expect(group.sources[0].adapter).toBe("text");
    expect(readFileSync(join(r.dir, "index.json"), "utf8")).toStartWith('{\n "collected_at"');
  });

  test("test_one_failure_does_not_stop_the_rest", async () => {
    const fetch: Fetcher = async (url) => { if (url.includes("cineteatro")) throw new Error("down"); return ok(); };
    const r = await runMain(["--only", "cineteatro", "mcr-caldas"], { fetch });
    expect(r.code).toBe(0);
    const index = r.read("index.json");
    expect(index.sources.map((s: { ok: boolean }) => s.ok)).toEqual([false, true]);
    expect(index.sources[0].error).toContain("down");
  });

  test("test_only_lists_just_the_sources_run", async () => {
    const r = await runMain(["--only", "mcr-caldas"]);
    const index = r.read("index.json");
    expect(index.sources.map((s: { name: string }) => s.name)).toEqual(["mcr-caldas"]);
    expect(Object.keys(index.groups)).toEqual(["oeste-norte"]);
    expect(index.groups["oeste-norte"].sources).toEqual(["mcr-caldas"]);
  });

  test("test_the_summary_line_names_the_counts_and_groups", async () => {
    const r = await runMain(["--only", "cineteatro", "mcr-caldas"]);
    const last = r.stdout.at(-1)!;
    expect(last.endsWith("collected: 2 sources ok, 0 failed in 2 groups")).toBe(true);
    expect(last.startsWith("wrote ")).toBe(true);
    expect(r.stdout[0]).toMatch(/^(cineteatro|mcr-caldas) {2,}ok  0 items, 419 chars of text$/);
    expect(r.stdout[0]!.indexOf(" ok")).toBe(30);
  });

  async function window(args: string[], today?: string) {
    const r = await runMain(["--only", "cineteatro", ...args], today ? { today } : {});
    expect(r.code).toBe(0);
    return r.read("index.json").window;
  }

  test("test_default_end_is_the_first_sunday_at_least_28_days_on", () => {
    const cases: [string, string][] = [
      ["2026-10-19", "2026-11-22"], // Monday: +28 is a Monday, Sunday is 6 days later
      ["2026-10-20", "2026-11-22"], // Tuesday
      ["2026-10-24", "2026-11-22"], // Saturday: +28 is a Saturday
      ["2026-10-25", "2026-11-22"], // Sunday: +28 is itself a Sunday and counts
      ["2026-10-26", "2026-11-29"], // Monday
      ["2026-12-28", "2027-01-31"], // across a year end
    ];
    for (const [start, end] of cases) {
      const e = defaultEnd(start);
      expect(e).toBe(end);
      const days = (Date.parse(e) - Date.parse(start)) / 86400000;
      expect(new Date(e).getUTCDay()).toBe(0);
      expect(days).toBeGreaterThanOrEqual(28);
      expect(days).toBeLessThan(35);
    }
  });

  test("test_from_defaults_to_today_and_to_to_the_rule", async () => {
    expect(await window([], "2026-10-21")).toEqual({ start: "2026-10-21", end: "2026-11-22" });
  });

  test("test_an_explicit_to_is_kept", async () => {
    expect(await window(["--to", "2026-11-03"], "2026-10-21")).toEqual({ start: "2026-10-21", end: "2026-11-03" });
  });

  test("test_an_explicit_from_gets_the_rule_not_today", async () => {
    expect(await window(["--from", "2026-10-25"], "2026-01-01")).toEqual({ start: "2026-10-25", end: "2026-11-22" });
  });

  test("test_today_is_lisbon_today", () => {
    // 23:30 UTC on 28 March 2026 is still the 28th in Lisbon (summer time starts at 01:00 UTC on the 29th)
    expect(lisbonToday(new Date("2026-03-28T23:30:00Z"))).toBe("2026-03-28");
    expect(lisbonToday(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
    expect(lisbonToday(new Date("2026-12-01T23:30:00Z"))).toBe("2026-12-01");
  });

  test("test_main_without_today_asks_lisbon_for_it", async () => {
    let asked = 0;
    const r = await runMain(["--only", "cineteatro"], { lisbonToday: () => { asked++; return "2026-10-21"; } });
    expect(r.read("index.json").window).toEqual({ start: "2026-10-21", end: "2026-11-22" });
    expect(asked).toBe(1);
  });

  test("a --to before --from, and a missing out folder, are usage errors", async () => {
    expect((await runMain(["--from", "2026-10-21", "--to", "2026-10-20"])).code).toBe(2);
    const stderr: string[] = [];
    expect(await main([], { err: (l) => stderr.push(l) })).toBe(2);
  });
});

describe("Config", () => {
  const config = loadConfig();
  const list = config.sources;
  const byName = Object.fromEntries(list.map((s) => [s.name, s]));

  test("test_names_are_unique", () => {
    const names = list.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("test_groups_cover_every_source_exactly_once", () => {
    for (const s of list) expect(Object.keys(config.groups)).toContain(s.group);
    for (const group of Object.keys(config.groups)) expect(list.some((s) => s.group === group)).toBe(true);
  });

  test("test_every_source_has_an_adapter_and_its_options", () => {
    for (const s of list) {
      expect(Object.keys(ADAPTERS)).toContain(s.adapter);
      for (const key of ["name", "label", "town", "group", "url"] as const) expect(s[key]).toBeTruthy();
    }
    expect(byName["cm-riomaior"]!.options!.categories).toBeTruthy();
    expect(byName["ourem"]!.options!.window_params).toBeTruthy();
    expect(byName["cm-cadaval"]!.options!.site).toBeTruthy();
  });

  test("test_the_group_file_carries_each_sources_label", () => {
    expect(byName["cm-nazare"]!.label).toBe("Município de Nazaré");
  });

  test("test_the_adapters_expose_parse", () => {
    for (const [name, module] of Object.entries(ADAPTERS)) expect([name, typeof module.parse]).toEqual([name, "function"]);
  });

  test("test_links_are_regexes_for_text_sources_and_follow_is_a_small_count", () => {
    for (const s of list) {
      if (s.links !== undefined) {
        expect(s.adapter).toBe("text");
        new RegExp(s.links);
      }
      const follow = s.follow ?? 0;
      expect(Number.isInteger(follow) && follow >= 0 && follow <= 15).toBe(true);
      if (follow && s.adapter === "text") expect(s.links).toBeDefined();
    }
  });

  test("test_the_municipal_feeds_are_sources_of_their_own_adapter", () => {
    for (const name of ["cm-nazare", "cm-batalha", "cm-chamusca"]) {
      expect(byName[name]!.adapter).toBe("municipal_rss");
      expect(new URL(byName[name]!.url).pathname.endsWith(".rss")).toBe(true);
      expect(byName[name]!.options!.page.startsWith("https://")).toBe(true);
    }
    expect(byName["cm-nazare"]!.follow).toBe(8);
  });

  test("test_urls_are_on_the_final_host", () => {
    expect(byName["mcr-caldas"]!.url).toBe("https://www.mcr.pt/agenda");
    expect(new URL(byName["cm-torresnovas"]!.url).hostname).toBe("cm-torresnovas.pt");
  });

  test("test_hosts_have_delays", () => {
    expect(config.default_delay).toBe(1.5);
    expect(config.hosts!["www.cm-entroncamento.pt"]!.delay).toBe(3);
  });

  test("test_a_towns_pages_share_a_group", () => {
    for (const s of list) {
      for (const o of list) {
        if (o.town === s.town && ![o.group, s.group].includes("regional") && o.group !== s.group) {
          throw new Error(`${s.name} and ${o.name} are in different groups`);
        }
      }
    }
  });
});

describe("Towns", () => {
  test("test_each_row_is_one_place_and_one_integer", () => {
    const lines = readFileSync(join(ROOT, "references", "towns.md"), "utf8").split("\n").filter((l) => l.startsWith("|")).slice(2);
    const rows = lines.map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
    expect(rows.length).toBeGreaterThan(30);
    for (const [town, , minutes] of rows) {
      expect(/^\d+$/.test(minutes!)).toBe(true);
      expect(town).not.toContain(",");
      expect(town).not.toContain("(");
    }
  });
});

describe("SourceList", () => {
  const doc = readFileSync(join(ROOT, "references", "sources.md"), "utf8");
  test("test_names_and_urls_are_documented", () => {
    for (const s of loadConfig().sources) {
      expect(doc).toContain(s.name);
      expect(doc).toContain(s.url.split("?")[0]!);
    }
  });
  test("test_every_adapter_is_named_in_the_docs", () => {
    for (const name of Object.keys(ADAPTERS)) expect(doc).toContain(name);
  });
});
