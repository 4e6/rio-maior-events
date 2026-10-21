// Port of tests/python/test_runner.py: Encoding (inflate, fetch), garbled, Redirects, FetchFollow, SslContextTests,
// plus tests for POST/redirect/timeout/classification behaviour. A local Bun.serve; nothing leaves the machine.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, gzipSync, deflateRawSync } from "node:zlib";
import { classifyFailure, classifyFollowFailure } from "../src/net-errors.ts";
import {
  CERTS, HttpError, NetworkError, RedirectRefused, TimeoutError, caList, fetchFollow, fetchPage, fetchWith, garbled,
  inflate, toPage,
} from "../src/net.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();
const TEXT = enc.encode("<p>Concerto no Cineteatro. ".repeat(40));
const same = (a: Uint8Array, b: Uint8Array) => expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);

describe("Encoding", () => {
  test("test_gzip_with_header", () => same(inflate(gzipSync(TEXT), "gzip"), TEXT));
  test("test_gzip_without_header_by_magic_bytes", () => same(inflate(gzipSync(TEXT), null), TEXT));
  test("test_deflate_zlib_and_raw", () => {
    same(inflate(deflateSync(TEXT), "deflate"), TEXT);
    same(inflate(deflateRawSync(TEXT), "deflate"), TEXT);
  });
  test("test_plain_body_is_untouched", () => {
    same(inflate(TEXT, null), TEXT);
    same(inflate(TEXT, "identity"), TEXT);
  });
  test("trailing bytes after a gzip or zlib stream are ignored, like zlib.decompress", () => {
    same(inflate(new Uint8Array([...gzipSync(TEXT), 1, 2, 3]), null), TEXT);
    same(inflate(new Uint8Array([...deflateSync(TEXT), 9, 9]), "deflate"), TEXT);
    same(inflate(new Uint8Array([...deflateSync(TEXT), 9, 9]), "gzip"), TEXT);
  });
  test("a truncated stream throws", () => {
    expect(() => inflate(gzipSync(TEXT).subarray(0, 20), null)).toThrow();
  });
});

describe("garbled", () => {
  test("test_garbled_text_fails_its_source (the guard)", () => {
    const bytes = new Uint8Array(900).map((_, i) => i % 9);
    expect(garbled(bytes, null)).toBe(true);
  });
  test("test_normal_text_is_unaffected", () => {
    expect(garbled(enc.encode("<p>" + "evento ".repeat(60) + "</p>"), "text/html; charset=utf-8")).toBe(false);
    expect(garbled(enc.encode("Olá, São João – ação"), null)).toBe(false);
  });
  test("test_undecoded_gzip_reaching_the_runner_fails_the_source_as_unreadable (the guard)", () => {
    expect(garbled(gzipSync(TEXT), "text/html; charset=utf-8")).toBe(true);
  });
  test("an empty body is not garbled; invalid utf-8 falls back to latin-1", () => {
    expect(garbled(new Uint8Array(), null)).toBe(false);
    expect(garbled(new Uint8Array([0xe1, 0xe9, 0x41]), null)).toBe(false);
  });
});

// --- local server -------------------------------------------------------------------------------------------

const seen: { method: string; path: string; headers: Headers; body: string }[] = [];
let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      seen.push({ method: req.method, path: url.pathname, headers: req.headers, body: await req.text() });
      const html = { "Content-Type": "text/html; charset=utf-8" };
      switch (url.pathname) {
        case "/ok": return new Response("<p>ola</p>", { headers: html });
        case "/gz": return new Response(gzipSync(TEXT), { headers: { ...html, "Content-Encoding": "gzip" } });
        case "/gz-nohdr": return new Response(gzipSync(TEXT), { headers: html });
        case "/moved": return new Response(null, { status: 302, headers: { Location: `http://localhost:${server.port}/ok` } });
        case "/r301": return new Response(null, { status: 301, headers: { Location: "/ok" } });
        case "/r307": return new Response(null, { status: 307, headers: { Location: "/ok" } });
        case "/r308": return new Response(null, { status: 308, headers: { Location: "/ok" } });
        case "/r302-nolocation": return new Response(null, { status: 302 });
        case "/loop": return new Response(null, { status: 302, headers: { Location: "/loop" } });
        case "/chain": {
          const n = Number(url.searchParams.get("n") ?? 0);
          return new Response(null, { status: 302, headers: { Location: `/chain?n=${n + 1}` } });
        }
        case "/404": return new Response("no", { status: 404 });
        case "/503": return new Response("no", { status: 503 });
        case "/slow": await Bun.sleep(1500); return new Response("late");
        default: return new Response("?", { status: 404 });
      }
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(() => { server.stop(true); });

describe("fetch", () => {
  test("test_fetch_decompresses_gzip_with_the_header", async () => {
    const r = await fetchPage(`${base}/gz`, null);
    expect([r.status, r.contentType]).toEqual([200, "text/html; charset=utf-8"]);
    same(r.body, TEXT);
    expect(r.url).toBeUndefined();
  });
  test("test_fetch_decompresses_gzip_without_the_header", async () => {
    same((await fetchPage(`${base}/gz-nohdr`, null)).body, TEXT);
  });
  test("sends User-Agent, Accept-Language and Accept-Encoding gzip, deflate", async () => {
    seen.length = 0;
    await fetchPage(`${base}/ok`, null);
    const h = seen[0]!.headers;
    expect(h.get("user-agent")).toContain("rio-maior-events/1.0");
    expect(h.get("accept-language")).toBe("pt-PT,pt;q=0.9,en;q=0.5");
    expect(h.get("accept-encoding")).toBe("gzip, deflate");
  });
  test("a POST sends its body as a form", async () => {
    seen.length = 0;
    await fetchPage(`${base}/ok`, enc.encode("a=1&b=2"));
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.body).toBe("a=1&b=2");
    expect(seen[0]!.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
  });
  test("a 301 on a POST is followed as a GET without the body", async () => {
    seen.length = 0;
    const r = await fetchPage(`${base}/r301`, enc.encode("a=1"));
    expect(dec.decode(r.body)).toBe("<p>ola</p>");
    expect(seen.map((s) => `${s.method} ${s.path} ${s.body}`)).toEqual(["POST /r301 a=1", "GET /ok "]);
  });
  test("a 307 or 308 on a POST is an HttpError; on a GET it is followed", async () => {
    for (const code of [307, 308]) {
      const err = await fetchPage(`${base}/r${code}`, enc.encode("a=1")).catch((e) => e);
      expect(err).toBeInstanceOf(HttpError);
      expect(err.code).toBe(code);
      expect(dec.decode((await fetchPage(`${base}/r${code}`, null)).body)).toBe("<p>ola</p>");
    }
  });
  test("a redirect without Location is an HttpError", async () => {
    const err = await fetchPage(`${base}/r302-nolocation`, null).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.code).toBe(302);
  });
  test("a redirect loop and more than 10 hops are HttpErrors", async () => {
    expect(await fetchPage(`${base}/loop`, null).catch((e) => e)).toBeInstanceOf(HttpError);
    expect(await fetchPage(`${base}/chain`, null).catch((e) => e)).toBeInstanceOf(HttpError);
  });
  test("a non-2xx answer is an HttpError with its code", async () => {
    const err = await fetchPage(`${base}/404`, null).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect([err.code, err.reason]).toEqual([404, "Not Found"]);
  });
  test("a refused connection is a NetworkError", async () => {
    const dead = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    const port = dead.port;
    dead.stop(true);
    expect(await fetchPage(`http://127.0.0.1:${port}/`, null).catch((e) => e)).toBeInstanceOf(NetworkError);
  });
  test("a slow answer is a TimeoutError", async () => {
    const err = await fetchWith(`${base}/slow`, null, { timeoutMs: 200 }).catch((e) => e);
    expect(err).toBeInstanceOf(TimeoutError);
  });
});

describe("FetchFollow", () => {
  test("test_a_page_comes_back_with_its_final_url", async () => {
    const url = `${base}/ok`;
    const r = await fetchFollow(url, null);
    expect([r.status, dec.decode(r.body), r.contentType, r.url]).toEqual([200, "<p>ola</p>", "text/html; charset=utf-8", url]);
  });
  test("test_a_redirect_away_from_the_host_is_refused", async () => {
    seen.length = 0;
    expect(await fetchFollow(`${base}/moved`, null).catch((e) => e)).toBeInstanceOf(RedirectRefused);
    expect(seen.map((s) => s.path)).toEqual(["/moved"]); // the target was never requested
  });
  test("a same-host redirect over http is refused (only https is followed)", async () => {
    expect(await fetchFollow(`${base}/r301`, null).catch((e) => e)).toBeInstanceOf(RedirectRefused);
  });
  test("toPage takes the final URL", () => {
    expect(toPage({ url: "u", data: null }, { status: 200, body: TEXT, contentType: null, url: "f" }).url).toBe("f");
    expect(toPage({ url: "u", data: null }, { status: 200, body: TEXT, contentType: null }).url).toBe("u");
  });
});

// --- TLS against a local CA chain: root > intermediate > leaf (the server sends the leaf only) ---------------------

const openssl = Bun.which("openssl");
const pki = { dir: "", root: "", int: "" };
let tlsServer: ReturnType<typeof Bun.serve>;

function sh(cmd: string[], cwd: string) {
  const r = Bun.spawnSync(cmd, { cwd, stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${r.stderr.toString()}`);
}

describe.skipIf(!openssl)("SslContextTests", () => {
  beforeAll(() => {
    const d = (pki.dir = mkdtempSync(join(tmpdir(), "net-pki-")));
    writeFileSync(join(d, "int.ext"), "basicConstraints=critical,CA:TRUE\nkeyUsage=keyCertSign\n");
    writeFileSync(join(d, "leaf.ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\n");
    sh(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "root.key", "-out", "root.pem", "-subj", "/CN=Test Root",
      "-days", "5", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=keyCertSign"], d);
    sh(["openssl", "req", "-newkey", "rsa:2048", "-nodes", "-keyout", "int.key", "-out", "int.csr", "-subj", "/CN=Test Int"], d);
    sh(["openssl", "x509", "-req", "-in", "int.csr", "-CA", "root.pem", "-CAkey", "root.key", "-CAcreateserial", "-out", "int.pem",
      "-days", "5", "-extfile", "int.ext"], d);
    sh(["openssl", "req", "-newkey", "rsa:2048", "-nodes", "-keyout", "leaf.key", "-out", "leaf.csr", "-subj", "/CN=localhost"], d);
    sh(["openssl", "x509", "-req", "-in", "leaf.csr", "-CA", "int.pem", "-CAkey", "int.key", "-CAcreateserial", "-out", "leaf.pem",
      "-days", "5", "-extfile", "leaf.ext"], d);
    pki.root = readFileSync(join(d, "root.pem"), "utf8");
    pki.int = readFileSync(join(d, "int.pem"), "utf8");
    tlsServer = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { key: Bun.file(join(d, "leaf.key")), cert: Bun.file(join(d, "leaf.pem")) },
      fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === "/ok") return new Response("<p>seguro</p>", { headers: { "Content-Type": "text/html" } });
        if (u.pathname === "/same") return new Response(null, { status: 302, headers: { Location: "/ok" } });
        if (u.pathname === "/www") return new Response(null, { status: 302, headers: { Location: `https://localhost:${tlsServer.port}/ok` } });
        if (u.pathname === "/http") return new Response(null, { status: 302, headers: { Location: `http://127.0.0.1:${tlsServer.port}/ok` } });
        return new Response("?", { status: 404 });
      },
    });
  });
  afterAll(() => { tlsServer.stop(true); });

  const url = (p: string) => `https://127.0.0.1:${tlsServer.port}${p}`;

  test("test_context_loads_the_intermediates_and_verifies", () => {
    const list = caList();
    const extra = list[list.length - 1]!;
    expect(extra).toBe(readFileSync(CERTS, "utf8"));
    expect((extra.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length).toBe(3);
    expect(list.length).toBeGreaterThan(50); // the default roots are kept
    // verification is on: the real roots do not vouch for the local chain
    return expect(fetchWith(url("/ok"), null, { ca: list })).rejects.toBeInstanceOf(NetworkError);
  });

  test("the intermediates are not trust anchors: without a root above them the chain fails", async () => {
    await expect(fetchWith(url("/ok"), null, { ca: [pki.int] })).rejects.toBeInstanceOf(NetworkError);
    await expect(fetchWith(url("/ok"), null, { ca: [pki.root] })).rejects.toBeInstanceOf(NetworkError); // leaf only sent
    const r = await fetchWith(url("/ok"), null, { ca: [pki.root, pki.int] });
    expect(dec.decode(r.body)).toBe("<p>seguro</p>");
  });

  test("test_a_redirect_on_the_same_host_over_https_is_followed", async () => {
    const r = await fetchWith(url("/same"), null, { ca: [pki.root, pki.int], follow: true });
    expect([r.status, r.url]).toEqual([200, url("/ok")]);
  });

  test("test_a_redirect_to_another_host_or_to_http_is_refused_before_it_is_requested", async () => {
    for (const p of ["/www", "/http"]) { // localhost vs 127.0.0.1, and https vs http
      const err = await fetchWith(url(p), null, { ca: [pki.root, pki.int], follow: true }).catch((e) => e);
      expect(err, p).toBeInstanceOf(RedirectRefused);
    }
  });
});

test("test_a_missing_file_fails_loudly", () => {
  expect(() => caList(join(tmpdir(), "no-such-intermediates.pem"))).toThrow();
});

describe("classification", () => {
  test("HTTP codes: 403, 429 and 5xx refuse; others fail only the source", () => {
    expect(classifyFailure(new HttpError(404, "Not Found"))).toEqual({ status: 404, message: "HTTP 404 Not Found", refused: false });
    for (const code of [403, 429, 500, 503]) expect(classifyFailure(new HttpError(code, "x")).refused).toBe(true);
    expect(classifyFailure(new HttpError(302, "x")).refused).toBe(false);
  });
  test("timeouts and network errors refuse; the message is Class: message", () => {
    expect(classifyFailure(new TimeoutError("t"))).toEqual({ status: null, message: "TimeoutError: t", refused: true });
    expect(classifyFailure(new NetworkError("n", "ECONNREFUSED"))).toEqual({ status: null, message: "URLError: n", refused: true });
  });
  test("other errors fail only the source", () => {
    expect(classifyFailure(new Error("zlib"))).toEqual({ status: null, message: "Error: zlib", refused: false });
    expect(classifyFailure(new RedirectRefused("r")).refused).toBe(false);
  });
  test("follow failures: skip or stop", () => {
    expect(classifyFollowFailure(new RedirectRefused("r"))).toBe("skip");
    expect(classifyFollowFailure(new HttpError(404, "x"))).toBe("skip");
    for (const code of [403, 429, 500]) expect(classifyFollowFailure(new HttpError(code, "x"))).toBe("stop");
    expect(classifyFollowFailure(new TimeoutError("t"))).toBe("stop");
    expect(classifyFollowFailure(new NetworkError("n"))).toBe("stop");
    expect(classifyFollowFailure(new Error("x"))).toBe("skip");
  });
});
