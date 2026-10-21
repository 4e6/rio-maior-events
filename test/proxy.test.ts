// The fallback proxy. Integration tests (net.ts) run against a local CONNECT proxy and a local HTTPS origin whose
// certificate comes from a throwaway CA (test/fixtures/proxy-tls); a fresh pair per case, and every proxied request opens
// its own tunnel. Unit tests (collect.ts) inject a proxy fetcher beside the direct one. Nothing leaves the machine.
import { afterEach, describe, expect, test } from "bun:test";
import net from "node:net";
import tls from "node:tls";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { ADAPTERS } from "../src/adapters/index.ts";
import type { Page, Request } from "../src/adapters/types.ts";
import { collectAll, main, runHost } from "../src/collect.ts";
import type { MainDeps, ProxyFetchers } from "../src/collect.ts";
import { HttpError, NetworkError, ProxyError, RedirectRefused, TimeoutError, triggersFallback } from "../src/net-errors.ts";
import { PROXY_REQUEST_BYTES, PROXY_TUNNEL_BYTES, ProxyGateway, fetchWith } from "../src/net.ts";
import type { FetchResult, Fetcher } from "../src/net.ts";
import { WINDOW } from "./helpers.ts";

const FIX = join(import.meta.dir, "fixtures", "proxy-tls");
const CA = [...tls.getCACertificates("default"), readFileSync(join(FIX, "ca.pem"), "utf8")];
const USER = "Zq9us@er", PASS = "Wx7p#ass";
const dec = new TextDecoder();

// --- a local world: HTTPS origin + CONNECT proxy ----------------------------------------------------------------

type Mode = "ok" | "407" | "402" | "502" | "503" | "drop";
type World = Awaited<ReturnType<typeof world>>;
const stops: (() => void)[] = [];
afterEach(() => { while (stops.length) stops.pop()!(); });

async function world(maxMb?: number) {
  const hits: string[] = [];
  const origin = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    tls: { cert: readFileSync(join(FIX, "srv.pem"), "utf8"), key: readFileSync(join(FIX, "srv.key"), "utf8") },
    fetch(req) {
      const path = new URL(req.url).pathname;
      hits.push(`${req.method} ${path} ${req.headers.get("user-agent") ?? ""}`);
      if (path === "/gz") return new Response(gzipSync("hello gzip world"), { headers: { "Content-Encoding": "gzip", "Content-Type": "text/plain" } });
      if (path === "/redir") return new Response(null, { status: 302, headers: { Location: "/ok" } });
      if (path === "/away") return new Response(null, { status: 302, headers: { Location: "https://elsewhere.invalid/x" } });
      if (path === "/403") return new Response("no", { status: 403 });
      if (path === "/404") return new Response("none", { status: 404 });
      return new Response("plain ok");
    },
  });
  const state = { mode: "ok" as Mode, connects: 0, auth: [] as (string | undefined)[], targets: [] as string[] };
  const proxy = net.createServer((c) => {
    c.once("data", (buf) => {
      const head = buf.toString("latin1");
      const line = head.split("\r\n")[0]!;
      state.connects++;
      state.auth.push(/proxy-authorization: *([^\r\n]+)/i.exec(head)?.[1]);
      const status = { "407": "407 Proxy Authentication Required", "402": "402 Payment Required", "502": "502 Bad Gateway", "503": "503 Service Unavailable" } as Record<string, string>;
      if (state.mode === "drop") { c.destroy(); return; }
      if (state.mode !== "ok") { c.end(`HTTP/1.1 ${status[state.mode]}\r\nContent-Length: 0\r\n\r\n`); return; }
      const target = line.split(" ")[1]!;
      state.targets.push(target);
      const port = Number(target.split(":")[1]);
      const up = net.connect(port, "127.0.0.1", () => { c.write("HTTP/1.1 200 Connection Established\r\n\r\n"); up.pipe(c); c.pipe(up); });
      up.on("error", () => c.destroy());
      c.on("error", () => up.destroy());
    });
    c.on("error", () => {});
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", () => r()));
  const pport = (proxy.address() as net.AddressInfo).port;
  const url = `http://${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}@127.0.0.1:${pport}`;
  const gateway = new ProxyGateway(url, { ca: CA, maxBytes: maxMb === undefined ? undefined : maxMb * 1048576 });
  stops.push(() => { origin.stop(true); proxy.close(); });
  return { origin, hits, state, gateway, url, base: `https://localhost:${origin.port}` };
}

describe("through a local CONNECT proxy", () => {
  test("HTTPS is tunnelled with the credentials and read end to end (gzip, our User-Agent, a followed redirect)", async () => {
    const w = await world();
    const gz = await w.gateway.fetch(w.base + "/gz", null);
    expect(dec.decode(gz.body)).toBe("hello gzip world");
    expect(w.state.connects).toBe(1);
    expect(w.state.targets[0]).toBe(`localhost:${w.origin.port}`);
    const basic = w.state.auth[0]!;
    expect(Buffer.from(basic.replace(/^Basic /, ""), "base64").toString()).toBe(`${USER}:${PASS}`);
    expect(w.hits[0]).toContain("rio-maior-events/1.0");
    const redirected = await w.gateway.followFetch(w.base + "/redir", null);
    expect(dec.decode(redirected.body)).toBe("plain ok");
    expect(redirected.url).toBe(w.base + "/ok");
    expect(w.state.connects).toBe(3); // each hop opens its own tunnel
  });

  test("TLS is verified against our CA list through the tunnel: an unknown CA fails, and says nothing of the proxy", async () => {
    const w = await world();
    const error = await fetchWith(w.base + "/ok", null, { proxy: w.gateway, ca: tls.getCACertificates("default") }).catch((e) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(ProxyError);
    expect(triggersFallback(error)).toBe(false);
    expect(w.gateway.dead).toBeNull();
    expect(JSON.stringify(error.message)).not.toContain("127.0.0.1");
  });

  test("status codes of the site pass through the tunnel, and only a 403 or 5xx would trigger a fallback", async () => {
    const w = await world();
    const e403 = await w.gateway.fetch(w.base + "/403", null).catch((e) => e);
    expect(e403).toBeInstanceOf(HttpError);
    expect(e403.code).toBe(403);
    const e404 = await w.gateway.fetch(w.base + "/404", null).catch((e) => e);
    expect(e404.code).toBe(404);
    expect(w.gateway.dead).toBeNull();
    const away = await w.gateway.followFetch(w.base + "/away", null).catch((e) => e);
    expect(away).toBeInstanceOf(RedirectRefused);
  });

  test("direct requests never go through the proxy, and a proxied one does not reuse a direct connection", async () => {
    const w = await world();
    await fetchWith(w.base + "/ok", null, { ca: CA });
    expect(w.state.connects).toBe(0);
    await w.gateway.fetch(w.base + "/ok", null);
    await fetchWith(w.base + "/ok", null, { ca: CA });
    expect(w.state.connects).toBe(1);
  });

  test("407 and 402 from the gateway kill the proxy for the run: no further tunnel is opened", async () => {
    for (const mode of ["407", "402"] as const) {
      const w = await world();
      w.state.mode = mode;
      const error = await w.gateway.fetch(w.base + "/ok", null).catch((e) => e);
      expect(error).toBeInstanceOf(ProxyError);
      expect(error.message).toBe(`proxy failed: ${mode}`);
      expect(error.dead).toBe(true);
      expect(w.gateway.dead).toBe(`proxy failed: ${mode}`);
      w.state.mode = "ok";
      const again = await w.gateway.fetch(w.base + "/ok", null).catch((e) => e);
      expect(again).toBeInstanceOf(ProxyError);
      expect(again.message).toBe(`proxy failed: ${mode}`);
      expect(w.state.connects).toBe(1);
    }
  });

  test("a gateway 502 or 503 is not fatal: the next request may still use the proxy", async () => {
    const w = await world();
    for (const mode of ["502", "503"] as const) {
      w.state.mode = mode;
      const error = await w.gateway.fetch(w.base + "/ok", null).catch((e) => e);
      expect(error).toBeInstanceOf(ProxyError);
      expect(error.message).toBe(`proxy failed: ${mode}`);
      expect(error.dead).toBe(false);
    }
    expect(w.gateway.dead).toBeNull();
    w.state.mode = "ok";
    expect(dec.decode((await w.gateway.fetch(w.base + "/ok", null)).body)).toBe("plain ok");
  });

  test("a proxy that cannot be reached is dead for the run", async () => {
    const w = await world();
    const free = await new Promise<number>((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
    const gateway = new ProxyGateway(`http://u:p@127.0.0.1:${free}`, { ca: CA });
    const error = await gateway.fetch(w.base + "/ok", null).catch((e) => e);
    expect(error).toBeInstanceOf(ProxyError);
    expect(error.message).toBe("proxy failed: ECONNREFUSED");
    expect(gateway.dead).toBe("proxy failed: ECONNREFUSED");
    const gone = new ProxyGateway("http://u:p@proxy-host.invalid:823", { ca: CA });
    const dns = await gone.fetch(w.base + "/ok", null).catch((e) => e);
    expect(dns.message).toBe("proxy failed: ENOTFOUND");
    expect(dns.message).not.toContain("proxy-host");
  });

  test("a dropped tunnel is a network error with the proxy's details scrubbed", async () => {
    const w = await world();
    w.state.mode = "drop";
    const error = await w.gateway.fetch(w.base + "/ok", null).catch((e) => e);
    expect(error).toBeInstanceOf(NetworkError);
    for (const secret of [USER, PASS, "127.0.0.1", String(new URL(w.url).port)]) expect(String(error.message)).not.toContain(secret);
  });

  test("the budget is an estimate: body bytes plus 2 KB a request and 8 KB a tunnel, per host and per run, and it stops requests", async () => {
    const w = await world(0.015); // about 15 KB: one request (10 KB + body) fits, the second reaches it
    const first = await w.gateway.fetch(w.base + "/ok", null);
    expect(w.gateway.bytes).toBe(first.body.length + PROXY_REQUEST_BYTES + PROXY_TUNNEL_BYTES);
    expect(w.gateway.stats().hosts).toEqual({ localhost: w.gateway.bytes });
    await w.gateway.fetch(w.base + "/ok", null);
    const error = await w.gateway.fetch(w.base + "/ok", null).catch((e) => e);
    expect(error).toBeInstanceOf(ProxyError);
    expect(error.message).toBe("proxy budget reached");
    expect(error.dead).toBe(false);
    expect(w.state.connects).toBe(2);
    expect(w.gateway.stats().max_bytes).toBe(Math.floor(0.015 * 1048576));
  });

  test("scrub removes the URL, host, user and password, raw and percent-decoded", async () => {
    const w = await world();
    const port = new URL(w.url).port;
    const text = [w.url, USER, PASS, encodeURIComponent(USER), encodeURIComponent(PASS), `127.0.0.1:${port}`, "127.0.0.1",
      Buffer.from(`${USER}:${PASS}`).toString("base64")].join(" | ");
    const out = w.gateway.scrub(`failed: ${text}`);
    for (const secret of [USER, PASS, encodeURIComponent(USER), encodeURIComponent(PASS), "127.0.0.1", Buffer.from(`${USER}:${PASS}`).toString("base64")]) {
      expect(out).not.toContain(secret);
    }
    expect(w.gateway.maskValues).toEqual(expect.arrayContaining([USER, PASS, "127.0.0.1"]));
  });
});

describe("ProxyGateway.fromEnv", () => {
  test("off without the variable; the budget from FALLBACK_PROXY_MAX_MB, 30 MB by default", () => {
    expect(ProxyGateway.fromEnv({})).toBeNull();
    expect(ProxyGateway.fromEnv({ FALLBACK_PROXY_URL: "  " })).toBeNull();
    expect(ProxyGateway.fromEnv({ FALLBACK_PROXY_URL: "http://u:p@gw.example:823" })!.maxBytes).toBe(30 * 1048576);
    expect(ProxyGateway.fromEnv({ FALLBACK_PROXY_URL: "http://u:p@gw.example:823", FALLBACK_PROXY_MAX_MB: "5" })!.maxBytes).toBe(5 * 1048576);
    expect(ProxyGateway.fromEnv({ FALLBACK_PROXY_URL: "http://u:p@gw.example:823", FALLBACK_PROXY_MAX_MB: "lots" })!.maxBytes).toBe(30 * 1048576);
  });

  test("a bad URL throws a message without it", () => {
    for (const bad of ["not a url with secretpw", "socks5://u:secretpw@gw.example:1080"]) {
      const error = (() => { try { ProxyGateway.fromEnv({ FALLBACK_PROXY_URL: bad }); } catch (e) { return e as Error; } })();
      expect(error).toBeInstanceOf(Error);
      expect(error!.message).not.toContain("secretpw");
      expect(error!.message).not.toContain("gw.example");
    }
  });
});

// --- the trigger -------------------------------------------------------------------------------------------------

describe("what triggers a fallback", () => {
  test("a timeout, a connection reset or refusal, a 403 and a 5xx", () => {
    for (const error of [new TimeoutError("t"), new NetworkError("x", "ECONNRESET"), new NetworkError("x", "ECONNREFUSED"),
      new NetworkError("x", "ConnectionClosed"), new HttpError(403, "x"), new HttpError(500, "x"), new HttpError(503, "x")]) {
      expect(triggersFallback(error)).toBe(true);
    }
  });
  test("not a 429, a 404 or other 4xx, a TLS or DNS error, a redirect refusal, a parse failure or a proxy failure", () => {
    for (const error of [new HttpError(429, "x"), new HttpError(404, "x"), new HttpError(410, "x"), new HttpError(301, "x"),
      new NetworkError("x", "ENOTFOUND"), new NetworkError("x", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"), new NetworkError("x"),
      new RedirectRefused("x"), new Error("parse"), new ProxyError("proxy failed: 502")]) {
      expect(triggersFallback(error)).toBe(false);
    }
  });
});

// --- collect.ts: direct first, then the proxy --------------------------------------------------------------------

const enc = new TextEncoder();
const PAGE = enc.encode(`<p>${"evento ".repeat(60)}</p>`);
const ok = (): FetchResult => ({ status: 200, body: PAGE, contentType: null });
const req = (url: string): Request => ({ url, data: null });
const http = (code: number) => new HttpError(code, "x");
const REFUSALS = [http(403), http(500), http(503), new TimeoutError("timed out"), new NetworkError("reset", "ECONNRESET"), new NetworkError("refused", "ECONNREFUSED")];

/** A fake pair of fetchers that records what each saw. */
function recorder(directError: (url: string) => unknown, proxyError: (url: string) => unknown = () => null) {
  const log: string[] = [];
  const make = (via: string, fail: (url: string) => unknown): Fetcher => async (url) => {
    log.push(`${via} ${url}`);
    const err = fail(url);
    if (err) throw err;
    return ok();
  };
  const proxy: ProxyFetchers = { fetch: make("proxy", proxyError), followFetch: make("proxy-follow", proxyError) };
  return { log, direct: make("direct", directError), directFollow: make("direct-follow", directError), proxy };
}

const clockDeps = () => {
  const c = { now: 0, sleeps: [] as number[] };
  return { c, sleep: async (s: number) => { c.sleeps.push(s); c.now += s; }, clock: () => c.now };
};
const jobs = (...names: string[]): [string, Request[]][] => names.map((n) => [n, [req("https://h.example/" + n)]]);

describe("runHost with a proxy", () => {
  test("a refused direct request is retried once through the proxy, and the host's other sources go straight to it", async () => {
    for (const refusal of REFUSALS) {
      const r = recorder((url) => (url.endsWith("/a") ? refusal : null));
      // a is refused; b and c must not try direct again
      const direct: Fetcher = async (url) => { r.log.push(`direct ${url}`); throw refusal; };
      const { c, sleep, clock } = clockDeps();
      const outcomes = await runHost("h.example", jobs("a", "b", "c"), { fetch: direct, sleep, clock, delay: 2, proxy: r.proxy });
      expect(r.log).toEqual(["direct https://h.example/a", "proxy https://h.example/a", "proxy https://h.example/b", "proxy https://h.example/c"]);
      expect(Object.values(outcomes).map((o) => o.error)).toEqual([null, null, null]);
      expect(Object.values(outcomes).every((o) => o.viaProxy)).toBe(true);
      expect(c.sleeps).toEqual([2, 2, 2]); // the retry waits the delay too
    }
  });

  test("a source read directly before the refusal is not marked, the one after is", async () => {
    const r = recorder((url) => (url.endsWith("/b") ? http(403) : null));
    const { sleep, clock } = clockDeps();
    const outcomes = await runHost("h.example", jobs("a", "b", "c"), { fetch: r.direct, sleep, clock, delay: 0, proxy: r.proxy });
    expect(r.log).toEqual(["direct https://h.example/a", "direct https://h.example/b", "proxy https://h.example/b", "proxy https://h.example/c"]);
    expect(outcomes.a!.viaProxy).toBeUndefined();
    expect(outcomes.b!.viaProxy).toBe(true);
  });

  test("404, other 4xx, 429, DNS and TLS errors, redirect refusals and unknown errors never fall back", async () => {
    for (const error of [http(404), http(410), http(429), new NetworkError("dns", "ENOTFOUND"), new NetworkError("tls", "CERT_HAS_EXPIRED"), new RedirectRefused("x"), new Error("x")]) {
      const r = recorder(() => error);
      const { sleep, clock } = clockDeps();
      await runHost("h.example", jobs("a", "b"), { fetch: r.direct, sleep, clock, delay: 0, proxy: r.proxy });
      expect(r.log.some((l) => l.startsWith("proxy"))).toBe(false);
    }
  });

  test("without a proxy a refusal ends the host as before", async () => {
    const r = recorder(() => http(403));
    const { sleep, clock } = clockDeps();
    const outcomes = await runHost("h.example", jobs("a", "b"), { fetch: r.direct, sleep, clock, delay: 0 });
    expect(r.log).toEqual(["direct https://h.example/a"]);
    expect(outcomes.b!.error).toBe("skipped: h.example refused or did not answer");
  });

  test("a refusal through the proxy ends the host as a refusal", async () => {
    const r = recorder(() => http(403), () => http(403));
    const { sleep, clock } = clockDeps();
    const outcomes = await runHost("h.example", jobs("a", "b"), { fetch: r.direct, sleep, clock, delay: 0, proxy: r.proxy });
    expect(r.log).toEqual(["direct https://h.example/a", "proxy https://h.example/a"]);
    expect(outcomes.a).toMatchObject({ error: "HTTP 403 x", refused: true });
    expect(outcomes.b!.error).toBe("skipped: h.example refused or did not answer");
  });

  test("a proxy that is dead or out of budget fails the source with its own words and is not the site refusing", async () => {
    for (const message of ["proxy failed: 407", "proxy budget reached", "proxy failed: 502"]) {
      const r = recorder(() => http(403), () => new ProxyError(message, message.endsWith("407")));
      const { sleep, clock } = clockDeps();
      const outcomes = await runHost("h.example", jobs("a", "b"), { fetch: r.direct, sleep, clock, delay: 0, proxy: r.proxy });
      expect(outcomes.a!.error).toBe(message);
      expect(outcomes.a!.refused).toBeUndefined();
      expect(outcomes.b!.error).toBe(`skipped: ${message}`);
      expect(outcomes.b!.refused).toBeUndefined();
      expect(r.log).toEqual(["direct https://h.example/a", "proxy https://h.example/a"]);
    }
  });

  test("follows: a follow refused directly switches the host and is retried once; later follows go through the proxy", async () => {
    const r = recorder(() => null);
    const direct: Fetcher = async (url) => { r.log.push(`direct ${url}`); if (url.endsWith("/f2")) throw http(403); return ok(); };
    const { sleep, clock } = clockDeps();
    const followed: [string, string[], boolean][] = [];
    await runHost("h.example", jobs("a"), {
      fetch: r.direct, followFetch: direct, sleep, clock, delay: 0, proxy: r.proxy,
      onDone: () => [req("https://h.example/f1"), req("https://h.example/f2"), req("https://h.example/f3")],
      onFollowed: (name, pages: Page[], viaProxy) => followed.push([name, pages.map((p) => p.url), viaProxy]),
    });
    expect(r.log).toEqual(["direct https://h.example/a", "direct https://h.example/f1", "direct https://h.example/f2",
      "proxy-follow https://h.example/f2", "proxy-follow https://h.example/f3"]);
    expect(followed).toEqual([["a", ["https://h.example/f1", "https://h.example/f2", "https://h.example/f3"], true]]);
  });

  test("follows: a refusal through the proxy stops the follows; a direct-only host reports no proxy", async () => {
    const r = recorder(() => null, () => http(503));
    const direct: Fetcher = async (url) => { if (url.endsWith("/f2")) throw http(403); return ok(); };
    const { sleep, clock } = clockDeps();
    const seen: [string[], boolean][] = [];
    await runHost("h.example", jobs("a"), {
      fetch: r.direct, followFetch: direct, sleep, clock, delay: 0, proxy: r.proxy,
      onDone: () => [req("https://h.example/f1"), req("https://h.example/f2"), req("https://h.example/f3")],
      onFollowed: (_n, pages, via) => seen.push([pages.map((p) => p.url), via]),
    });
    expect(r.log).toEqual(["direct https://h.example/a", "proxy-follow https://h.example/f2"]);
    expect(seen).toEqual([[["https://h.example/f1"], true]]);
    const clean = recorder(() => null);
    const seen2: boolean[] = [];
    await runHost("h.example", jobs("a"), {
      fetch: clean.direct, followFetch: clean.directFollow, sleep, clock, delay: 0, proxy: clean.proxy,
      onDone: () => [req("https://h.example/f1")], onFollowed: (_n, _p, via) => seen2.push(via),
    });
    expect(seen2).toEqual([false]);
  });

  test("a proxy failure on a follow ends the host's follows", async () => {
    const r = recorder(() => null, () => new ProxyError("proxy failed: 502"));
    const direct: Fetcher = async (url) => { if (url.includes("/f")) throw http(403); return ok(); };
    const { sleep, clock } = clockDeps();
    await runHost("h.example", jobs("a"), {
      fetch: r.direct, followFetch: direct, sleep, clock, delay: 0, proxy: r.proxy,
      onDone: () => [req("https://h.example/f1"), req("https://h.example/f2")],
    });
    expect(r.log).toEqual(["direct https://h.example/a", "proxy-follow https://h.example/f1"]);
  });
});

describe("collectAll with a proxy", () => {
  const source = (name: string, host: string) => ({ name, label: name, url: `https://${host}/`, town: "T", adapter: "text", group: "g" }) as any;
  const textAdapter = { parse: (_s: any, pages: Page[]) => ({ items: [], past: [], text: dec.decode(pages[0]!.body).replace(/<[^>]*>/g, ""), truncated: false, note: null }) } as any;

  test("only the refused host goes through the proxy; sources carry via and the summary line says so", async () => {
    const lines: string[] = [];
    const log: string[] = [];
    const direct: Fetcher = async (url) => { log.push("direct " + url); if (url.includes("bad.example")) throw http(403); return ok(); };
    const proxy: ProxyFetchers = { fetch: async (url) => { log.push("proxy " + url); return ok(); }, followFetch: async () => ok() };
    const results = await collectAll([source("one", "good.example"), source("two", "bad.example"), source("three", "bad.example")], WINDOW, {}, 0,
      { fetch: direct, proxy, sleep: async () => {}, adapters: { ...ADAPTERS, text: textAdapter }, maxWorkers: 1, report: (l) => lines.push(l) });
    expect(results.map((r) => [r.name, r.ok, r.via ?? null])).toEqual([["one", true, null], ["two", true, "proxy"], ["three", true, "proxy"]]);
    expect(log.filter((l) => l.startsWith("direct") && l.includes("bad.example"))).toHaveLength(1);
    expect(lines.filter((l) => l.includes("(via proxy)"))).toHaveLength(2);
    expect(lines.find((l) => l.startsWith("one"))).not.toContain("proxy");
  });
});

// --- main(): the secret is in no output ----------------------------------------------------------------------------

describe("main with FALLBACK_PROXY_URL", () => {
  async function runMain(env: Record<string, string>, w: World | null, fetch: Fetcher) {
    const dir = join(mkdtempSync(join(tmpdir(), "collect-")), "collected");
    const out: string[] = [];
    const err: string[] = [];
    const deps: MainDeps = {
      fetch, sleep: async () => {}, clock: () => 0, maxWorkers: 1, adapters: { ...ADAPTERS, text: { parse: () => ({ items: [], past: [], text: "x".repeat(300), truncated: false, note: null }) } as any },
      out: (l) => out.push(l), err: (l) => err.push(l), env: { ...env, ...(w ? { FALLBACK_PROXY_URL: w.url } : {}) },
    };
    const code = await main([dir, "--only", "cineteatro", "mcr-caldas", "--from", "2026-10-20"], deps);
    const files = existsSync(dir) ? readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")) : [];
    return { code, out, err, files, dir };
  }
  // cineteatro answers; mcr-caldas is refused directly and then fails at the proxy
  const direct: Fetcher = async (url) => { if (url.includes("cineteatrorm.pt")) return ok(); throw http(403); };

  test("a failing proxy (407, 502, dropped) leaves its URL, host, user and password out of every output", async () => {
    for (const mode of ["407", "502", "drop"] as const) {
      const w = await world();
      w.state.mode = mode;
      const r = await runMain({ GITHUB_ACTIONS: "true" }, w, direct);
      expect(r.code).toBe(0);
      const masks = r.out.filter((l) => l.startsWith("::add-mask::")).map((l) => l.slice("::add-mask::".length));
      expect(masks.sort()).toEqual([PASS, USER, encodeURIComponent(PASS), encodeURIComponent(USER), "127.0.0.1"].sort());
      const everything = [...r.out.filter((l) => !l.startsWith("::add-mask::")), ...r.err, ...r.files].join("\n");
      for (const secret of [USER, PASS, encodeURIComponent(USER), encodeURIComponent(PASS), "127.0.0.1", new URL(w.url).port,
        Buffer.from(`${USER}:${PASS}`).toString("base64")]) {
        expect(everything).not.toContain(secret);
      }
      const index = JSON.parse(r.files.find((f) => f.includes('"collected_at"') && f.includes('"proxy"'))!);
      expect(index.proxy.max_bytes).toBe(30 * 1048576);
      const two = index.sources.find((s: any) => s.name === "mcr-caldas");
      expect(two.ok).toBe(false);
      // a gateway answering 407 or 502 is not the site refusing; a tunnel dropped without an answer cannot be told apart
      expect(two.refused).toBe(mode === "drop");
      if (mode === "407") expect(two.error).toBe("proxy failed: 407");
      if (mode === "502") expect(two.error).toBe("proxy failed: 502");
      expect(typeof index.collect_s).toBe("number");
    }
  });

  test("a working proxy: the refused source is read through it and the index and summary say so", async () => {
    const w = await world();
    // the proxied request goes to the local origin: stand in for mcr-caldas' URL by rewriting it
    const proxied: ProxyFetchers = { fetch: (_url, data, signal) => w.gateway.fetch(w.base + "/ok", data, signal), followFetch: (_u, d, s) => w.gateway.followFetch(w.base + "/ok", d, s), stats: () => w.gateway.stats() };
    const dir = join(mkdtempSync(join(tmpdir(), "collect-")), "collected");
    const out: string[] = [];
    const code = await main([dir, "--only", "cineteatro", "mcr-caldas", "--from", "2026-10-20"], {
      fetch: direct, proxy: proxied, sleep: async () => {}, clock: () => 0, maxWorkers: 1, out: (l) => out.push(l), err: () => {},
      adapters: { ...ADAPTERS, text: { parse: () => ({ items: [], past: [], text: "x".repeat(300), truncated: false, note: null }) } as any },
    });
    expect(code).toBe(0);
    const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
    expect(index.sources.map((s: any) => [s.name, s.ok, s.via])).toEqual([["cineteatro", true, "direct"], ["mcr-caldas", true, "proxy"]]);
    expect(index.proxy.bytes).toBeGreaterThan(PROXY_TUNNEL_BYTES);
    expect(out.some((l) => /mcr-caldas.*\(via proxy\)/.test(l))).toBe(true);
    for (const f of readdirSync(dir).filter((f) => f !== "index.json")) {
      expect(readFileSync(join(dir, f), "utf8")).not.toContain('"via"');
    }
  });

  test("without the variable nothing about a proxy appears; a bad URL is ignored without echoing it", async () => {
    const plain = await runMain({}, null, direct);
    expect(plain.out.join("\n")).not.toContain("proxy");
    expect(JSON.parse(plain.files.find((f) => f.includes('"collect_s"'))!).proxy).toBeUndefined();
    const dir = join(mkdtempSync(join(tmpdir(), "collect-")), "collected");
    const err: string[] = [];
    await main([dir, "--only", "cineteatro", "--from", "2026-10-20"], {
      fetch: async () => ok(), sleep: async () => {}, clock: () => 0, out: () => {}, err: (l) => err.push(l),
      env: { FALLBACK_PROXY_URL: "socks5://sneaky:secretpw@gw.example:1080" },
      adapters: { ...ADAPTERS, text: { parse: () => ({ items: [], past: [], text: "x".repeat(300), truncated: false, note: null }) } as any },
    });
    expect(err.join("\n")).toContain("FALLBACK_PROXY_URL ignored");
    expect(err.join("\n")).not.toContain("secretpw");
  });
});

