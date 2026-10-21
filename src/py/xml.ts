// Strict XML on saxes with an ElementTree-like shim. Owned by T5.
// Python counterpart: xml.etree.ElementTree.fromstring + common.xml_root (common.py:353-363).
// The DOCTYPE/ENTITY/NUL/UTF-16 guards live in common.ts (xmlRoot); `fromString` is only the parse.
import { SaxesParser } from "saxes";

/** ET.ParseError: malformed XML (also an undecodable body or an unknown declared encoding). */
export class XmlParseError extends Error { override name = "ParseError"; }

/** The declared encoding names no codec. Python raises LookupError here, past `except ET.ParseError`; as a
 *  subclass of XmlParseError it is caught with the other malformed input. */
export class XmlEncodingError extends XmlParseError {}

const XMLNS_URI = "http://www.w3.org/2000/xmlns/";

/** Element.find/findall path: "a", "./a", "a/b", "*", "." (ElementPath's simple subset). */
function steps(path: string): string[] {
  // "{uri}tag" is one step even though a uri holds slashes.
  const out = path.match(/\{[^}]*\}[^/]*|[^/{]+|\/+/g) ?? [];
  const names: string[] = [];
  for (const part of out) {
    if (part[0] === "/") { if (part !== "/" || names.length === 0 && path.startsWith("/")) throw new SyntaxError(`unsupported path: ${path}`); continue; }
    if (/[\[\]()@|]/.test(part.replace(/^\{[^}]*\}/, "")) || part === "..") throw new SyntaxError(`unsupported path: ${path}`);
    if (part !== ".") names.push(part);
  }
  return names;
}

/** ElementTree.Element, the parts the adapters use. */
export class Element {
  /** "rss"; "{uri}rss" when namespaced (so a default namespace reads as no rss channel, as in Python). */
  tag = "";
  /** Text before the first child (CDATA merged), or null. */
  text: string | null = null;
  attrib: Record<string, string> = {};
  children: Element[] = [];

  /** First element matching the path, or null (Element.find("channel")). */
  find(path: string): Element | null { return this.findall(path)[0] ?? null; }

  /** Element.findall("./channel/item"): simple child paths only. */
  findall(path: string): Element[] {
    let level: Element[] = [this];
    for (const step of steps(path)) {
      const next: Element[] = [];
      for (const el of level) for (const c of el.children) if (step === "*" || c.tag === step) next.push(c);
      level = next;
    }
    return level;
  }

  /** Element.findtext(path, default): the match's text ("" when it has none), or `dflt` without a match. */
  findtext(path: string, dflt: string | null = null): string | null {
    const el = this.find(path);
    return el === null ? dflt : (el.text ?? "");
  }

  /** Element.iter(tag?): this element and all descendants in document order, optionally by tag. */
  *iter(tag?: string): Generator<Element> {
    if (tag === undefined || tag === "*" || this.tag === tag) yield this;
    for (const c of this.children) yield* c.iter(tag);
  }
}

const latin1 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...Array.from(b.subarray(i, i + 8192)));
  return s;
};

/** The body as text, by BOM or the XML declaration's encoding (what expat does for the common ones). */
function decodeBody(body: Uint8Array): string {
  let enc: string | null = null;
  let start = 0;
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) { start = 3; enc = "utf-8"; }
  else if (body[0] === 0xff && body[1] === 0xfe) { start = 2; enc = "utf-16le"; }
  else if (body[0] === 0xfe && body[1] === 0xff) { start = 2; enc = "utf-16be"; }
  const bytes = start ? body.subarray(start) : body;
  if (enc === null) {
    const m = /^<\?xml[^>]*?\bencoding\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(latin1(body.subarray(0, 200)));
    enc = (m ? (m[1] ?? m[2] ?? "utf-8") : "utf-8").toLowerCase();
  }
  try {
    if (enc === "utf-8" || enc === "utf8") return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    // WHATWG maps iso-8859-1 and us-ascii to windows-1252; expat and Python keep them strict.
    if (["iso-8859-1", "iso8859-1", "latin1", "latin-1", "l1", "iso_8859-1"].includes(enc)) return latin1(bytes);
    if (["us-ascii", "ascii"].includes(enc)) {
      if (bytes.some((b) => b > 0x7f)) throw new XmlParseError("not well-formed (invalid token)");
      return latin1(bytes);
    }
    return new TextDecoder(enc, { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (e) {
    if (e instanceof XmlParseError) throw e;
    if (e instanceof RangeError) throw new XmlEncodingError(`unknown encoding: ${enc}`);
    throw new XmlParseError("not well-formed (invalid token)");
  }
}

/** ET.fromstring(body) on bytes: honours the XML encoding declaration, then saxes with xmlns on.
 *  Throws XmlParseError on malformed input (ET.ParseError). */
export function fromString(body: Uint8Array): Element {
  const text = decodeBody(body);
  const parser = new SaxesParser({ xmlns: true, position: true });
  const stack: Element[] = [];
  let root: Element | null = null;
  const name = (uri: string, local: string): string => (uri ? `{${uri}}${local}` : local);
  parser.on("error", (e) => { throw e; });
  parser.on("opentag", (node) => {
    const el = new Element();
    el.tag = name(node.uri, node.local);
    for (const a of Object.values(node.attributes)) {
      if (a.uri === XMLNS_URI) continue;
      el.attrib[name(a.uri, a.local)] = a.value;
    }
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(el); else root = el;
    stack.push(el);
  });
  parser.on("closetag", () => { stack.pop(); });
  const onText = (t: string) => {
    const el = stack[stack.length - 1];
    if (el && el.children.length === 0) el.text = (el.text ?? "") + t;
  };
  parser.on("text", onText);
  parser.on("cdata", onText);
  try {
    parser.write(text).close();
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    throw new XmlParseError(m.replace(/\n/g, " "));
  }
  if (root === null) throw new XmlParseError("no element found");
  return root;
}
