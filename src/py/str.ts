// Python str semantics that JS strings do not have: code-point lengths and slices, Python's
// whitespace and isalnum/isdigit, casefold. Owned by T1. Plan decision 3: Unicode tables come from
// the runtime's Unicode data (\p{...}) except where the tests pin a difference; isdigit needs a
// small table (Python's isdigit is wider than \p{Nd}).
const NYI = (): never => { throw new Error("not ported"); };

/** Python len(s): number of code points. (common.py:206-216, 470; collect.py:470.) */
export function cpLen(_s: string): number { return NYI(); }

/** Python s[start:end] on code points (negative indices as in Python). (common.py:216, 317, 478-482.) */
export function cpSlice(_s: string, _start: number, _end?: number): string { return NYI(); }

/** The first code point of s, or "" (common.py:171 data[0]). */
export function firstCp(_s: string): string { return NYI(); }

/** The last code point of s, or "" (common.py:171 parts[-1][-1:]). */
export function lastCp(_s: string): string { return NYI(); }

/** str.isalnum() for a string (true when non-empty and every code point is a letter or number). */
export function isalnum(_s: string): boolean { return NYI(); }

/** str.isdigit() (common.py:138). */
export function isdigit(_s: string): boolean { return NYI(); }

/** Python whitespace characters, as the class str.strip()/split() use (not JS \s: includes \x1c-\x1f, \x85). */
export const PY_WS = "";

/** str.strip() with no argument (common.py:209, 224). */
export function pyStrip(_s: string): string { return NYI(); }

/** str.split() with no argument: split on runs of Python whitespace, no empty strings (merge.py:121-126, render.py:70-73). */
export function pySplitWs(_s: string): string[] { return NYI(); }

/** str.casefold() (common.py:384, merge.py:121, render.py:70). */
export function casefold(_s: string): string { return NYI(); }

/** unicodedata.normalize + drop combining marks + casefold + collapse whitespace:
 *  merge.py:normalise and render.py:normalise (NFKD form) ; `_fold` in common.py uses NFD and strips only U+0300-036F. */
export function foldKey(_s: string, _form: "NFD" | "NFKD"): string { return NYI(); }

/** Python repr() of a str/number/None as used in "%r" messages (check_candidates.py:38-41, render.py, merge.py). */
export function pyRepr(_v: unknown): string { return NYI(); }
