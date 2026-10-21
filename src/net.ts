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
import { HttpError, NetworkError, RedirectRefused, TimeoutError } from "./net-errors.ts";

export { HttpError, NetworkError, RedirectRefused, TimeoutError } from "./net-errors.ts";

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

export interface FetchOptions {
  follow?: boolean;
  timeoutMs?: number;
  ca?: string[];
  /** The run's abort signal: ends a request in flight at once. */
  signal?: AbortSignal;
}

const HEADERS = { "User-Agent": USER_AGENT, "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.5", "Accept-Encoding": "gzip, deflate" };

function isAbort(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

function networkError(err: unknown): NetworkError {
  const e = err as { code?: string; message?: string };
  return new NetworkError(`<urlopen error ${e?.message ?? String(err)}>`, e?.code);
}

const timeoutError = (ms: number) => new TimeoutError(`timed out after ${ms / 1000} s`);

/** One request without redirect handling: the response and its body. */
async function once(url: string, method: string, data: Uint8Array | null, opts: FetchOptions) {
  const ms = opts.timeoutMs ?? TIMEOUT_MS;
  const headers: Record<string, string> = { ...HEADERS };
  if (data !== null) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const timeout = AbortSignal.timeout(ms);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
  let res: Response;
  try {
    res = await fetch(url, {
      method, headers, body: (data ?? undefined) as BodyInit | undefined, redirect: "manual", decompress: false, signal,
      tls: { ca: opts.ca ?? defaultCa() },
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw isAbort(err) ? timeoutError(ms) : networkError(err);
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
    if (code === "ECONNRESET" || code === "ConnectionClosed") throw networkError(err);
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
