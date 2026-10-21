// src/py/xml.ts: the 20 expat edge cases (port-research/xmlcases.py) with the results ElementTree gave, plus the
// Element shim. The adapters' own XML tests belong to T7, the DOCTYPE/UTF-16 guards to T6 (common.xmlRoot).
import { describe, expect, test } from "bun:test";
import { Element, fromString, XmlParseError } from "../src/py/xml.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const WRAP = (inner: string) => enc(`<rss><channel><item>${inner}</item></channel></rss>`);
const title = (b: Uint8Array) => fromString(b).find("./channel/item")?.find("title")?.text;

describe("expat edge cases", () => {
  test("ok: entities, CDATA and char refs merge", () => {
    const r = fromString(enc('<?xml version="1.0" encoding="utf-8"?><rss><channel><item><title>A &amp; B<![CDATA[ <c> ]]>&#233;</title></item></channel></rss>'));
    expect(r.tag).toBe("rss");
    expect(r.find("channel")).not.toBeNull();
    expect(r.find("./channel/item")!.find("title")!.text).toBe("A & B <c> é");
    expect(r.findall("./channel/item").length).toBe(1);
  });
  test("undefined entity is a ParseError", () => { expect(() => fromString(WRAP("<title>A&nbsp;B</title>"))).toThrow(XmlParseError); });
  test("bare ampersand", () => { expect(() => fromString(WRAP("<title>A & B</title>"))).toThrow(XmlParseError); });
  test("mismatched tag", () => { expect(() => fromString(enc("<rss><channel><item></channel></rss>"))).toThrow(XmlParseError); });
  test("default namespace: tag is {uri}rss, no channel", () => {
    const r = fromString(enc('<rss xmlns="http://x/"><channel/></rss>'));
    expect(r.tag).toBe("{http://x/}rss");
    expect(r.find("channel")).toBeNull();
    expect(r.attrib).toEqual({});
  });
  test("prefixed elements are namespaced, plain title found", () => {
    const b = enc('<rss xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><item><dc:title>x</dc:title><title>t</title></item></channel></rss>');
    expect(title(b)).toBe("t");
    expect(fromString(b).find("./channel/item")!.find("{http://purl.org/dc/elements/1.1/}title")!.text).toBe("x");
  });
  test("unbound prefix is a ParseError", () => { expect(() => fromString(enc("<rss><x:a/></rss>"))).toThrow(XmlParseError); });
  test("text before a child, tail ignored", () => { expect(title(WRAP("<title>a<b>x</b>tail</title>"))).toBe("a"); });
  test("UTF-8 BOM", () => {
    const r = fromString(new Uint8Array([0xef, 0xbb, 0xbf, ...enc("<rss><channel/></rss>")]));
    expect(r.tag).toBe("rss");
    expect(r.find("channel")).not.toBeNull();
    expect(r.findall("./channel/item")).toEqual([]);
  });
  test("ISO-8859-1 declaration", () => {
    expect(title(latin1('<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><item><title>Évora</title></item></channel></rss>'))).toBe("Évora");
  });
  test("ISO-8859-1 keeps C1 bytes as controls, not windows-1252", () => {
    expect(title(latin1('<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><item><title>\x96</title></item></channel></rss>'))).toBe("\x96");
  });
  test("windows-1252 declaration", () => {
    expect(title(latin1('<?xml version="1.0" encoding="windows-1252"?><rss><channel><item><title>\x96 x</title></item></channel></rss>'))).toBe("– x");
  });
  test("invalid UTF-8", () => { expect(() => fromString(latin1("<rss><channel><item><title>\xe9</title></item></channel></rss>"))).toThrow(XmlParseError); });
  test("duplicate attribute", () => { expect(() => fromString(enc('<rss a="1" a="2"><channel/></rss>'))).toThrow(XmlParseError); });
  test("junk after the document element", () => { expect(() => fromString(enc("<rss><channel/></rss><x/>"))).toThrow(XmlParseError); });
  test("< in an attribute", () => { expect(() => fromString(enc('<rss a="<"><channel/></rss>'))).toThrow(XmlParseError); });
  test("whitespace before the declaration", () => { expect(() => fromString(enc(' <?xml version="1.0"?><rss><channel/></rss>'))).toThrow(XmlParseError); });
  test("CR LF and CR become LF", () => { expect(title(WRAP("<title>a\r\nb\rc</title>"))).toBe("a\nb\nc"); });
  test("attribute whitespace normalised", () => {
    const link = fromString(WRAP('<link a="x\ty\nz">u</link>')).find("./channel/item")!.find("link")!;
    expect(link.attrib).toEqual({ a: "x y z" });
    expect(link.text).toBe("u");
  });
  test("control character", () => { expect(() => fromString(WRAP("<title>a\x01b</title>"))).toThrow(XmlParseError); });
  test("invalid character reference", () => { expect(() => fromString(WRAP("<title>a&#1;b</title>"))).toThrow(XmlParseError); });
  test("unknown declared encoding", () => {
    expect(() => fromString(enc('<?xml version="1.0" encoding="x-bogus"?><rss><channel/></rss>'))).toThrow(XmlParseError);
  });
});

describe("Element shim", () => {
  const root = fromString(enc('<rss><channel><title>c</title><item><title>1</title></item><item><title/></item></channel></rss>'));
  test("empty and missing text are null; find returns null", () => {
    const items = root.findall("./channel/item");
    expect(items.length).toBe(2);
    expect(items[1]!.find("title")!.text).toBeNull();
    expect(items[0]!.find("nope")).toBeNull();
  });
  test("findall paths", () => {
    expect(root.findall("channel/item/title").length).toBe(2);
    expect(root.findall("./channel/*").length).toBe(3);
    expect(root.findall(".")[0]).toBe(root);
  });
  test("findtext and iter", () => {
    expect(root.findtext("channel/title")).toBe("c");
    expect(root.findtext("channel/item/title")).toBe("1");
    expect(root.findtext("x", "d")).toBe("d");
    expect([...root.iter("title")].length).toBe(3);
    expect([...root.iter()].length).toBe(7);
  });
  test("unsupported paths throw", () => { expect(() => root.findall(".//item")).toThrow(SyntaxError); });
  test("empty and truncated documents", () => {
    expect(() => fromString(new Uint8Array())).toThrow(XmlParseError);
    expect(() => fromString(enc("<rss><channel>"))).toThrow(XmlParseError);
  });
  test("is an Element", () => { expect(root).toBeInstanceOf(Element); });
});
