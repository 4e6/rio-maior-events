// HTTP. Port of scripts/collect.py fetch / fetch_follow / inflate / garbled / _SameHost. Owned by T9.
// Notes (research-port.md §1.4): redirect "manual" and own loop (POST becomes GET on 301/302/303; 307/308 POST is an
// HttpError; max 10 hops); fetch(url, {decompress: false}) then inflate(); Accept-Encoding "gzip, deflate";
// 20 s timeout for the whole request (connect, headers, body); non-2xx throws HttpError; TLS/DNS/refused throw NetworkError; abort throws TimeoutError.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import tls from "node:tls";
import { inflateRawSync, inflateSync } from "node:zlib";
import type { Page, Request } from "./adapters/types.ts";
import { decode } from "./adapters/common.ts";
import { HttpError, NetworkError, ProxyError, RedirectRefused, TimeoutError } from "./net-errors.ts";

export { HttpError, NetworkError, ProxyError, RedirectRefused, TimeoutError } from "./net-errors.ts";

export const TIMEOUT_MS = 20_000;
export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 " +
  "rio-maior-events/1.0 (personal events digest; one request per page)";

/** What a fetcher returns. `url` is the final URL (set by fetchFollow; fetch leaves it out). */
export interface FetchResult {
  status: number;
  body: Uint8Array;
  contentType: string | null;
  url?: string;
}

/** collect.fetch and collect.fetch_follow share this shape; tests inject fakes. Throws the net-errors classes. */
export type Fetcher = (url: string, data: Uint8Array | null, signal?: AbortSignal) => Promise<FetchResult>;

const MAX_REDIRECTIONS = 10; // urllib.request.HTTPRedirectHandler
const MAX_REPEATS = 4;

/** collect.inflate: undo gzip/deflate per Content-Encoding, or by the gzip magic bytes. */
export function inflate(body: Uint8Array, encoding: string | null | undefined): Uint8Array {
  const enc = (encoding ?? "").trim().toLowerCase();
  const magic = body[0] === 0x1f && body[1] === 0x8b;
  if (enc === "gzip" || enc === "x-gzip" || magic) {
    // zlib.decompress(body, 47): gzip or zlib wrapper; first gzip member only, trailing bytes ignored.
    if (magic) return Bun.gunzipSync(body as Uint8Array<ArrayBuffer>);
    return inflateSync(body);
  }
  if (enc === "deflate") {
    try {
      return inflateSync(body);
    } catch {
      return inflateRawSync(body); // a raw deflate stream
    }
  }
  return body;
}

/** collect.garbled: mostly control or replacement characters in the first 2000 code points. */
export function garbled(body: Uint8Array, contentType: string | null | undefined, limit = 0.05, sample = 2000): boolean {
  const text = decode(body, contentType);
  let total = 0;
  let bad = 0;
  for (const c of text) {
    if (total >= sample) break;
    total++;
    const cp = c.codePointAt(0)!;
    if (cp === 0xfffd || (cp < 32 && cp !== 9 && cp !== 10 && cp !== 13)) bad++;
  }
  return total > 0 && bad / total > limit;
}

// --- TLS: the system's (Mozilla) roots plus certs/intermediates.pem (certs/README.md) ---

export const CERTS = join(import.meta.dir, "..", "certs", "intermediates.pem");

/** The CA list for fetch's `tls.ca`. Bun replaces its default roots when `ca` is given, so the default roots are
 *  listed too. The intermediates are not trust anchors: without a root above them the chain still fails
 *  (tested). A missing file throws. */
export function caList(path: string = CERTS): string[] {
  const extra = readFileSync(path, "utf8");
  return [...tls.getCACertificates("default"), extra];
}

let CA: string[] | undefined;
const defaultCa = () => (CA ??= caList());

// --- the fallback proxy (FALLBACK_PROXY_URL) ---
// A residential HTTP proxy, used only for a host whose direct request was refused (collect.ts decides when). HTTPS
// goes through CONNECT, so TLS is verified end to end against the same CA list. Every proxied request opens its own
// tunnel (keepalive off) and is counted against a byte budget.

export const DEFAULT_PROXY_MAX_MB = 30;
/** The budget is an estimate: body bytes plus a fixed allowance per request and per new tunnel. */
export const PROXY_REQUEST_BYTES = 2 * 1024;
export const PROXY_TUNNEL_BYTES = 8 * 1024;

const decodeSafe = (s: string): string => {
  try { return decodeURIComponent(s); } catch { return s; }
};

export class ProxyGateway {
  /** Why the proxy is unusable for the rest of the run ("proxy failed: 407"), else null. */
  dead: string | null = null;
  bytes = 0;
  readonly hostBytes = new Map<string, number>();
  readonly maxBytes: number;
  readonly ca?: string[];
  private readonly href: string;
  private readonly secrets: string[];
  /** The values Actions should mask: decoded user, password and host (and their raw forms). */
  readonly maskValues: string[];

  /** Throws a message without the URL when it is not an http(s) proxy URL. */
  constructor(rawUrl: string, opts: { maxBytes?: number; ca?: string[] } = {}) {
    let u: URL;
    try { u = new URL(rawUrl.trim()); } catch { throw new Error("the proxy URL is not a valid URL"); }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("the proxy URL is not an http(s) URL");
    this.href = u.href;
    this.maxBytes = Math.floor(opts.maxBytes ?? DEFAULT_PROXY_MAX_MB * 1024 * 1024);
    this.ca = opts.ca;
    const user = decodeSafe(u.username), password = decodeSafe(u.password);
    const found = new Set<string>([rawUrl.trim(), u.href, u.username, user, u.password, password, u.hostname, u.host, encodeURIComponent(user), encodeURIComponent(password)]);
    if (user || password) {
      const basic = btoa(`${user}:${password}`);
      found.add(basic);
    }
    found.delete("");
    this.secrets = [...found].sort((a, b) => b.length - a.length);
    this.maskValues = [...new Set([user, password, u.hostname, u.username, u.password].filter((v) => v !== ""))];
  }

  /** From FALLBACK_PROXY_URL and FALLBACK_PROXY_MAX_MB; null when the URL is unset or empty. */
  static fromEnv(env: Record<string, string | undefined>, ca?: string[]): ProxyGateway | null {
    const raw = env.FALLBACK_PROXY_URL?.trim();
    if (!raw) return null;
    const mb = Number(env.FALLBACK_PROXY_MAX_MB);
    return new ProxyGateway(raw, { maxBytes: (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_PROXY_MAX_MB) * 1024 * 1024, ca });
  }

  /** Text with the proxy's URL, host, user and password (raw and percent-decoded) replaced. */
  scrub(text: string): string {
    let out = text;
    for (const secret of this.secrets) out = out.split(secret).join("[proxy]");
    return out;
  }

  /** Throws before a proxied request when the proxy is dead or the budget is spent. */
  guard(): void {
    if (this.dead) throw new ProxyError(this.dead, true);
    if (this.bytes >= this.maxBytes) throw new ProxyError("proxy budget reached");
  }

  charge(host: string, bodyBytes: number): void {
    const n = bodyBytes + PROXY_REQUEST_BYTES + PROXY_TUNNEL_BYTES;
    this.bytes += n;
    this.hostBytes.set(host, (this.hostBytes.get(host) ?? 0) + n);
  }

  /** A proxy failure in a thrown fetch error, or null when the error is the site's or the network's. */
  failure(err: unknown): ProxyError | null {
    const e = err as { code?: string; status?: number } | null;
    if (e?.code === "ERR_PROXY_TUNNEL") {
      const status = typeof e.status === "number" ? e.status : null;
      const dead = status === 407 || status === 402;
      const error = new ProxyError(`proxy failed: ${status ?? "tunnel"}`, dead);
      if (dead) this.dead = error.message;
      return error;
    }
    // Through CONNECT the client talks only to the proxy until the tunnel is up, so these name the proxy.
    if (e?.code === "ECONNREFUSED" || e?.code === "ENOTFOUND") {
      const error = new ProxyError(`proxy failed: ${e.code}`, true);
      this.dead = error.message;
      return error;
    }
    return null;
  }

  stats(): { bytes: number; max_bytes: number; dead: string | null; hosts: Record<string, number> } {
    return { bytes: this.bytes, max_bytes: this.maxBytes, dead: this.dead, hosts: Object.fromEntries(this.hostBytes) };
  }

  /** The Fetcher pair collect.ts takes as its fallback. */
  readonly fetch: Fetcher = (url, data, signal) => request(url, data, { signal, proxy: this });
  readonly followFetch: Fetcher = (url, _data, signal) => request(url, null, { follow: true, signal, proxy: this });

  get proxyUrl(): string { return this.href; }
}

export interface FetchOptions {
  follow?: boolean;
  timeoutMs?: number;
  ca?: string[];
  /** The run's abort signal: ends a request in flight at once. */
  signal?: AbortSignal;
  /** Go through this proxy. */
  proxy?: ProxyGateway;
}

const HEADERS = { "User-Agent": USER_AGENT, "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.5", "Accept-Encoding": "gzip, deflate" };

function isAbort(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

function networkError(err: unknown, proxy?: ProxyGateway): NetworkError {
  const e = err as { code?: string; message?: string };
  const message = e?.message ?? String(err);
  return new NetworkError(`<urlopen error ${proxy ? proxy.scrub(message) : message}>`, e?.code);
}

const timeoutError = (ms: number) => new TimeoutError(`timed out after ${ms / 1000} s`);

/** One request without redirect handling: the response and its body. Through a proxy it is guarded, counted and
 *  its errors are rebuilt from fields, with the proxy's details scrubbed. */
async function once(url: string, method: string, data: Uint8Array | null, opts: FetchOptions) {
  const gw = opts.proxy;
  if (!gw) return onceDirect(url, method, data, opts);
  gw.guard();
  const host = new URL(url).hostname;
  try {
    const out = await onceDirect(url, method, data, opts);
    gw.charge(host, out.body.length);
    return out;
  } catch (err) {
    gw.charge(host, 0);
    if (opts.signal?.aborted) throw err;
    if (err instanceof ProxyError || err instanceof TimeoutError || err instanceof NetworkError) throw err;
    const e = err as { name?: string; message?: string };
    throw Object.assign(new Error(gw.scrub(e?.message ?? String(err))), { name: e?.name ?? "Error" });
  }
}

async function onceDirect(url: string, method: string, data: Uint8Array | null, opts: FetchOptions) {
  const ms = opts.timeoutMs ?? TIMEOUT_MS;
  const headers: Record<string, string> = { ...HEADERS };
  if (data !== null) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const timeout = AbortSignal.timeout(ms);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
  let res: Response;
  try {
    res = await fetch(url, {
      method, headers, body: (data ?? undefined) as BodyInit | undefined, redirect: "manual", decompress: false, signal,
      tls: { ca: opts.ca ?? opts.proxy?.ca ?? defaultCa() },
      ...(opts.proxy ? { proxy: opts.proxy.proxyUrl, keepalive: false } : {}),
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    if (isAbort(err)) throw timeoutError(ms);
    throw opts.proxy?.failure(err) ?? networkError(err, opts.proxy);
  }
  if (res.status >= 300 && res.status < 400) {
    void res.body?.cancel().catch(() => {});
    return { res, body: new Uint8Array() };
  }
  try {
    return { res, body: new Uint8Array(await res.arrayBuffer()) };
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    if (isAbort(err)) throw timeoutError(ms);
    const code = (err as { code?: string }).code;
    if (code === "ECONNRESET" || code === "ConnectionClosed") throw networkError(err, opts.proxy);
    throw err; // like http.client.IncompleteRead: fails only its source
  }
}

/** urllib's quote(newurl, encoding="iso-8859-1", safe=string.punctuation): Bun hands the header's bytes over as
 *  latin-1 characters, so each character at U+0080 or above becomes %XX of its byte value (not UTF-8 again). */
export function quoteLocation(location: string): string {
  let out = "";
  for (const ch of location) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80 && /[A-Za-z0-9!-\/:-@\[-`{-~]/.test(ch)) out += ch;
    else if (cp < 0x100) out += "%" + cp.toString(16).toUpperCase().padStart(2, "0");
    else out += encodeURIComponent(ch); // not a header byte; only reachable from tests
  }
  return out;
}

/** urllib's HTTPRedirectHandler loop, over a manual-redirect fetch. */
async function request(url: string, data: Uint8Array | null, opts: FetchOptions): Promise<FetchResult> {
  const host = new URL(url).hostname;
  let method = data === null ? "GET" : "POST";
  const seen = new Map<string, number>();
  for (let hops = 0; ; hops++) {
    const { res, body } = await once(url, method, data, opts);
    const code = res.status;
    if (code >= 200 && code < 300) {
      const contentType = res.headers.get("Content-Type")?.split(", ")[0] ?? null;
      return {
        status: code,
        body: inflate(body, res.headers.get("Content-Encoding")),
        contentType,
        ...(opts.follow ? { url } : {}),
      };
    }
    const location = res.headers.get("Location") ?? res.headers.get("URI");
    const redirect = [301, 302, 303, 307, 308].includes(code);
    // 301/302/303 may turn a POST into a GET; 307/308 on a POST is an error (urllib redirect_request).
    const followable = redirect && location && (method === "GET" || code <= 303);
    if (!followable) throw new HttpError(code, res.statusText);
    const next = new URL(quoteLocation(location), url);
    const nextUrl = next.href;
    // urllib refuses any scheme but http(s) (and ftp); fetch would read file: and data: URLs.
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new HttpError(code, `redirection to url '${nextUrl}' is not allowed`);
    }
    if (opts.follow && (next.protocol !== "https:" || next.hostname !== host)) {
      throw new RedirectRefused(`redirected to ${nextUrl}`);
    }
    const repeats = (seen.get(nextUrl) ?? 0) + 1;
    seen.set(nextUrl, repeats);
    if (repeats > MAX_REPEATS || hops + 1 > MAX_REDIRECTIONS) {
      throw new HttpError(code, "The HTTP server returned a redirect error that would lead to an infinite loop.");
    }
    if (method === "POST") { method = "GET"; data = null; }
    url = nextUrl;
  }
}

/** collect.fetch with options (tests pass a short timeout or their own CA list). */
export function fetchWith(url: string, data: Uint8Array | null, opts: FetchOptions = {}): Promise<FetchResult> {
  return request(url, data, opts);
}

/** collect.fetch: a list request (follows redirects like urllib; POST handling as above). */
export const fetchPage: Fetcher = (url, data, signal) => request(url, data, { signal });

/** collect.fetch_follow: GET only; every hop must be https on the original host exactly, else RedirectRefused
 *  before the request is made. Returns the final URL. */
export const fetchFollow: Fetcher = (url, _data, signal) => request(url, null, { follow: true, signal });

/** Helper for runHost: Page from a request and its result. */
export function toPage(request: Request, result: FetchResult): Page {
  return { url: result.url ?? request.url, status: result.status, body: result.body, contentType: result.contentType };
}
