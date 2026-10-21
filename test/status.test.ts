import { describe, expect, test } from "bun:test";
import { buildStatus, scrubPaths, fmtDuration, outcomeWord, publicJson, renderStatus, renderStatusUnavailable, scrub, type StatusInput } from "../src/status.ts";

type Json = Record<string, any>;

const ev = (names: string[], start = "2026-10-25"): Json => ({ title_pt: "T", start_date: start, sources: names.map((name) => ({ name, url: "https://example.org/x" })) });
const row = (name: string, group: string, extra: Json = {}): Json => ({
  name, group, town: "Town " + name, url: `https://${name}.example.org/`, ok: true, status: 200, error: null, refused: false, items: 3, details: 2, chars: 1200, ...extra,
});

/** Two groups, three pieces, five sources: one failed, one refused, one in a piece whose reader failed. */
function input(over: Partial<StatusInput> = {}): StatusInput {
  return {
    index: {
      window: { start: "2026-10-20", end: "2026-11-15" },
      groups: { a: { sources: ["a1", "a2", "a3"] }, b: { sources: ["b1", "b2"] } },
      sources: [row("a1", "a"), row("a2", "a", { ok: false, status: 404, error: "HTTP 404 Not Found" }), row("a3", "a", { ok: false, status: 403, error: "HTTP 403 Forbidden", refused: true }),
        row("b1", "b"), row("b2", "b")],
    },
    config: { groups: { a: "Area A: towns one and two", b: "Area B" }, sources: [{ name: "a1", label: "Label One" }, { name: "b1", label: "Label B1" }, { name: "b2", label: "Label B2" }] },
    truncated: { a1: true },
    candidates: {
      "a-1": { events: [ev(["Label One"]), ev(["Label One", "a1"], "2026-11-03"), ev(["Label One"], "2026-11-10"), ev(["Somebody Else"])], hints: [{}, {}], coverage: "a-1 <ok>" },
    },
    summary: {
      units: [{ id: "a-1", group: "a", sources: ["a1", "a2", "a3"] }, { id: "b-1", group: "b", sources: ["b1"] }, { id: "b-2", group: "b", sources: ["b2"] }],
      readers: [
        { group: "a-1", attempt: 1, reason: "ok", duration_s: 30, total_cost_usd: 0.1 },
        { group: "b-1", attempt: 1, reason: "invalid candidates: /home/runner/work/x.json bad", duration_s: 20, total_cost_usd: 0.1 },
        { group: "b-1", attempt: 2, reason: "timeout", duration_s: 40, total_cost_usd: 0.2 },
        { group: "b-2", attempt: 1, reason: "ok", duration_s: 10, total_cost_usd: 0.1 },
      ],
      editor: [{ round: 1, reason: "ok", duration_s: 100, total_cost_usd: 0.5 }],
      timings: { total_s: 300, collect_s: 50, read_s: 62, merge_s: 1, finalize_s: 1, render_s: 1 },
      models: { reader: "haiku", editor: "sonnet" }, split_chars: 30000, finalize_input: "editor", editor_events: 4,
    },
    mergeStats: { candidates: 4, collapsed: 0, events: 4 },
    finalizeStats: { events: 3, dropped: 1, collapsed: 0 },
    page: { events: 3, note: "a <note>" },
    env: { GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567", GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "42", CLAUDE_CODE_VERSION: "2.1.306" },
    now: new Date("2026-10-21T07:21:00Z"),
    ...over,
  };
}

const src = (d: Json, id: string) => d.sources.find((s: Json) => s.id === id);

describe("status data", () => {
  test("counts an event once per source, by label or id, without dedup across pieces", () => {
    const d = buildStatus(input({ candidates: { "a-1": input().candidates["a-1"]!, "b-2": { events: [ev(["Label One"]), ev(["b2"])] } } }));
    expect(src(d, "a1").events).toBe(4); // 3 by label, one named by label and id (once), one more from another piece
    expect(src(d, "b2").events).toBe(1);
    expect(src(d, "a1").reaches).toBe("2026-11-10");
    expect(d.unattributed).toEqual([{ name: "Somebody Else", events: 1 }]);
    expect(d.totals.candidates).toBe(4); // the merge's own count wins
  });

  test("a failed source shows its error, a refusal is marked, a source in a failed piece is not read", () => {
    const d = buildStatus(input());
    expect(src(d, "a2")).toMatchObject({ state: "failed", error: "HTTP 404 Not Found", refused: false, events: null });
    expect(src(d, "a3")).toMatchObject({ state: "failed", refused: true, events: null });
    expect(src(d, "b1")).toMatchObject({ state: "not read", events: null });
    expect(src(d, "b2")).toMatchObject({ state: "ok", events: 0 });
    expect(src(d, "a1")).toMatchObject({ label: "Label One", truncated: true, chars: 1200 });
    expect(src(d, "b1").label).toBe("Label B1");
    expect(d.groups.map((g: Json) => g.title)).toEqual(["Area A", "Area B"]);
  });

  test("readers: fixed outcome words, attempts, no paths", () => {
    const d = buildStatus(input());
    const b1 = d.readers.rows.find((r: Json) => r.id === "b-1");
    expect(b1).toMatchObject({ attempts: 2, outcome: "timeout", duration_s: 60 });
    expect(d.readers).toMatchObject({ units: 3, read: 2 });
    expect(outcomeWord("invalid candidates: /home/x")).toBe("invalid candidates");
    expect(outcomeWord("exit 137")).toBe("exit 137");
    expect(outcomeWord("could not run claude: /usr/bin/claude")).toBe("failed");
    expect(outcomeWord("2 permission denials")).toBe("failed");
    expect(JSON.stringify(d)).not.toContain("/home/runner");
    expect(d.timings.reading).toMatchObject({ wall_s: 62, slowest_s: 60, sum_s: 100 });
    expect(d.usage_usd.total).toBeCloseTo(1.0);
  });

  test("totals and the result line come from counts", () => {
    const d = buildStatus(input());
    expect(d.totals).toMatchObject({ candidates: 4, after_merge: 4, editor_file: 4, after_finalize: 3, finalize_dropped: 1, on_page: 3, hints: 2 });
    expect(d.result.line).toBe("Deployed: 3 events. Editor ok, finalized.");
    const raw = buildStatus(input({ summary: { ...input().summary, finalize_input: "merge" } }));
    expect(raw.result.line).toContain("merge's raw output");
    expect(raw.result.degraded).toBe(true);
    const none = buildStatus(input({ summary: { ...input().summary, editor: [] } }));
    expect(none.result.line).toContain("No editor round ran");
    const bad = buildStatus(input({ summary: { ...input().summary, editor: [{ round: 1, reason: "timeout", duration_s: 5 }] } }));
    expect(bad.result.line).toContain("did not finish cleanly");
  });

  test("build facts come from GITHUB_* and CLAUDE_CODE_VERSION, and odd values are dropped", () => {
    const d = buildStatus(input());
    expect(d.commit).toEqual({ sha: "0123456789abcdef0123456789abcdef01234567", short: "0123456", url: "https://github.com/o/r/commit/0123456789abcdef0123456789abcdef01234567" });
    expect(d.run_url).toBe("https://github.com/o/r/actions/runs/42");
    expect(d.claude_code).toBe("2.1.306");
    expect(d.built_at_lisbon).toBe("Wed 21 Oct 2026, 08:21");
    const odd = buildStatus(input({ env: { GITHUB_SHA: "zzz", GITHUB_SERVER_URL: "javascript:x", GITHUB_REPOSITORY: "a b", GITHUB_RUN_ID: "x", CLAUDE_CODE_VERSION: "<b>" } }));
    expect(odd.commit).toBeNull();
    expect(odd.run_url).toBeNull();
    expect(odd.claude_code).toBeNull();
    expect(buildStatus(input({ env: {} })).commit).toBeNull();
  });

  test("status.json leaves out the readers' coverage text and the page note", () => {
    const j = JSON.stringify(publicJson(buildStatus(input())));
    expect(j).not.toContain("a-1 <ok>");
    expect(j).not.toContain("a <note>");
  });

  test("paths in the coverage lines and the note never reach the data or the page", () => {
    const base = input();
    const d = buildStatus(input({
      candidates: { "a-1": { events: [], coverage: "read /home/runner/work/rio/rio-maior-split/a-1.json fully, then /Users/dbushev/projects/x/y.json" } },
      page: { events: 1, note: "see /home/runner/x/y and C:\\Users\\me\\f.txt; 23/24 Oct ok" },
      summary: { ...base.summary, models: { reader: "/Users/me/models/haiku", editor: "sonnet" } },
    }));
    const h = renderStatus(d, "", "");
    for (const bad of ["/home/runner", "/Users/", "C:\\Users"]) { expect(h).not.toContain(bad); expect(JSON.stringify(d)).not.toContain(bad); }
    expect(h).toContain("read … fully, then …");
    expect(h).toContain("23/24 Oct ok");
    expect(scrubPaths("and/or 5/6 at https://a.example/b/c")).toBe("and/or 5/6 at https://a.example/b/c");
  });

  test("reaches: an ongoing or multi-day event counts to its end or the window's end, whichever is earlier", () => {
    const ongoing = { ...ev(["Label One"], "2026-09-24"), kind: "ongoing", end_date: "2027-01-31" };
    const short = { ...ev(["Label B1"], "2026-09-24"), kind: "multi_day", end_date: "2026-10-30" };
    const single = ev(["Label B2"], "2026-10-26");
    const d = buildStatus(input({
      summary: { ...input().summary, readers: [{ group: "a-1", attempt: 1, reason: "ok" }, { group: "b-1", attempt: 1, reason: "ok" }, { group: "b-2", attempt: 1, reason: "ok" }] },
      candidates: { "a-1": { events: [ongoing, short, single] } },
    }));
    expect(src(d, "a1").reaches).toBe("2026-11-15");
    expect(src(d, "b1").reaches).toBe("2026-10-30");
    expect(src(d, "b2").reaches).toBe("2026-10-26");
  });

  test("dollars are rounded to cents, groups are named when the split is off, tiny times read <1 s", () => {
    const base = input();
    const d = buildStatus(input({ summary: { ...base.summary, split_chars: 0, readers: [{ group: "a-1", attempt: 1, reason: "ok", duration_s: 1, total_cost_usd: 0.34884097999999997 }] } }));
    expect(d.usage_usd.readers).toBe(0.35);
    const h = renderStatus(d, "", "");
    expect(h).toContain("of 3 groups read");
    expect(h).toContain("one reader per group");
    expect(h).toContain("&lt;1 s");
    expect(fmtDuration(0.3)).toBe("<1 s");
  });

  test("scrub and fmtDuration", () => {
    expect(scrub("failed at /home/runner/work/a/b.json now")).toBe("failed at … now");
    expect(scrub("see https://example.org/a/b ok")).toBe("see https://example.org/a/b ok");
    expect(scrub("x".repeat(200)).length).toBe(90);
    expect(scrub("a\nb\u0000c")).toBe("a b c");
    expect(fmtDuration(136.4)).toBe("2 min 16 s");
    expect(fmtDuration(9)).toBe("9 s");
    expect(fmtDuration(null)).toBe("-");
  });
});

describe("status page", () => {
  const html = (over: Partial<StatusInput> = {}) => renderStatus(buildStatus(input(over)), "/*css*/", "/*status*/");

  test("a source read through the fallback proxy gets a pill, and the run shows the bytes used", () => {
    const base = input();
    const index = { ...base.index, proxy: { bytes: 3 * 1048576, max_bytes: 30 * 1048576, dead: null, hosts: { "a1.example.org": 1 } },
      sources: base.index.sources.map((s: Json) => (s.name === "a1" ? { ...s, via: "proxy" } : { ...s, via: "direct" })) };
    const d = buildStatus(input({ index }));
    expect(src(d, "a1").via_proxy).toBe(true);
    expect(src(d, "b1").via_proxy).toBe(false);
    expect(d.proxy).toEqual({ bytes: 3 * 1048576, max_bytes: 30 * 1048576, dead: null });
    const h = renderStatus(d, "", "");
    expect(h.match(/<span class="pill">proxy<\/span>/g)).toHaveLength(1);
    expect(h).toContain("Fallback proxy");
    expect(h).toContain("1 source read that way, about 3.0 MB of 30.0 MB");
    expect(h).not.toContain("a1.example.org\": 1");
    // off: no proxy line
    expect(buildStatus(input()).proxy).toBeNull();
    expect(renderStatus(buildStatus(input()), "", "")).not.toContain("Fallback proxy");
  });

  test("shows the sources table, the readers and the totals", () => {
    const h = html();
    expect(h).toContain("Build status");
    expect(h).toContain("Label One");
    expect(h).toContain("HTTP 404 Not Found");
    expect(h).toContain('<span class="pill">refused</span>');
    expect(h).toContain("not read");
    expect(h).toContain("1.2k, cut");
    expect(h).toContain("1.2k chars, cut");
    expect(h).toContain("adds up to more than the 4 candidate events");
    expect(h).toContain("Not matched to a source");
    expect(h).toContain("2 of 3 pieces read, slowest 1 min 00 s");
    expect(h).toContain('<a href="https://github.com/o/r/commit/0123456789abcdef0123456789abcdef01234567">0123456</a>');
    expect(h).toContain('href="index.html"');
    expect(h).not.toContain("/home/runner");
  });

  test("escapes every field", () => {
    const evil = '<img src=x onerror=alert(1)>"\'&';
    const base = input();
    const h = html({
      index: { ...base.index, sources: [row("a1", "a", { url: "javascript:alert(1)", town: evil, error: null }), row("a2", "a", { ok: false, error: evil })] },
      config: { groups: { a: evil }, sources: [{ name: "a1", label: evil }] },
      candidates: { "a-1": { events: [ev([evil])], coverage: evil } },
      summary: { ...base.summary, models: { reader: evil, editor: evil } },
      page: { events: 1, note: evil },
    });
    expect(h).not.toContain("<img");
    expect(h).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(h).not.toContain("javascript:");
  });

  test("the unavailable page still links back and follows the stored theme", () => {
    const h = renderStatusUnavailable("", "");
    expect(h).toContain("rmagenda:theme");
    expect(h).toContain('href="index.html"');
    expect(h).toContain("could not be worked out");
  });

  test("a phone gets a scrolling table box and the page has no script but the theme lookup", () => {
    const h = html();
    expect(h).toContain('class="tablebox"');
    expect(h.match(/<script/g)).toHaveLength(1);
    expect(h).toContain("rmagenda:theme");
  });
});
