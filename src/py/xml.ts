// Strict XML on saxes with an ElementTree-like shim. Owned by T5.
// Python counterpart: xml.etree.ElementTree.fromstring + common.xml_root (common.py:353-363).
const NYI = (): never => { throw new Error("not ported"); };

/** ElementTree.Element, the parts the adapters use. */
export class Element {
  /** "rss"; "{uri}rss" when namespaced (so a default namespace reads as no rss channel, as in Python). */
  tag = "";
  /** Text before the first child (CDATA merged), or null. */
  text: string | null = null;
  attrib: Record<string, string> = {};
  children: Element[] = [];
  /** First direct child with this tag, or null (Element.find("channel")). */
  find(_path: string): Element | null { return NYI(); }
  /** Element.findall("./channel/item"): simple child paths only. */
  findall(_path: string): Element[] { return NYI(); }
}

/** ET.fromstring(body) on bytes: honours the XML encoding declaration (via py/codecs), then saxes with
 *  xmlns on. Throws XmlParseError on malformed input (ET.ParseError). */
export function fromString(_body: Uint8Array): Element { return NYI(); }

export class XmlParseError extends Error { override name = "ParseError"; }
