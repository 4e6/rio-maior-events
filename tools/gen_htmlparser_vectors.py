#!/usr/bin/env python3
"""Generate test/fixtures/htmlparser_vectors.json: the callback stream of Python's html.parser for src/py/htmlparser.ts.

Run with the reference Python (3.14): python3.14 tools/gen_htmlparser_vectors.py
"""
import json
import os
import sys
from html.parser import HTMLParser


class Rec(HTMLParser):
    def __init__(self, **kw):
        super().__init__(**kw)
        self.ev = []

    def handle_starttag(self, tag, attrs):
        self.ev.append(["start", tag, [list(a) for a in attrs], self.get_starttag_text()])

    def handle_startendtag(self, tag, attrs):
        self.ev.append(["startend", tag, [list(a) for a in attrs], self.get_starttag_text()])

    def handle_endtag(self, tag):
        self.ev.append(["end", tag])

    def handle_data(self, d):
        self.ev.append(["data", d])

    def handle_entityref(self, n):
        self.ev.append(["entityref", n])

    def handle_charref(self, n):
        self.ev.append(["charref", n])

    def handle_comment(self, d):
        self.ev.append(["comment", d])

    def handle_decl(self, d):
        self.ev.append(["decl", d])

    def handle_pi(self, d):
        self.ev.append(["pi", d])

    def unknown_decl(self, d):
        self.ev.append(["unknown_decl", d])


def run(chunks, **kw):
    p = Rec(**kw)
    for c in chunks:
        p.feed(c)
    p.close()
    return p.ev


SNIPPETS = {
    "plain": "<p class=a>Hello &amp; <b>world</b> &copy 2026 &#65;&#x42; &bogus; &#xZZ</p>",
    "stray_end_tags": "</div></p>text</ span ></ x><b></b ></B foo=bar>",
    "end_tag_edge": "</>a</ >b</1>c</a",
    "duplicate_attrs": '<a href=1 href=2 HREF="3" Title=\'x\' title=y data-x>t</a>',
    "attr_quirks": "<a b = 'c'd=e f=\"g\"h i/j k=/>l=m=n>text",
    "attr_entities": '<a href="?a=1&copy=2&reg;&amp;&#38;&#x26;&notit;&lt" t=&amp;lt; u=\'&#0;&#128;\'>x</a>',
    "attr_empty_values": "<a b= c='' d=\"\" e=>x</a>",
    "unquoted_slash": "<a href=/x/y/>z</a><br/><br /><img src=a.png/>",
    "startend": "<br/><img src='a' /><x:y/ >",
    "weird_tag_names": "<a$b>x</a$b><a\x00b>y</a><A-B C-D=E>",
    "unfinished_tag": "<a href='x",
    "unfinished_tag2": "<div class=\"a\" <b>after</b>",
    "lt_in_text": "a < b <3 <<p>x</p> <",
    "lt_at_end": "text<",
    "amp_cases": "a & b &; &# &#x &#xg AT&T x&y=1 &amp &ampx &lt;&gt;",
    "amp_at_end": "tail &am",
    "amp_at_end2": "tail &#12",
    "amp_at_end3": "tail &amp;",
    "charref_in_data": "&#38;amp; &#0; &#x110000; &#150; &#xD800;",
    "comment": "<!-- a --><!---->x<!--->y<!-- -> z --><!--a--!>b<!-- --!-->c",
    "comment_abrupt": "<!-->a<!--->b<!-- --> c --> d",
    "comment_unclosed": "<!-- never closed",
    "comment_unclosed_dashes": "<!-- never closed --",
    "comment_unclosed_bang": "<!-- never closed --!",
    "comment_unclosed_dash": "<!-- never closed -",
    "comment_unclosed_dash2": "<!---",
    "bogus_comment": "<!x y><!><!- a>a</ b c>d<?pi stuff?>e<?never",
    "bogus_comment_unclosed": "<!foo bar",
    "bogus_end_unclosed": "</ foo bar",
    "pi": "<?xml version='1.0'?><?php echo 1 ?>t",
    "doctype": "<!DOCTYPE html><!doctype html PUBLIC \"x>y\"><html>",
    "doctype_unclosed": "<!DOCTYPE html",
    "cdata": "<![CDATA[ a < b ]]>x<![CDATA[open",
    "cdata_unclosed2": "<![CDATA[open",
    "script": "<script>if (a < b && c > d) { x = '</p>'; } // &amp;\n</script>after<SCRIPT >1</SCRIPT x>2",
    "script_unclosed": "<script>var x = 1; </scrip",
    "script_unclosed2": "<script>var x = 1;",
    "script_comment_like": "<script><!-- a --> <![CDATA[ x ]]> </script >z",
    "style": "<style>a > b { content: '&amp;' }</style><style></styleX></style>ok",
    "xmp_iframe": "<xmp><b>&amp;</b></xmp><iframe><p>x</p></iframe><noembed>&amp;</noembed><noframes></noframes>",
    "title_rcdata": "<title>a &amp; <b>b</b> &copy; &#65;</title>after",
    "title_rcdata_nested": "<title><title></title></title>",
    "textarea": "<textarea><p>a &lt;/p&gt;</textarea>z<textarea></TEXTAREA\n>",
    "title_unclosed": "<title>abc &amp",
    "title_unclosed2": "<title>abc &amp; </tit",
    "plaintext": "<plaintext><b>&amp;</b></plaintext>",
    "noscript": "<noscript><p>x</p><img src=a></noscript>",
    "script_slash": "<script/>x</script>y<script src=a />z",
    "script_end_variants": "<script>a</script\t>b<script>c</script/>d<script>e</script",
    "tag_whitespace": "<a\tb\n=\r\nc\fd=e>x</a\n>",
    "lowercase": "<DIV ID=Foo CLASS='Bar'>T</DIV>",
    "unicode": "<p title='é\U0001F600'>naïve &eacute; \U0001F600 &#128512;</p>",
    "unicode_ws": "<a b=c>x</a> <b c>",
    "nul": "<p>a\x00b</p>",
    "crlf": "<p>a\r\nb</p>\r\n<!--x\r\ny-->",
    "empty": "",
    "only_text": "just text",
    "nested_quotes": "<a title=\"it's\" alt='say \"hi\"'>x</a>",
    "attr_no_space": "<a b='1'c='2'd=\"3\"e=4>x</a>",
    "attr_lt": "<a b=<c>>x</a>",
    "gt_in_value": "<a title='a>b'>x</a><a title=a>b>x</a>",
    "start_unfinished_eof_attrs": "<a b='c' d",
    "table": "<table><tr><td>1<td>2</table><br><hr/><p>a<p>b",
    "long_amp_window": "x" * 20 + "&" + "y" * 40 + " end",
    "amp_near_end": "z" * 10 + " &" + "q" * 30,
}

# (name, chunks): chunked feeding, including splits inside constructs.
CHUNKED = {}
for name in ("plain", "attr_entities", "comment", "script", "title_rcdata", "doctype", "cdata", "amp_cases", "unicode",
             "stray_end_tags", "bogus_comment", "textarea", "plaintext", "long_amp_window", "comment_abrupt"):
    s = SNIPPETS[name]
    CHUNKED[name + "@1"] = [s[i:i + 1] for i in range(len(s))]
    CHUNKED[name + "@3"] = [s[i:i + 3] for i in range(0, len(s), 3)]
    CHUNKED[name + "@7"] = [s[i:i + 7] for i in range(0, len(s), 7)]
CHUNKED["split_charref"] = ["a &am", "p; b &#6", "5; c &#x4", "1 d &", "lt", "; e"]
CHUNKED["split_tag"] = ["<a hr", "ef='x", "y'>t</", "a", ">"]
CHUNKED["split_comment"] = ["<!-", "- a -", "-", "!", ">", "z"]
CHUNKED["empty_feeds"] = ["", "<p>", "", "x", ""]


def main():
    out = []
    for name, s in SNIPPETS.items():
        out.append({"name": name, "chunks": [s], "events": run([s])})
    for name, chunks in CHUNKED.items():
        out.append({"name": name, "chunks": chunks, "events": run(chunks)})
    # convert_charrefs=False (not used by the code base, ported all the same) and scripting=True.
    for name in ("plain", "amp_cases", "title_rcdata", "textarea", "charref_in_data", "amp_at_end", "amp_at_end2"):
        s = SNIPPETS[name]
        out.append({"name": name + "/raw_charrefs", "chunks": [s], "options": {"convertCharrefs": False},
                    "events": run([s], convert_charrefs=False)})
    s = SNIPPETS["noscript"]
    out.append({"name": "noscript/scripting", "chunks": [s], "options": {"scripting": True},
                "events": run([s], scripting=True)})
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "fixtures", "htmlparser_vectors.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"python": sys.version.split()[0], "vectors": out}, f, ensure_ascii=False, indent=0)
        f.write("\n")
    print(len(out), "vectors,", path)


if __name__ == "__main__":
    main()
