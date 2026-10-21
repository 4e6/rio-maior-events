// URL helpers. Plan decision 3: WHATWG URL plus the clean_url rules the tests pin, not a full urllib
// port. Owned by T3. Python counterparts are urllib.parse calls at the places named below.
const NYI = (): never => { throw new Error("not ported"); };

/** urllib.parse.SplitResult (only the fields the code reads). */
export interface SplitUrl {
  scheme: string;
  netloc: string;
  /** Lowercased host or null (SplitResult.hostname). */
  hostname: string | null;
  port: number | null;
  path: string;
  query: string;
  fragment: string;
}

/** urllib.parse.urlsplit (common.py:57, 72, 98; collect.py:141, 258; riomaior_calendar.py:62). */
export function urlsplit(_url: string): SplitUrl { return NYI(); }

/** urllib.parse.urlunsplit (common.py:63-67). */
export function urlunsplit(_parts: [scheme: string, netloc: string, path: string, query: string, fragment: string]): string { return NYI(); }

/** urllib.parse.urljoin (common.py:57; cadaval_api.py:23; riomaior_calendar.py:57; redirects in net.ts). */
export function urljoin(_base: string, _ref: string): string { return NYI(); }

/** urllib.parse.quote(s, safe) on UTF-8 (common.py:66-67). */
export function quote(_s: string, _safe?: string): string { return NYI(); }

/** urllib.parse.unquote: %XX runs decoded as UTF-8 with replacement, a lone % kept (common.py:445). */
export function unquote(_s: string): string { return NYI(); }

/** urllib.parse.urlencode(pairs) with quote_plus (events_calendar.py:20; riomaior_calendar.py:20). */
export function urlencode(_pairs: [string, string][]): string { return NYI(); }

/** common.clean_url (common.py:49-68): absolute http(s) URL resolved against base, fragment dropped,
 *  default port dropped, spaces and non-ASCII percent-encoded; null otherwise. */
export function cleanUrl(_base: string | null | undefined, _href: unknown): string | null { return NYI(); }

/** common.same_site (common.py:71-74): same host ignoring a leading "www.". */
export function sameSite(_url: string, _other: string): boolean { return NYI(); }

/** common._bare_host (common.py:76-78). */
export function bareHost(_url: string): string { return NYI(); }

/** collect.host_of (collect.py:158): hostname of a source's url. */
export function hostOf(_url: string): string | null { return NYI(); }
