// Python str semantics that JS strings do not have: code-point lengths and slices, Python's
// whitespace and isalnum/isdigit, casefold. Owned by T1. isalnum/isdigit/casefold/combining use tables
// generated from Python 3.14 (tools/gen_unicode.py -> unicode.generated.ts), so they match Python exactly.
import { CASEFOLD, COMBINING_RANGES, ISALNUM_RANGES, ISDIGIT_RANGES } from "./unicode.generated.ts";

function inRanges(ranges: number[], cp: number): boolean {
  let lo = 0;
  let hi = ranges.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < ranges[2 * mid]!) hi = mid - 1;
    else if (cp > ranges[2 * mid + 1]!) lo = mid + 1;
    else return true;
  }
  return false;
}

const isAstral = (s: string): boolean => /[\ud800-\udfff]/.test(s);

/** Python len(s): number of code points. (common.py:206-216, 470; collect.py:470.) */
export function cpLen(s: string): number {
  let n = s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { n--; i++; }
    }
  }
  return n;
}

/** Python s[start:end] on code points (negative indices as in Python). (common.py:216, 317, 478-482.) */
export function cpSlice(s: string, start: number, end?: number): string {
  if (!isAstral(s)) return s.slice(start, end);
  return Array.from(s).slice(start, end).join("");
}

/** The first code point of s, or "" (common.py:171 data[0]). */
export function firstCp(s: string): string {
  return s === "" ? "" : String.fromCodePoint(s.codePointAt(0)!);
}

/** The last code point of s, or "" (common.py:171 parts[-1][-1:]). */
export function lastCp(s: string): string {
  if (s === "") return "";
  const n = s.length;
  const c = s.charCodeAt(n - 1);
  if (c >= 0xdc00 && c <= 0xdfff && n >= 2) {
    const h = s.charCodeAt(n - 2);
    if (h >= 0xd800 && h <= 0xdbff) return s.slice(n - 2);
  }
  return s.slice(n - 1);
}

/** Python string comparison: by code point (JS `<` compares UTF-16 units). Returns -1, 0 or 1. */
export function cpCompare(a: string, b: string): number {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x === y) continue;
    // A surrogate (an astral code point) sorts after every other unit, i.e. after U+E000-U+FFFF.
    const xs = x >= 0xd800 && x <= 0xdfff;
    const ys = y >= 0xd800 && y <= 0xdfff;
    if (xs !== ys) return xs ? 1 : -1;
    return x < y ? -1 : 1;
  }
  return a.length < b.length ? -1 : 1;
}

/** str.isalnum() for a string (true when non-empty and every code point is a letter or number). */
export function isalnum(s: string): boolean {
  if (s === "") return false;
  for (const ch of s) if (!inRanges(ISALNUM_RANGES, ch.codePointAt(0)!)) return false;
  return true;
}

/** str.isdigit() (common.py:138): non-empty, every code point has Numeric_Type Digit or Decimal. */
export function isdigit(s: string): boolean {
  if (s === "") return false;
  for (const ch of s) if (!inRanges(ISDIGIT_RANGES, ch.codePointAt(0)!)) return false;
  return true;
}

/** Python whitespace characters, as the class str.strip()/split() use (not JS \s: includes \x1c-\x1f, \x85). */
export const PY_WS = "\t\n\x0b\x0c\r\x1c\x1d\x1e\x1f \x85\xa0                　";

const WS_START = new RegExp(`^[${PY_WS}]+`);
const WS_END = new RegExp(`[${PY_WS}]+$`);
const WS_RUN = new RegExp(`[${PY_WS}]+`);

/** str.strip() with no argument (common.py:209, 224). */
export function pyStrip(s: string): string {
  return s.replace(WS_START, "").replace(WS_END, "");
}

/** str.split() with no argument: split on runs of Python whitespace, no empty strings (merge.py:121-126, render.py:70-73). */
export function pySplitWs(s: string): string[] {
  return pyStrip(s) === "" ? [] : pyStrip(s).split(WS_RUN);
}

/** str.casefold() (common.py:384, merge.py:121, render.py:70). Per code point, so no Final_Sigma context. */
export function casefold(s: string): string {
  let out = "";
  for (const ch of s) out += CASEFOLD[ch.codePointAt(0)!] ?? ch;
  return out;
}

/** unicodedata.combining(c) != 0 for one code point. */
export function isCombining(cp: number): boolean {
  return inRanges(COMBINING_RANGES, cp);
}

// merge.py LOOKALIKES: Cyrillic/Greek letters that look Latin.
const LOOKALIKES = new Map<string, string>(
  Array.from("аеорсухіјѕАЕОРСУХІЈЅ" + "οαε" + "ΟΑΕ").map((c, i) => [c, Array.from("aeopcyxijsAEOPCYXIJS" + "oae" + "OAE")[i]!] as [string, string]),
);

/** unicodedata.normalize + drop combining marks + casefold + collapse whitespace:
 *  merge.py:normalise and render.py:normalise (NFKD form) ; `_fold` in common.py uses NFD and strips only U+0300-036F.
 *  "NFD" is common._fold (NFD, drop U+0300-036F, casefold, strip). "NFKD" is render.normalise; with
 *  `lookalikes` it is merge.normalise (NFKC, LOOKALIKES translate, then NFKD). Optional third parameter added by T1. */
export function foldKey(s: string, form: "NFD" | "NFKD", lookalikes = false): string {
  if (form === "NFD") return pyStrip(casefold(s.normalize("NFD").replace(/[̀-ͯ]/g, "")));
  let t = s;
  if (lookalikes) {
    t = Array.from(t.normalize("NFKC")).map((c) => LOOKALIKES.get(c) ?? c).join("");
  }
  t = t.normalize("NFKD");
  let kept = "";
  for (const ch of t) if (!isCombining(ch.codePointAt(0)!)) kept += ch;
  return pySplitWs(casefold(kept)).join(" ");
}

function reprStr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === quote || ch === "\\") out += "\\" + ch;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === " " || (!/[\p{C}\p{Z}]/u.test(ch))) out += ch;
    else if (cp < 0x100) out += "\\x" + cp.toString(16).padStart(2, "0");
    else if (cp < 0x10000) out += "\\u" + cp.toString(16).padStart(4, "0");
    else out += "\\U" + cp.toString(16).padStart(8, "0");
  }
  return out + quote;
}

/** Python repr() of a str/number/None as used in "%r" messages (check_candidates.py:38-41, render.py, merge.py).
 *  A JS number cannot tell 1 from 1.0, so integers print without ".0"; arrays and objects print as Python lists/dicts. */
export function pyRepr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "string") return reprStr(v);
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") {
    if (Number.isNaN(v)) return "nan";
    if (!Number.isFinite(v)) return v < 0 ? "-inf" : "inf";
    return String(v);
  }
  if (Array.isArray(v)) return "[" + v.map(pyRepr).join(", ") + "]";
  if (typeof v === "object") {
    return "{" + Object.entries(v as Record<string, unknown>).map(([k, x]) => reprStr(k) + ": " + pyRepr(x)).join(", ") + "}";
  }
  return String(v);
}
