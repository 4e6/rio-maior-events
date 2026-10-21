// Port of CPython 3.14 html/parser.py (3.14.8). _markupbase is not needed: 3.14's parse_html_declaration and
// parse_comment do not use it, and position tracking (updatepos/getpos) is left out.
// Python counterpart: html.parser.HTMLParser(convert_charrefs=True), subclassed at common.py:91
// (_TextParser). The callback names are Python's, so the common.py port reads like the original.
// Indices are UTF-16 offsets; the buffering thresholds (feed, the 34-character window for a cut charref) are
// counted in code points as in Python, so the data chunking is the same.
import { unescape, unescapeAttrValue } from "./html_unescape.ts";
import { cpLen, pyStrip } from "./str.ts";

/** [name, value]; value is null for a bare attribute. Duplicates are all kept, in order. */
export type Attr = [name: string, value: string | null];

const interestingNormal = /[&<]/g;
const incomplete = /&[a-zA-Z#]/y;
const entityref = /&([a-zA-Z][-.a-zA-Z0-9]*)[^a-zA-Z0-9]/y;
const charref = /&#(?:[0-9]+|[xX][0-9a-fA-F]+)[^0-9a-fA-F]/y;
const incompleteCharref = /&#(?:[0-9]|[xX][0-9a-fA-F])/y;
const starttagopen = /<[a-zA-Z]/y;
const endtagopen = /<\/[a-zA-Z]/y;
const commentclose = /--!?>/g;
const commentabruptclose = /-?>/y;
const tagfindTolerant = /([a-zA-Z][^\t\n\r\f />]*)(?:[\t\n\r\f ]|\/(?!>))*/y;
const attrfindTolerant = new RegExp(
  "((?<=['\"\\t\\n\\r\\f /])[^\\t\\n\\r\\f />][^\\t\\n\\r\\f /=>]*)" +
    "([\\t\\n\\r\\f ]*=[\\t\\n\\r\\f ]*('[^']*'|\"[^\"]*\"|(?!['\"])[^>\\t\\n\\r\\f ]*))?" +
    "(?:[\\t\\n\\r\\f ]|/(?!>))*",
  "y",
);
const locatetagend = new RegExp(
  "[a-zA-Z][^\\t\\n\\r\\f />]*" +
    "[\\t\\n\\r\\f /]*" +
    "(?:(?<=['\"\\t\\n\\r\\f /])[^\\t\\n\\r\\f />][^\\t\\n\\r\\f /=>]*" +
    "(?:[\\t\\n\\r\\f ]*=[\\t\\n\\r\\f ]*(?:'[^']*'|\"[^\"]*\"|(?!['\"])[^>\\t\\n\\r\\f ]*))?" +
    "[\\t\\n\\r\\f /]*)*" +
    ">?",
  "y",
);
const ampSpace = /[\t\n\r\f ;]/g;

/** The UTF-16 offset of the code point `count` code points before the end of `s` (0 if there are fewer). */
function backCodePoints(s: string, count: number): number {
  let k = s.length;
  while (count > 0 && k > 0) {
    k--;
    const c = s.charCodeAt(k);
    if (c >= 0xdc00 && c <= 0xdfff && k > 0) {
      const h = s.charCodeAt(k - 1);
      if (h >= 0xd800 && h <= 0xdbff) k--;
    }
    count--;
  }
  return k;
}

/** re.search(rawdata, pos) for a /g regex. */
function search(re: RegExp, s: string, pos: number): RegExpExecArray | null {
  re.lastIndex = pos;
  return re.exec(s);
}

/** re.match(rawdata, pos) for a /y regex. */
function match(re: RegExp, s: string, pos: number): RegExpExecArray | null {
  re.lastIndex = pos;
  return re.exec(s);
}

export class HTMLParser {
  static readonly CDATA_CONTENT_ELEMENTS = ["script", "style", "xmp", "iframe", "noembed", "noframes"];
  static readonly RCDATA_CONTENT_ELEMENTS = ["textarea", "title"];

  convertCharrefs: boolean;
  scripting: boolean;
  rawdata = "";
  lasttag = "???";
  private interesting: RegExp = interestingNormal;
  private cdataElem: string | null = null;
  private supportCdata = true;
  private escapable = true;
  private pending: string[] = [];
  private pendingLen = 0;
  private parseThreshold = 1;
  private starttagText: string | null = null;

  /** convert_charrefs is true in this code base (common.py:93). */
  constructor(options: { convertCharrefs?: boolean; scripting?: boolean } = {}) {
    this.convertCharrefs = options.convertCharrefs ?? true;
    this.scripting = options.scripting ?? false;
    this.reset();
  }

  reset(): void {
    this.rawdata = "";
    this.lasttag = "???";
    this.interesting = interestingNormal;
    this.cdataElem = null;
    this.supportCdata = true;
    this.escapable = true;
    this.pending = [];
    this.pendingLen = 0;
    this.parseThreshold = 1;
  }

  /** HTMLParser.feed: add data and process what can be processed. */
  feed(data: string): void {
    this.pendingLen += cpLen(data);
    if (this.pendingLen < this.parseThreshold) {
      this.pending.push(data);
      return;
    }
    if (this.pending.length === 0) {
      this.rawdata += data;
    } else {
      this.pending.push(data);
      this.rawdata += this.pending.join("");
      this.pending = [];
    }
    this.pendingLen = 0;
    const n = this.rawdata.length;
    this.goahead(false);
    // Some data was parsed: resume on the next call; nothing parsed: wait until the buffer doubles.
    this.parseThreshold = this.rawdata.length < n ? 1 : cpLen(this.rawdata);
  }

  /** HTMLParser.close: force processing of all buffered data. */
  close(): void {
    if (this.pending.length) {
      this.rawdata += this.pending.join("");
      this.pending = [];
      this.pendingLen = 0;
    }
    this.goahead(true);
  }

  /** Full source of the last start tag: '<...>'. */
  get_starttag_text(): string | null {
    return this.starttagText;
  }

  private setCdataMode(elem: string, escapable: boolean): void {
    this.cdataElem = elem.toLowerCase();
    this.escapable = escapable;
    if (this.cdataElem === "plaintext") {
      this.interesting = /$/g; // Python r'\z': matches only at the end of the buffer
    } else if (escapable && !this.convertCharrefs) {
      this.interesting = new RegExp(`&|</${this.cdataElem}(?=[\\t\\n\\r\\f />])`, "gi");
    } else {
      this.interesting = new RegExp(`</${this.cdataElem}(?=[\\t\\n\\r\\f />])`, "gi");
    }
  }

  private clearCdataMode(): void {
    this.interesting = interestingNormal;
    this.cdataElem = null;
    this.escapable = true;
  }

  _set_support_cdata(flag = true): void {
    this.supportCdata = flag;
  }

  private goahead(end: boolean): void {
    const rawdata = this.rawdata;
    let i = 0;
    const n = rawdata.length;
    while (i < n) {
      let j: number;
      if (this.convertCharrefs && !this.cdataElem) {
        j = rawdata.indexOf("<", i);
        if (j < 0) {
          // Either at the end or more text is incoming: hold back text with a possibly cut charref at its end.
          const amppos = rawdata.lastIndexOf("&");
          if (amppos >= Math.max(i, backCodePoints(rawdata, 34)) && !search(ampSpace, rawdata, amppos)) break;
          j = n;
        }
      } else {
        const m = search(this.interesting, rawdata, i);
        if (m) j = m.index;
        else {
          if (this.cdataElem) break;
          j = n;
        }
      }
      if (i < j) {
        if (this.convertCharrefs && this.escapable) this.handle_data(unescape(rawdata.slice(i, j)));
        else this.handle_data(rawdata.slice(i, j));
      }
      i = j;
      if (i === n) break;
      if (rawdata.startsWith("<", i)) {
        let k: number;
        if (match(starttagopen, rawdata, i)) k = this.parseStarttag(i);
        else if (rawdata.startsWith("</", i)) k = this.parseEndtag(i);
        else if (rawdata.startsWith("<!--", i)) k = this.parseComment(i);
        else if (rawdata.startsWith("<?", i)) k = this.parsePi(i);
        else if (rawdata.startsWith("<!", i)) k = this.parseHtmlDeclaration(i);
        else if (i + 1 < n || end) {
          this.handle_data("<");
          k = i + 1;
        } else break;
        if (k < 0) {
          if (!end) break;
          if (match(starttagopen, rawdata, i)) {
            // nothing
          } else if (rawdata.startsWith("</", i)) {
            if (i + 2 === n) this.handle_data("</");
            else if (match(endtagopen, rawdata, i)) {
              // nothing
            } else this.handle_comment(rawdata.slice(i + 2));
          } else if (rawdata.startsWith("<!--", i)) {
            let jj = n;
            const rest = rawdata.slice(i + 4);
            for (const suffix of ["--!", "--", "-"]) {
              if (rest.endsWith(suffix)) {
                jj -= suffix.length;
                break;
              }
            }
            this.handle_comment(rawdata.slice(i + 4, jj));
          } else if (rawdata.startsWith("<![CDATA[", i) && this.supportCdata) {
            this.unknown_decl(rawdata.slice(i + 3));
          } else if (rawdata.slice(i, i + 9).toLowerCase() === "<!doctype") {
            this.handle_decl(rawdata.slice(i + 2));
          } else if (rawdata.startsWith("<!", i)) {
            this.handle_comment(rawdata.slice(i + 2));
          } else if (rawdata.startsWith("<?", i)) {
            this.handle_pi(rawdata.slice(i + 2));
          } else throw new Error("we should not get here!");
          k = n;
        }
        i = k;
      } else if (rawdata.startsWith("&#", i)) {
        let m = match(charref, rawdata, i);
        if (m) {
          this.handle_charref(m[0].slice(2, -1));
          let k = i + m[0].length;
          if (!rawdata.startsWith(";", k - 1)) k--;
          i = k;
          continue;
        }
        m = match(incompleteCharref, rawdata, i);
        if (m) {
          if (end) {
            this.handle_charref(rawdata.slice(i + 2));
            i = n;
          }
          break;
        } else if (i + 3 < n) {
          this.handle_data("&#");
          i += 2;
        } else break;
      } else if (rawdata.startsWith("&", i)) {
        let m = match(entityref, rawdata, i);
        if (m) {
          this.handle_entityref(m[1]!);
          let k = i + m[0].length;
          if (!rawdata.startsWith(";", k - 1)) k--;
          i = k;
          continue;
        }
        m = match(incomplete, rawdata, i);
        if (m) {
          if (end) {
            this.handle_entityref(rawdata.slice(i + 1));
            i = n;
          }
          break;
        } else if (i + 1 < n) {
          this.handle_data("&");
          i += 1;
        } else break;
      } else {
        throw new Error("interesting.search() lied");
      }
    }
    if (end && i < n) {
      if (this.convertCharrefs && this.escapable) this.handle_data(unescape(rawdata.slice(i, n)));
      else this.handle_data(rawdata.slice(i, n));
      i = n;
    }
    this.rawdata = rawdata.slice(i);
  }

  private parseHtmlDeclaration(i: number): number {
    const rawdata = this.rawdata;
    if (rawdata.startsWith("<!--", i)) return this.parseComment(i);
    if (rawdata.startsWith("<![CDATA[", i) && this.supportCdata) {
      const j = rawdata.indexOf("]]>", i + 9);
      if (j < 0) return -1;
      this.unknown_decl(rawdata.slice(i + 3, j));
      return j + 3;
    }
    if (rawdata.slice(i, i + 9).toLowerCase() === "<!doctype") {
      const gtpos = rawdata.indexOf(">", i + 9);
      if (gtpos === -1) return -1;
      this.handle_decl(rawdata.slice(i + 2, gtpos));
      return gtpos + 1;
    }
    return this.parseBogusComment(i);
  }

  private parseComment(i: number): number {
    const rawdata = this.rawdata;
    // An empty comment is abruptly closed by the first ">" or "->", ahead of a later "-->" or "--!>".
    let m = match(commentabruptclose, rawdata, i + 4);
    if (!m) {
      m = search(commentclose, rawdata, i + 4);
      if (!m) return -1;
    }
    this.handle_comment(rawdata.slice(i + 4, m.index));
    return m.index + m[0].length;
  }

  private parseBogusComment(i: number): number {
    const rawdata = this.rawdata;
    const pos = rawdata.indexOf(">", i + 2);
    if (pos === -1) return -1;
    this.handle_comment(rawdata.slice(i + 2, pos));
    return pos + 1;
  }

  private parsePi(i: number): number {
    const rawdata = this.rawdata;
    const j = rawdata.indexOf(">", i + 2);
    if (j < 0) return -1;
    this.handle_pi(rawdata.slice(i + 2, j));
    return j + 1;
  }

  private parseStarttag(i: number): number {
    this.starttagText = null;
    const endpos = this.checkForWholeStartTag(i);
    if (endpos < 0) return endpos;
    const rawdata = this.rawdata;
    this.starttagText = rawdata.slice(i, endpos);

    const attrs: Attr[] = [];
    const tm = match(tagfindTolerant, rawdata, i + 1);
    if (!tm) throw new Error("unexpected call to parse_starttag()");
    let k = i + 1 + tm[0].length;
    const tag = (this.lasttag = tm[1]!.toLowerCase());
    while (k < endpos) {
      const m = match(attrfindTolerant, rawdata, k);
      if (!m) break;
      const attrname = m[1]!;
      const rest = m[2];
      let attrvalue: string | null | undefined = m[3];
      if (!rest) attrvalue = null;
      else if (
        (attrvalue!.slice(0, 1) === "'" && attrvalue!.slice(-1) === "'") ||
        (attrvalue!.slice(0, 1) === '"' && attrvalue!.slice(-1) === '"')
      ) {
        attrvalue = attrvalue!.slice(1, -1);
      }
      if (attrvalue) attrvalue = unescapeAttrValue(attrvalue);
      attrs.push([attrname.toLowerCase(), attrvalue ?? null]);
      k += m[0].length;
    }

    const tail = pyStrip(rawdata.slice(k, endpos));
    if (tail !== ">" && tail !== "/>") {
      this.handle_data(rawdata.slice(i, endpos));
      return endpos;
    }
    if (tail.endsWith("/>")) {
      this.handle_startendtag(tag, attrs);
    } else {
      this.handle_starttag(tag, attrs);
      if (HTMLParser.CDATA_CONTENT_ELEMENTS.includes(tag) || (this.scripting && tag === "noscript") || tag === "plaintext") {
        this.setCdataMode(tag, false);
      } else if (HTMLParser.RCDATA_CONTENT_ELEMENTS.includes(tag)) {
        this.setCdataMode(tag, true);
      }
    }
    return endpos;
  }

  private checkForWholeStartTag(i: number): number {
    const rawdata = this.rawdata;
    const m = match(locatetagend, rawdata, i + 1)!;
    const j = i + 1 + m[0].length;
    if (rawdata[j - 1] !== ">") return -1;
    return j;
  }

  private parseEndtag(i: number): number {
    const rawdata = this.rawdata;
    if (rawdata.indexOf(">", i + 2) < 0) return -1;
    if (!match(endtagopen, rawdata, i)) {
      if (rawdata.slice(i + 2, i + 3) === ">") return i + 3; // "</>" is ignored
      return this.parseBogusComment(i);
    }
    const m = match(locatetagend, rawdata, i + 2)!;
    const j = i + 2 + m[0].length;
    if (rawdata[j - 1] !== ">") return -1;
    const tm = match(tagfindTolerant, rawdata, i + 2)!;
    this.handle_endtag(tm[1]!.toLowerCase());
    this.clearCdataMode();
    return j;
  }

  /** `<x/>`. Default as in Python: calls handle_starttag then handle_endtag. common.py overrides it. */
  handle_startendtag(tag: string, attrs: Attr[]): void {
    this.handle_starttag(tag, attrs);
    this.handle_endtag(tag);
  }

  /** Tag names arrive lowercased; attribute values already unescaped (3.14 rules). */
  handle_starttag(_tag: string, _attrs: Attr[]): void {}
  /** Called for every end tag, including stray ones. */
  handle_endtag(_tag: string): void {}
  handle_charref(_name: string): void {}
  handle_entityref(_name: string): void {}
  /** One text run between tags (charrefs already converted). */
  handle_data(_data: string): void {}
  handle_comment(_data: string): void {}
  handle_decl(_decl: string): void {}
  handle_pi(_data: string): void {}
  unknown_decl(_data: string): void {}
}
