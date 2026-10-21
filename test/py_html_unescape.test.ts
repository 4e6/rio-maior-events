import { describe, expect, test } from "bun:test";
import { unescape, unescapeAttrValue } from "../src/py/html_unescape.ts";
import { vectors } from "./py_vectors.ts";

describe("html.unescape", () => {
  test("named references, with and without the semicolon", () => {
    expect(unescape("&lt;b&gt; &amp; &copy &copy; &notit; &notin;")).toBe("<b> & © © ¬" + "it; ∉");
  });
  test("numeric references: invalid code points, windows-1252 remap, out of range", () => {
    expect(unescape("&#0;&#13;&#128;&#129;&#x1;&#xD800;&#x110000;&#xFFFF;&#65;&#x41")).toBe("\ufffd\r\u20ac\x81\ufffd\ufffdAA");
  });
  test("double unescape turns &amp;lt;b&amp;gt; into <b>", () => {
    expect(unescape(unescape("&amp;lt;b&amp;gt;"))).toBe("<b>");
  });
  test("a huge numeric reference does not throw", () => {
    expect(unescape("&#" + "9".repeat(5000) + ";")).toBe("�");
  });
  test("a string without & is returned as is", () => {
    expect(unescape("plain")).toBe("plain");
  });
  test(`unescape agrees with Python on ${vectors.unescape.length} vectors`, () => {
    const bad = vectors.unescape.filter(([s, want]) => unescape(s) !== want).map(([s, want]) => [s, want, unescape(s)]);
    expect(bad).toEqual([]);
  });
  test(`unescapeAttrValue agrees with Python 3.14 on ${vectors.attr.length} vectors`, () => {
    const bad = vectors.attr.filter(([s, want]) => unescapeAttrValue(s) !== want).map(([s, want]) => [s, want, unescapeAttrValue(s)]);
    expect(bad).toEqual([]);
  });
  test("attribute values keep an unterminated named reference followed by = or letters", () => {
    expect(unescapeAttrValue("a=1&copy=2&amp;x&ampx&#65=")).toBe("a=1&copy=2&x&ampxA=");
  });
});
