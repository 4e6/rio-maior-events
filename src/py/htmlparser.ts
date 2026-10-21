// Port of CPython 3.14 html/parser.py + the parts of _markupbase.py it uses. Owned by T2.
// Python counterpart: html.parser.HTMLParser(convert_charrefs=True), subclassed at common.py:91
// (_TextParser). The callback names are Python's, so the common.py port reads like the original.
const NYI = (): never => { throw new Error("not ported"); };

/** [name, value]; value is null for a bare attribute. Duplicates are all kept, in order. */
export type Attr = [name: string, value: string | null];

export class HTMLParser {
  /** convert_charrefs is always true in this code base (common.py:93). */
  constructor(_options: { convertCharrefs?: boolean } = {}) { NYI(); }

  /** HTMLParser.feed: add data and process what can be processed. */
  feed(_data: string): void { NYI(); }

  /** HTMLParser.close: force processing of all buffered data (text, an unclosed comment is dropped). */
  close(): void { NYI(); }

  /** Tag names arrive lowercased; attribute values already unescaped (3.14 rules). */
  handle_starttag(_tag: string, _attrs: Attr[]): void {}

  /** `<x/>`. Default as in Python: calls handle_starttag then handle_endtag. common.py overrides it. */
  handle_startendtag(tag: string, attrs: Attr[]): void {
    this.handle_starttag(tag, attrs);
    this.handle_endtag(tag);
  }

  /** Called for every end tag, including stray ones. */
  handle_endtag(_tag: string): void {}

  /** One text run between tags (charrefs already converted). */
  handle_data(_data: string): void {}

  handle_comment(_data: string): void {}
  handle_decl(_decl: string): void {}
  handle_pi(_data: string): void {}
  unknown_decl(_data: string): void {}
}
