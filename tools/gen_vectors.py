#!/usr/bin/env python3
"""Generate test/fixtures/py_vectors.json: Python's answers for src/py/str.ts and html_unescape.ts tests.

Run with the reference Python (3.14): python3.14 tools/gen_vectors.py
"""
import html
import html.parser
import json
import os
import random
import unicodedata
from html.entities import html5

random.seed(20261021)
names = sorted(html5)
legacy = [n for n in names if not n.endswith(";")]

un = []
for name in names:
    base = name.rstrip(";")
    for c in ("&" + name, "&" + base + "x", "&" + base + "=", "a&" + base + ";b", "&" + base + "1", "&" + base + " "):
        un.append(c)
for n in [0, 1, 8, 9, 11, 13, 14, 31, 0x7f, 0x80, 0x81, 0x8d, 0x9f, 0xa0, 0xd7ff, 0xd800, 0xdfff, 0xfdcf, 0xfdd0, 0xfdef, 0xfdf0,
          0xfffe, 0xffff, 0x10000, 0x1fffe, 0x10ffff, 0x110000, 0x7fffffff, 0xffffffff, 65, 233, 0x1f600]:
    un += ["&#%d;" % n, "&#x%x;" % n, "&#X%X;" % n, "&#%d" % n, "&#x%Xz" % n, "&#%d=" % n]
un += ["&", "&;", "&#;", "&#x;", "&#X;", "&#", "&amp", "&ampx", "&AMP;", "&notin;", "&notit;", "&#0065", "&#x000041;",
       "&#00000000000000000065;", "&#" + "9" * 40 + ";", "&#x" + "f" * 40 + ";", "&#" + "0" * 20 + "7;", "&#x41;&#66;&#x43",
       "&amp;lt;b&amp;gt;", "&lt;&gt;&quot;&apos;&nbsp;", "AT&T", "a & b", "&&amp;", "&amp&amp;", "&#38;amp;", "&é;", "&😀;",
       "&" + "a" * 33 + ";", "&" + "a" * 32 + ";", "&ampamp;", "&notin", "&notit", "&para=1", "?a=1&copy=2&reg;", "&copy2",
       "&#x1F600;&#128512;", "&#128;&#129;&#130;&#141;&#159;&#160;", "&\t amp;", "&amp\n", "&á;", "caf&eacute; &Eacute;"]
# random mixtures
pieces = ["&", "#", "x", "X", ";", "=", " ", "amp", "lt", "gt", "copy", "not", "notin", "65", "0", "1f", "9", "é", "😀", "&amp;", "&#65;", "&#x41;",
          "&#128;", "&#xD800;", "&nbsp", "&frac12", "&frac12;", "&eacute", "&euro", "&Aacute;", "\n", "a"]
for _ in range(600):
    un.append("".join(random.choice(pieces) for _ in range(random.randint(1, 8))))
un = list(dict.fromkeys(un))

attr = []
for s in un:
    attr.append(s)
attr += ["a=1&copy=2", "x&amp;y", "x&ampy", "&amp=", "&#38=", "&notin;", "&notit;", "&lt", "&lt;", "&lt=", "&a;", "&1;", "&amp;amp;", "&#x26;"]
attr = list(dict.fromkeys(attr))

strs = ["", " ", "abc", " abc ", "\x85x\x85", "\x1cx\x1f", "a b", "a\xa0b", "﻿x﻿", "a  b\t\nc", "​z​",
        "x²", "²", "³¹", "٣", "፩", "٣٤", "abc123", "é", "é", "ß", "ς", "Σ", "ΑΣ", "ﬁ", "ſ", "İ", "ǅ", "Ⅷ", "½", "①", "ⅷ", "漢字", "一二",
        "😀", "a😀b", "x😀", "😀x", "\ud83d" if False else "z", "mañana", "Ação", "AÇÃO ÀÉ", "Ｆｕｌｌ", "ﬃ", "Ǆ", "ǆ", "’", "tab\there", "quote'", 'dq"', "both'\"",
        "back\\slash", "nl\nx", "\x00\x1f\x7f\x80\x9f", " ", "é", "😀\U0001f600", "\U000e0001", "\U0010ffff", "͸", "а", "Ѕ", "О ο"]
rand_alphabet = list("aAzZ09 \t\n\x85\xa0 ​　éÉßΣσςﬁ²٣፩Ⅷ½一😀̧́_-") + ["\U0001d7d8", "\U0001f600"]
for _ in range(300):
    strs.append("".join(random.choice(rand_alphabet) for _ in range(random.randint(0, 9))))
strs = list(dict.fromkeys(strs))

LOOK = str.maketrans("аеорсухіјѕАЕОРСУХІЈЅ" "οαε" "ΟΑΕ", "aeopcyxijsAEOPCYXIJS" "oae" "OAE")


def fold_nfd(v):
    import re
    v = re.sub(r"[̀-ͯ]", "", unicodedata.normalize("NFD", v))
    return v.casefold().strip()


def norm_render(t):
    t = unicodedata.normalize("NFKD", t)
    t = "".join(c for c in t if not unicodedata.combining(c))
    return " ".join(t.casefold().split())


def norm_merge(t):
    t = unicodedata.normalize("NFKC", t).translate(LOOK)
    return norm_render(t)


def cps(s):
    return list(s)


rows = []
for s in strs:
    n = len(s)
    rows.append({
        "s": s, "len": n, "first": s[:1], "last": s[-1:], "isalnum": s.isalnum(), "isdigit": s.isdigit(),
        "strip": s.strip(), "split": s.split(), "casefold": s.casefold(), "repr": repr(s),
        "slices": [[a, b, s[a:b]] for a, b in [(0, 3), (1, 2), (-2, None), (2, None), (0, -1), (-3, -1), (5, 3), (0, 20)]],
        "fold_nfd": fold_nfd(s), "norm_render": norm_render(s), "norm_merge": norm_merge(s),
    })
pairs = []
cmp_pool = strs + ["￿", "", "\U00010000", "a", "ab", "b", "퟿"]
for _ in range(400):
    a, b = random.choice(cmp_pool), random.choice(cmp_pool)
    pairs.append([a, b, (a > b) - (a < b)])

out = {
    "python": __import__("sys").version.split()[0],
    "unescape": [[s, html.unescape(s)] for s in un],
    "attr": [[s, html.parser._unescape_attrvalue(s)] for s in attr],
    "str": rows,
    "compare": pairs,
    "repr_misc": [[None, "None"], [True, "True"], [False, "False"], [3, "3"], [-2, "-2"], [2.5, "2.5"], [[1, "a"], "[1, 'a']"], [{"k": 'v'}, "{'k': 'v'}"]],
}
dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "fixtures", "py_vectors.json")
os.makedirs(os.path.dirname(dest), exist_ok=True)
with open(dest, "w") as f:
    json.dump(out, f, ensure_ascii=True, indent=0)
print(len(un), "unescape,", len(attr), "attr,", len(rows), "str,", len(pairs), "compare")
