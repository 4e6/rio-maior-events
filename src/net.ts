// HTTP. Port of scripts/collect.py fetch / fetch_follow / inflate / garbled / _SameHost. Owned by T9.
// Notes (research-port.md §1.4): redirect "manual" and own loop (POST becomes GET on 301/302/303; 307/308 POST is an
// HttpError; max 10 hops); fetch(url, {decompress: false}) then inflate(); Accept-Encoding "gzip, deflate";
// 20 s timeout; non-2xx throws HttpError; TLS/DNS/refused throw NetworkError; abort throws TimeoutError.
import type { Page, Request } from "./adapters/types.ts";

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
export type Fetcher = (url: string, data: Uint8Array | null) => Promise<FetchResult>;

/** collect.inflate: undo gzip/deflate per Content-Encoding, or by the gzip magic bytes. */
export function inflate(_body: Uint8Array, _encoding: string | null | undefined): Uint8Array { throw new Error("not ported"); }

/** collect.garbled: mostly control or replacement characters in the first 2000 code points. */
export function garbled(_body: Uint8Array, _contentType: string | null | undefined, _limit?: number, _sample?: number): boolean { throw new Error("not ported"); }

/** collect.fetch: a list request (follows redirects like urllib; POST handling as above). */
export const fetchPage: Fetcher = async () => { throw new Error("not ported"); };

/** collect.fetch_follow: GET only; every hop must be https on the original host exactly, else RedirectRefused
 *  before the request is made. Returns the final URL. */
export const fetchFollow: Fetcher = async () => { throw new Error("not ported"); };

/** Helper for runHost: Page from a request and its result. */
export function toPage(_request: Request, _result: FetchResult): Page { throw new Error("not ported"); }
