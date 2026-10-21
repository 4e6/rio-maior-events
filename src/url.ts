// URL helpers. Plan decision 3: not a full urllib port. This is a hand port of the few urllib.parse
// functions the code calls (urlsplit, urljoin, urlunsplit, quote, unquote, urlencode), following
// CPython 3.14, so clean_url gives the same strings as Python. WHATWG `URL` would lowercase hosts,
// punycode IDNs, rewrite backslashes and throw on bad ports, which clean_url does not do. Owned by T3.

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

const USES_RELATIVE = new Set(["", "ftp", "http", "gopher", "nntp", "imap", "wais", "file", "https", "shttp",
  "mms", "prospero", "rtsp", "rtspu", "sftp", "svn", "svn+ssh", "ws", "wss"]);
const USES_NETLOC = new Set([...USES_RELATIVE, "telnet", "snews", "rsync", "nfs", "git", "git+ssh"]);
const SCHEME_FIRST = /^[A-Za-z]/;
const SCHEME_REST = /^[A-Za-z0-9+\-.]*$/;

function checkBrackets(netloc: string): void {
  if ((netloc.includes("[") && !netloc.includes("]")) || (netloc.includes("]") && !netloc.includes("["))) {
    throw new Error("Invalid IPv6 URL");
  }
}

function hostPort(netloc: string): [string | null, string | null] {
  const hostinfo = netloc.slice(netloc.lastIndexOf("@") + 1);
  let host: string;
  let port: string;
  const open = hostinfo.indexOf("[");
  if (open >= 0) {
    const bracketed = hostinfo.slice(open + 1);
    const close = bracketed.indexOf("]");
    host = close >= 0 ? bracketed.slice(0, close) : bracketed;
    const rest = close >= 0 ? bracketed.slice(close + 1) : "";
    const colon = rest.indexOf(":");
    port = colon >= 0 ? rest.slice(colon + 1) : "";
  } else {
    const colon = hostinfo.indexOf(":");
    host = colon >= 0 ? hostinfo.slice(0, colon) : hostinfo;
    port = colon >= 0 ? hostinfo.slice(colon + 1) : "";
  }
  return [host ? host.toLowerCase() : null, port || null];
}

function portOf(netloc: string): number | null {
  const port = hostPort(netloc)[1];
  if (port === null) return null;
  if (!/^[0-9]+$/.test(port)) throw new Error(`Port could not be cast to integer value as '${port}'`);
  const n = parseInt(port, 10);
  if (n > 65535) throw new Error("Port out of range 0-65535");
  return n;
}

/** urllib.parse.urlsplit (common.py:57, 72, 98; collect.py:141, 258; riomaior_calendar.py:62).
 *  `hostname` is read eagerly; `port` throws when read on a bad port, as in Python. */
export function urlsplit(url: string, defaultScheme = ""): SplitUrl {
  return split(url, defaultScheme).result;
}

/** urlsplit that also tells a missing query or fragment (null) from an empty one: 3.14 urljoin keeps a
 *  bare "?" or "#" in its answer. */
function split(url: string, defaultScheme: string): { result: SplitUrl; query: string | null; fragment: string | null } {
  // 3.14: strip leading C0 controls and spaces, then remove tab, CR and LF anywhere.
  url = url.replace(/^[\x00-\x20]+/, "").replace(/[\t\r\n]/g, "");
  let scheme = defaultScheme;
  const colon = url.indexOf(":");
  if (colon > 0) {
    const head = url.slice(0, colon);
    if (SCHEME_FIRST.test(head) && SCHEME_REST.test(head)) {
      scheme = head.toLowerCase();
      url = url.slice(colon + 1);
    }
  }
  let netloc = "";
  if (url.startsWith("//")) {
    let end = url.length;
    for (const c of "/?#") {
      const i = url.indexOf(c, 2);
      if (i >= 0 && i < end) end = i;
    }
    netloc = url.slice(2, end);
    url = url.slice(end);
    checkBrackets(netloc);
  }
  let fragment: string | null = null;
  let query: string | null = null;
  let i = url.indexOf("#");
  if (i >= 0) { fragment = url.slice(i + 1); url = url.slice(0, i); }
  i = url.indexOf("?");
  if (i >= 0) { query = url.slice(i + 1); url = url.slice(0, i); }
  const result: SplitUrl = {
    scheme, netloc, hostname: hostPort(netloc)[0], port: null, path: url, query: query ?? "", fragment: fragment ?? "",
  };
  Object.defineProperty(result, "port", { enumerable: true, get: () => portOf(netloc) });
  return { result, query, fragment };
}

/** urllib.parse.urlunsplit (common.py:63-67). */
export function urlunsplit(parts: [scheme: string, netloc: string, path: string, query: string, fragment: string]): string {
  return unsplit(parts, false);
}

/** 3.14 urljoin result: an empty but present query or fragment keeps its mark. */
function unsplitKeep(parts: [string, string, string, string | null, string | null]): string {
  return unsplit(parts, true);
}

function unsplit(parts: [string, string, string, string | null, string | null], keepEmpty: boolean): string {
  const [scheme, netloc, path, query, fragment] = parts;
  let url = path;
  if (netloc) {
    if (url && !url.startsWith("/")) url = "/" + url;
    url = "//" + netloc + url;
  } else if (url.startsWith("//")) {
    url = "//" + url;
  } else if (scheme && USES_NETLOC.has(scheme) && (!url || url.startsWith("/"))) {
    url = "//" + url;
  }
  if (scheme) url = scheme + ":" + url;
  if (query !== null && (keepEmpty || query !== "")) url += "?" + query;
  if (fragment !== null && (keepEmpty || fragment !== "")) url += "#" + fragment;
  return url;
}

/** urllib.parse.urljoin (common.py:57; cadaval_api.py:23; riomaior_calendar.py:57). */
export function urljoin(base: string, ref: string): string {
  if (!base) return ref;
  if (!ref) return base;
  const b = split(base, "").result;
  const { result: u, query, fragment } = split(ref, b.scheme);
  if (u.scheme !== b.scheme || !USES_RELATIVE.has(u.scheme)) return ref;
  let netloc = u.netloc;
  if (USES_NETLOC.has(u.scheme)) {
    if (netloc) return unsplitKeep([u.scheme, netloc, u.path, query, fragment]);
    netloc = b.netloc;
  }
  if (!u.path) {
    // 3.14 inherits the base's fragment together with its query, when the reference has neither.
    if (query === null) return unsplitKeep([u.scheme, netloc, b.path, b.query || null, fragment ?? (b.fragment || null)]);
    return unsplitKeep([u.scheme, netloc, b.path, query, fragment]);
  }
  const baseParts = b.path.split("/");
  if (baseParts[baseParts.length - 1] !== "") baseParts.pop();
  let segments: string[];
  if (u.path.startsWith("/")) {
    segments = u.path.split("/");
  } else {
    segments = [...baseParts, ...u.path.split("/")];
    segments = [segments[0]!, ...segments.slice(1, -1).filter(Boolean), ...(segments.length > 1 ? [segments[segments.length - 1]!] : [])];
  }
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === "..") resolved.pop();
    else if (seg !== ".") resolved.push(seg);
  }
  const last = segments[segments.length - 1];
  if (last === "." || last === "..") resolved.push("");
  return unsplitKeep([u.scheme, netloc, resolved.join("/") || "/", query, fragment]);
}

const ALWAYS_SAFE = /[A-Za-z0-9_.\-~]/;
const encoder = new TextEncoder();

/** urllib.parse.quote(s, safe) on UTF-8 (common.py:66-67). */
export function quote(s: string, safe = "/"): string {
  let out = "";
  for (const ch of s) {
    if (ALWAYS_SAFE.test(ch) || safe.includes(ch)) { out += ch; continue; }
    for (const byte of encoder.encode(ch)) out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/** urllib.parse.unquote: %XX runs decoded as UTF-8 with replacement, a lone % kept (common.py:445). */
export function unquote(s: string): string {
  if (!s.includes("%")) return s;
  const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
  return s.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
    const bytes = new Uint8Array(run.length / 3);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(run.slice(i * 3 + 1, i * 3 + 3), 16);
    return decoder.decode(bytes);
  });
}

function quotePlus(s: string): string {
  return quote(s, " ").replace(/ /g, "+");
}

/** urllib.parse.urlencode(pairs) with quote_plus (events_calendar.py:20; riomaior_calendar.py:20). */
export function urlencode(pairs: [string, string][]): string {
  return pairs.map(([k, v]) => quotePlus(k) + "=" + quotePlus(v)).join("&");
}

// Python str.strip() whitespace (differs from String.trim: x1c-x1f and x85 yes, U+FEFF no).
const PY_SPACE = "\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, "g");

const KEEP = "/%:@!$&'()*+,;=~-._";

/** common.clean_url (common.py:49-68): absolute http(s) URL resolved against base, fragment dropped,
 *  default port dropped, spaces and non-ASCII percent-encoded; null otherwise. */
export function cleanUrl(base: string | null | undefined, href: unknown): string | null {
  if (typeof href !== "string") return null;
  const trimmed = href.replace(PY_STRIP, "");
  if (!trimmed) return null;
  const parts = urlsplit(urljoin(base || "", trimmed));
  if ((parts.scheme !== "http" && parts.scheme !== "https") || !parts.hostname) return null;
  let host = parts.netloc;
  if ((host.endsWith(":443") || host.endsWith(":80")) && parts.port === (parts.scheme === "https" ? 443 : 80)) {
    host = host.slice(0, host.lastIndexOf(":"));
  }
  return urlunsplit([parts.scheme, host, quote(parts.path, KEEP), quote(parts.query, KEEP + "?"), ""]);
}

/** common.same_site (common.py:71-74): same host ignoring a leading "www.". */
export function sameSite(url: string, other: string): boolean {
  return bareHost(url) === bareHost(other);
}

/** common._bare_host (common.py:76-78). */
export function bareHost(url: string): string {
  const host = urlsplit(url).hostname ?? "";
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** collect.host_of (collect.py:158): hostname of a source's url. */
export function hostOf(url: string): string | null {
  return urlsplit(url).hostname;
}
