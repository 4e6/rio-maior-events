import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HTMLParser, type Attr } from "../src/py/htmlparser.ts";
import { ROOT } from "./helpers.ts";

type Ev = unknown[];

/** Records every callback, in the shape tools/gen_htmlparser_vectors.py writes. */
class Rec extends HTMLParser {
  ev: Ev[] = [];
  override handle_starttag(tag: string, attrs: Attr[]) { this.ev.push(["start", tag, attrs, this.get_starttag_text()]); }
  override handle_startendtag(tag: string, attrs: Attr[]) { this.ev.push(["startend", tag, attrs, this.get_starttag_text()]); }
  override handle_endtag(tag: string) { this.ev.push(["end", tag]); }
  override handle_data(d: string) { this.ev.push(["data", d]); }
  override handle_entityref(n: string) { this.ev.push(["entityref", n]); }
  override handle_charref(n: string) { this.ev.push(["charref", n]); }
  override handle_comment(d: string) { this.ev.push(["comment", d]); }
  override handle_decl(d: string) { this.ev.push(["decl", d]); }
  override handle_pi(d: string) { this.ev.push(["pi", d]); }
  override unknown_decl(d: string) { this.ev.push(["unknown_decl", d]); }
}

const file = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "htmlparser_vectors.json"), "utf8")) as {
  python: string;
  vectors: { name: string; chunks: string[]; options?: { convertCharrefs?: boolean; scripting?: boolean }; events: Ev[] }[];
};

describe("HTMLParser event stream equals Python 3.14", () => {
  for (const v of file.vectors) {
    test(v.name, () => {
      const p = new Rec(v.options);
      for (const c of v.chunks) p.feed(c);
      p.close();
      expect(p.ev).toEqual(v.events);
    });
  }
});

describe("HTMLParser", () => {
  test("a stray end tag is reported and an unclosed comment is dropped by nothing but close", () => {
    const p = new Rec();
    p.feed("</b>x<!-- open");
    expect(p.ev).toEqual([["end", "b"], ["data", "x"]]);
    p.close();
    expect(p.ev.at(-1)).toEqual(["comment", " open"]);
  });
});
