// Python codec semantics over TextDecoder plus a shim (plan decision 3). Owned by T4.
// Python counterparts: bytes.decode(charset) in common.decode (common.py:341-349), bytes.decode("utf-8")
// in the JSON adapters (cadaval_api.py:31, events_calendar.py:42, riomaior_calendar.py:33).
const NYI = (): never => { throw new Error("not ported"); };

/** UnicodeDecodeError: bytes invalid for a strict codec. */
export class UnicodeDecodeError extends Error { override name = "UnicodeDecodeError"; }
/** LookupError: unknown codec name. */
export class LookupError extends Error { override name = "LookupError"; }

/** bytes.decode(codec) strict. Keeps a BOM (U+FEFF) as Python's utf-8 does. latin-1 is a byte-to-code-point
 *  map; ascii and cp1252 are strict. Throws LookupError / UnicodeDecodeError. */
export function pyDecode(_body: Uint8Array, _codec: string): string { return NYI(); }

/** bytes.decode("latin-1"): never fails. */
export function latin1(_body: Uint8Array): string { return NYI(); }
