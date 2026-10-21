import { describe, expect, test } from "bun:test";
import {
  casefold, cpCompare, cpLen, cpSlice, firstCp, foldKey, isalnum, isdigit, lastCp, pyRepr, pySplitWs, pyStrip,
} from "../src/py/str.ts";
import { vectors } from "./py_vectors.ts";

describe("str helpers", () => {
  test("code point length and slices count astral characters once", () => {
    expect(cpLen("a\u{1F600}b")).toBe(3);
    expect(cpSlice("a\u{1F600}b", 1, 2)).toBe("\u{1F600}");
    expect(cpSlice("a\u{1F600}b", -2)).toBe("\u{1F600}b");
    expect(firstCp("\u{1F600}x")).toBe("\u{1F600}");
    expect(lastCp("x\u{1F600}")).toBe("\u{1F600}");
    expect(firstCp("")).toBe("");
    expect(lastCp("")).toBe("");
  });
  test("strip and split use Python whitespace, not JS", () => {
    expect(pyStrip("\x85x\x85")).toBe("x");
    expect(pyStrip("\x1cx\x1f")).toBe("x");
    expect(pyStrip("﻿x")).toBe("﻿x");
    expect(pySplitWs(" a \xa0 b　c\n")).toEqual(["a", "b", "c"]);
    expect(pySplitWs("  ")).toEqual([]);
  });
  test("isdigit is wider than \\p{Nd}; isalnum on code points", () => {
    expect(isdigit("²")).toBe(true);
    expect(isdigit("")).toBe(false);
    expect(isalnum("\u{1F600}")).toBe(false);
    expect(isalnum("é")).toBe(false);
  });
  test("casefold is not toLowerCase", () => {
    expect(casefold("Straße ς")).toBe("strasse σ");
  });
  test("pyRepr", () => {
    expect(pyRepr("it's")).toBe('"it\'s"');
    expect(pyRepr(null)).toBe("None");
  });
  test(`str helpers agree with Python on ${vectors.str.length} strings`, () => {
    for (const r of vectors.str) {
      const got = {
        len: cpLen(r.s), first: firstCp(r.s), last: lastCp(r.s), isalnum: isalnum(r.s), isdigit: isdigit(r.s),
        strip: pyStrip(r.s), split: pySplitWs(r.s), casefold: casefold(r.s), repr: pyRepr(r.s),
        slices: r.slices.map(([a, b]) => [a, b, cpSlice(r.s, a, b ?? undefined)]),
        fold_nfd: foldKey(r.s, "NFD"), norm_render: foldKey(r.s, "NFKD"), norm_merge: foldKey(r.s, "NFKD", true),
      };
      const { s: _s, ...want } = r;
      expect({ s: r.s, ...got }).toEqual({ s: r.s, ...want });
    }
  });
  test(`cpCompare agrees with Python on ${vectors.compare.length} pairs`, () => {
    for (const [a, b, want] of vectors.compare) expect(cpCompare(a, b)).toBe(want);
  });
  test("pyRepr of other values", () => {
    for (const [v, want] of vectors.repr_misc) expect(pyRepr(v)).toBe(want);
  });
});
