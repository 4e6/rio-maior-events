import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cutSources, readSplit, splitCollected } from "../src/split.ts";

type Doc = Record<string, any>;

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

/** A source of about `size` characters once written. */
function source(name: string, town: string | null, size: number): Doc {
  const base: Doc = { name, label: name, url: `https://example.org/${name}`, town, ok: true, items: [], text: "" };
  base.text = "x".repeat(Math.max(0, size - JSON.stringify(base, null, 1).length));
  return base;
}
const names = (pieces: Doc[][]) => pieces.map((p) => p.map((s) => s.name));

describe("cutSources", () => {
  test("a group that fits is one piece", () => {
    expect(names(cutSources([source("a", "X", 100), source("b", "Y", 100)], 1000))).toEqual([["a", "b"]]);
  });

  test("greedy up to the limit, in order, no source split", () => {
    const list = [source("a", "A", 400), source("b", "B", 400), source("c", "C", 400), source("d", "D", 100)];
    expect(names(cutSources(list, 1000))).toEqual([["a", "b"], ["c", "d"]]);
  });

  test("sources of one town stay together when they fit", () => {
    const list = [source("a1", "A", 300), source("b", "B", 300), source("a2", "A", 300), source("c", "C", 300)];
    // a1+a2 together, then b and c: [a1 a2 b] is 900, c opens the next piece
    expect(names(cutSources(list, 1000))).toEqual([["a1", "a2", "b"], ["c"]]);
  });

  test("a town whose sources do not fit together is cut at a source boundary", () => {
    const list = [source("a1", "A", 600), source("a2", "A", 600), source("a3", "A", 300)];
    expect(names(cutSources(list, 1000))).toEqual([["a1"], ["a2", "a3"]]);
  });

  test("a source over the limit is a piece of its own", () => {
    const list = [source("a", "A", 100), source("big", "B", 5000), source("c", "C", 100)];
    expect(names(cutSources(list, 1000))).toEqual([["a"], ["big"], ["c"]]);
  });

  test("sources without a town are never grouped", () => {
    const list = [source("a", null, 600), source("b", null, 600)];
    expect(names(cutSources(list, 1000))).toEqual([["a"], ["b"]]);
  });

  test("failed sources join a neighbour instead of making a piece nobody can read", () => {
    const down = (name: string, town: string) => ({ ...source(name, town, 120), ok: false, text: "" });
    // the shape of ribatejo with its first source down and the next two over the limit
    const list = [down("santarem", "A"), source("big1", "B", 1500), source("c1", "C", 300), source("c2", "D", 300)];
    const cut = cutSources(list, 1000);
    expect(names(cut)).toEqual([["santarem", "big1"], ["c1", "c2"]]);
    // one in the middle goes to the piece before it
    const mid = cutSources([source("a", "A", 600), source("big", "B", 1500), down("d", "C"), source("e", "E", 600)], 1000);
    expect(mid.every((p) => p.some((s) => s.ok))).toBe(true);
    expect(mid.flat().map((s) => s.name).sort()).toEqual(["a", "big", "d", "e"]);
  });

  test("when every source failed, the pieces are left as they are", () => {
    const down = (name: string) => ({ ...source(name, name, 600), ok: false });
    expect(cutSources([down("a"), down("b")], 1000).flat()).toHaveLength(2);
  });

  test("no sources, no pieces", () => {
    expect(cutSources([], 1000)).toEqual([]);
  });
});

describe("splitCollected", () => {
  function collected(): string {
    const dir = mkdtempSync(join(tmpdir(), "split-"));
    dirs.push(dir);
    const group = (g: string, sources: Doc[]) => writeFileSync(join(dir, `${g}.json`), JSON.stringify({
      collected_at: "T", window: { start: "2026-10-20", end: "2026-11-15" }, group: g, sources,
    }, null, 1));
    group("small", [source("s1", "A", 200)]);
    group("large", [source("l1", "A", 500), source("l2", "B", 500), source("l3", "C", 500)]);
    writeFileSync(join(dir, "index.json"), JSON.stringify({
      collected_at: "T", window: { start: "2026-10-20", end: "2026-11-15" },
      groups: { small: { file: "small.json", sources: ["s1"] }, large: { file: "large.json", sources: ["l1", "l2", "l3"] } },
      sources: [],
    }));
    return dir;
  }

  test("writes an index and a file per piece shaped like a group file", () => {
    const dir = collected();
    const out = join(dir, "..", "split-out-" + Date.now());
    dirs.push(out);
    const pieces = splitCollected(dir, out, 1100);
    expect(pieces.map((p) => [p.id, p.group, p.sources])).toEqual([
      ["small", "small", ["s1"]], ["large-1", "large", ["l1", "l2"]], ["large-2", "large", ["l3"]],
    ]);
    const index = JSON.parse(readFileSync(join(out, "index.json"), "utf8"));
    expect(index.collected_at).toBe("T");
    expect(index.window.end).toBe("2026-11-15");
    expect(index.pieces).toEqual(pieces);
    const piece = JSON.parse(readFileSync(join(out, "large-2.json"), "utf8"));
    expect(piece.group).toBe("large-2");
    expect(piece.collected_at).toBe("T");
    expect(piece.sources.map((s: Doc) => s.name)).toEqual(["l3"]);
    expect(readSplit(out)!.length).toBe(3);
  });

  test("a group file that is missing or broken fails only its group", () => {
    const dir = collected();
    writeFileSync(join(dir, "large.json"), "{ nope");
    const out = join(dir, "..", "split-out3-" + Date.now());
    dirs.push(out);
    const pieces = splitCollected(dir, out, 1100);
    expect(pieces.map((p) => p.id)).toEqual(["small"]);
    rmSync(join(dir, "small.json"));
    expect(splitCollected(dir, out, 1100)).toEqual([]);
  });

  test("a rerun replaces the old folder", () => {
    const dir = collected();
    const out = join(dir, "..", "split-out2-" + Date.now());
    dirs.push(out);
    splitCollected(dir, out, 1100);
    splitCollected(dir, out, 100000);
    expect(existsSync(join(out, "large-1.json"))).toBe(false);
    expect(existsSync(join(out, "large.json"))).toBe(true);
  });

  test("readSplit is null without an index", () => {
    const dir = mkdtempSync(join(tmpdir(), "split-"));
    dirs.push(dir);
    mkdirSync(join(dir, "x"));
    expect(readSplit(join(dir, "x"))).toBeNull();
  });
});
