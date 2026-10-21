import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LookupError, UnicodeDecodeError, latin1, pyDecode } from "../src/py/codecs";

const vectors = JSON.parse(readFileSync(join(import.meta.dir, "vectors", "py-codecs.json"), "utf8"));
const bytes = (hex: string) => new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));

describe("pyDecode", () => {
  test("vectors from Python 3.14: bytes.decode(name) for every name and sample", () => {
    expect(vectors.length).toBeGreaterThan(4000);
    for (const v of vectors) {
      let got: unknown;
      try {
        got = { text: Array.from(pyDecode(bytes(v.hex), v.codec), (c) => c.codePointAt(0)) };
      } catch (e) {
        got = { error: e instanceof LookupError ? "LookupError" : e instanceof UnicodeDecodeError ? "UnicodeDecodeError" : String(e) };
      }
      const want = v.text ? { text: v.text } : { error: v.error };
      expect([v.codec, v.hex, got]).toEqual([v.codec, v.hex, want]);
    }
  });
  test("latin-1 keeps 0x96 as U+0096 where TextDecoder gives an en dash", () => {
    expect(pyDecode(new Uint8Array([0x96]), "latin-1")).toBe("\u0096");
    expect(latin1(new Uint8Array([0x96]))).toBe("\u0096");
  });
  test("cp1252 and ascii are strict, so common.decode falls through to utf-8", () => {
    expect(() => pyDecode(new Uint8Array([0x81]), "cp1252")).toThrow(UnicodeDecodeError);
    expect(() => pyDecode(new Uint8Array([0xe9]), "ascii")).toThrow(UnicodeDecodeError);
    expect(() => pyDecode(new Uint8Array([0x41]), "x-user-defined")).toThrow(LookupError);
  });
  test("codecs outside the shim are a LookupError, as an unknown name is", () => {
    for (const name of ["gbk", "utf-7", "iso-8859-11", "koi8-u", "utf-16"]) {
      expect(() => pyDecode(new Uint8Array([0x41]), name)).toThrow(LookupError);
    }
  });
  test("utf-8 keeps a BOM", () => {
    expect(pyDecode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]), "utf-8")).toBe("﻿A");
  });
  test("large bodies decode", () => {
    const big = new Uint8Array(1_000_000).fill(0xe9);
    expect(latin1(big).length).toBe(1_000_000);
    expect(pyDecode(big, "cp1252")[999_999]).toBe("é");
  });
});
