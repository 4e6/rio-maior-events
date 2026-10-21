import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bareHost, cleanUrl, hostOf, quote, sameSite, unquote, urlencode, urljoin, urlsplit } from "../src/url.ts";

const BASE = "https://www.example.pt/agenda/";

describe("test_adapter_text", () => {
  // The URL half of the Python test: marked() takes each href through clean_url(base, href) and keeps
  // those the link regex matches; the page text feeds the hrefs through html.unescape (&amp; -> &).
  test("test_hrefs_are_resolved_cleaned_and_encoded", () => {
    const base = "https://www.example.pt/agenda/lista/";
    const hrefs = ["../../e/rel", "/e/abs#topo", "//www.example.pt/e/proto", "https://example.pt/e/bare-host",
      "/e/café — x", "/e/a%20b", "/e/q?a=1&b=é", "https://www.example.pt:443/e/port",
      "https://other.example/e/off", "mailto:x@example.pt", "javascript:void(0)", "#e/x"];
    const found = hrefs.map((h) => cleanUrl(base, h)).filter((u) => u && /\/e\//.test(u));
    expect(found).toEqual([
      "https://www.example.pt/e/rel", "https://www.example.pt/e/abs", "https://www.example.pt/e/proto",
      "https://example.pt/e/bare-host", "https://www.example.pt/e/caf%C3%A9%20%E2%80%94%20x",
      "https://www.example.pt/e/a%20b", "https://www.example.pt/e/q?a=1&b=%C3%A9",
      "https://www.example.pt/e/port", "https://other.example/e/off"]);
    // The Python test passes the off-site href through the link regex only; same_site filters it in _TextParser.
    expect(found.filter((u) => bareHost(u!) === bareHost(base)).length).toBe(8);
  });

  test("test_clean_url_gives_none_for_what_is_not_a_page", () => {
    for (const href of [null, "", "  ", "mailto:a@b.pt", "javascript:void(0)", "tel:123"]) {
      expect(cleanUrl(BASE, href), String(href)).toBeNull();
    }
  });
});

describe("test_runner", () => {
  test("hostname is lowercased and read from the source url", () => {
    expect(urlsplit("https://CM-TorresNovas.pt/x.rss").hostname).toBe("cm-torresnovas.pt");
    expect(urlsplit("https://cm.pt/a/b.rss").path.endsWith(".rss")).toBe(true);
    expect(hostOf("https://u@www.ex.pt:8080/p")).toBe("www.ex.pt");
    expect(hostOf("/relative")).toBeNull();
  });
});

describe("url", () => {
  test("clean_url drops default ports, fragments and keeps host case", () => {
    expect(cleanUrl("https://ex.pt/a/b?x=1", "https://EX.PT/É#f")).toBe("https://EX.PT/%C3%89");
    expect(cleanUrl(null, "http://ex.pt:80/x")).toBe("http://ex.pt/x");
    expect(cleanUrl(null, "http://ex.pt:443/x")).toBe("http://ex.pt:443/x");
    expect(cleanUrl(null, "https://ex.pt:abc/")).toBe("https://ex.pt:abc/");
    expect(cleanUrl(null, 5)).toBeNull();
  });

  test("same_site ignores a leading www", () => {
    expect(sameSite("https://www.ex.pt/a", "https://ex.pt/b")).toBe(true);
    expect(sameSite("https://www.ex.pt", "https://www2.ex.pt")).toBe(false);
  });

  test("urljoin, quote, unquote and urlencode basics", () => {
    expect(urljoin("http://a/b/c/d;p?q", "../../g")).toBe("http://a/g");
    expect(quote("é /", "/")).toBe("%C3%A9%20/");
    expect(unquote("%C3%A9%zz%")).toBe("é%zz%");
    expect(urlencode([["a b", "c&d"]])).toBe("a+b=c%26d");
  });

  test("a bad port throws only when read", () => {
    expect(() => urlsplit("https://ex.pt:abc/").port).toThrow();
    expect(urlsplit("https://ex.pt:/").port).toBeNull();
    expect(() => urlsplit("https://[::1/x")).toThrow();
  });
});

// Vectors from tools/gen_url_vectors.py (Python 3.14 answers on synthetic inputs).
const V = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "url-vectors.json"), "utf8"));
const attempt = (f: () => unknown) => { try { return f(); } catch { return "EXC"; } };

describe("vectors against Python 3.14", () => {
  test("urljoin", () => {
    for (const [b, r, want] of V.urljoin) expect(attempt(() => urljoin(b, r)), `${b} + ${r}`).toBe(want);
  });
  test("clean_url", () => {
    for (const [b, h, want] of V.clean) expect(attempt(() => cleanUrl(b, h)), `${b} + ${h}`).toBe(want);
  });
  test("quote", () => {
    for (const [s, safe, want] of V.quote) expect(quote(s, safe), `${s} | ${safe}`).toBe(want);
  });
  test("unquote", () => {
    for (const [s, want] of V.unquote) expect(unquote(s), s).toBe(want);
  });
  test("urlencode", () => {
    for (const [pairs, want] of V.urlencode) expect(urlencode(pairs)).toBe(want);
  });
  test("same_site", () => {
    for (const [a, b, want] of V.same_site) expect(sameSite(a, b), `${a} ${b}`).toBe(want);
  });
  test("host", () => {
    for (const [u, want] of V.host) expect(attempt(() => hostOf(u)), u).toBe(want);
  });
});
