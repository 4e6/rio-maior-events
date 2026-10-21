// Python codec semantics over TextDecoder plus a shim (plan decision 3). Owned by T4.
// Python counterparts: bytes.decode(charset) in common.decode (common.py:341-349), bytes.decode("utf-8")
// in the JSON adapters (cadaval_api.py:31, events_calendar.py:42, riomaior_calendar.py:33).
//
// TextDecoder maps the labels latin1, iso-8859-1 and ascii to windows-1252 and accepts bytes Python rejects, so
// the codecs the pipeline meets (utf-8, latin-1, cp1252, ascii) are hand-written here. Single-byte codecs that
// WHATWG and Python agree on (ISO-8859-2..8, 10, 13..16, KOI8-R, windows-125x) go to TextDecoder with fatal: true.
// Known differences: koi8-u (the tables differ), multibyte codecs (gbk, big5, shift_jis, ...) and iso-8859-11 are
// not supported and raise LookupError, which common.decode treats as "try the next codec".

/** UnicodeDecodeError: bytes invalid for a strict codec. */
export class UnicodeDecodeError extends Error { override name = "UnicodeDecodeError"; }
/** LookupError: unknown codec name. */
export class LookupError extends Error { override name = "LookupError"; }

type Impl = "utf8" | "utf8sig" | "latin1" | "ascii" | "cp1252" | "iso8859_9" | { label: string; undef?: number[] };

const TABLE = new Map<string, Impl>();
function alias(names: string[], impl: Impl): void { for (const n of names) TABLE.set(n, impl); }

// Aliases from encodings.aliases (Python 3.14), after normalisation (lower case, punctuation runs -> "_").
alias(["utf_8", "u8", "utf", "utf8", "utf8_ucs2", "utf8_ucs4", "cp65001"], "utf8");
alias(["utf_8_sig"], "utf8sig");
alias(["latin_1", "8859", "cp819", "csisolatin1", "ibm819", "iso8859", "iso8859_1", "iso_8859_1", "iso_8859_1_1987",
  "iso_ir_100", "l1", "latin", "latin1"], "latin1");
alias(["ascii", "646", "ansi_x3.4_1968", "ansi_x3_4_1968", "ansi_x3.4_1986", "cp367", "csascii", "ibm367",
  "iso646_us", "iso_646.irv_1991", "iso_ir_6", "us", "us_ascii"], "ascii");
alias(["cp1252", "1252", "windows_1252"], "cp1252");
alias(["iso8859_9", "csisolatin5", "iso_8859_9", "iso_8859_9_1989", "iso_ir_148", "l5", "latin5"], "iso8859_9");
const ISO_EXTRA: Record<number, string[]> = {
  2: ["l2", "latin2", "csisolatin2"], 3: ["l3", "latin3"], 4: ["l4", "latin4"], 5: ["cyrillic"], 6: ["arabic"],
  7: ["greek", "greek8"], 8: ["hebrew", "iso_8859_8_i", "iso_8859_8_e"], 10: ["l6", "latin6"], 13: ["l7", "latin7"],
  14: ["l8", "latin8", "iso_celtic"], 15: ["l9", "latin9"], 16: ["l10", "latin10"],
};
for (const [n, more] of Object.entries(ISO_EXTRA)) {
  alias([`iso8859_${n}`, `iso_8859_${n}`, ...more], { label: `iso-8859-${n}` });
}
alias(["koi8_r", "cskoi8r"], { label: "koi8-r" });
// WHATWG maps the bytes Python's cp125x leaves undefined to C1 controls, so those are rejected by hand.
const UNDEF_125X: Record<number, number[]> = {
  1250: [129, 131, 136, 144, 152], 1251: [152],
  1253: [129, 136, 138, 140, 141, 142, 143, 144, 152, 154, 156, 157, 158, 159, 170, 210, 255],
  1254: [129, 141, 142, 143, 144, 157, 158],
  1255: [129, 138, 140, 141, 142, 143, 144, 154, 156, 157, 158, 159, 202, 217, 218, 219, 220, 221, 222, 223, 251, 252, 255],
  1256: [], 1257: [129, 131, 136, 138, 140, 144, 152, 154, 156, 159, 161, 165],
  1258: [129, 138, 141, 142, 143, 144, 154, 157, 158],
};
for (const [n, undef] of Object.entries(UNDEF_125X)) {
  alias([`cp${n}`, `${n}`, `windows_${n}`], { label: `windows-${n}`, undef });
}

/** encodings.normalize_encoding + lower case: runs of characters other than letters, digits and "." become "_". */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "_").replace(/^_+|_+$/g, "");
}

// cp1252 0x80..0x9F; null where Python's cp1252 is undefined.
const CP1252_HIGH: (number | null)[] = [
  0x20ac, null, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, null, 0x017d, null,
  null, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, null, 0x017e, 0x0178,
];
const LATIN5: Record<number, number> = { 0xd0: 0x11e, 0xdd: 0x130, 0xde: 0x15e, 0xf0: 0x11f, 0xfd: 0x131, 0xfe: 0x15f };

function fromCodes(codes: Uint8Array | Uint16Array): string {
  let out = "";
  for (let i = 0; i < codes.length; i += 8192) {
    out += String.fromCharCode.apply(null, codes.subarray(i, i + 8192) as unknown as number[]);
  }
  return out;
}

function decodeError(codec: string, body: Uint8Array, i: number, why: string): UnicodeDecodeError {
  return new UnicodeDecodeError(`'${codec}' codec can't decode byte 0x${body[i]!.toString(16).padStart(2, "0")} in position ${i}: ${why}`);
}

/** bytes.decode(codec) strict. Keeps a BOM (U+FEFF) as Python's utf-8 does. latin-1 is a byte-to-code-point
 *  map; ascii and cp1252 are strict. Throws LookupError / UnicodeDecodeError. */
export function pyDecode(body: Uint8Array, codec: string): string {
  if (body.length === 0) return ""; // CPython answers empty bytes before looking the codec up
  const impl = TABLE.get(normalize(codec));
  if (!impl) throw new LookupError(`unknown encoding: ${codec}`);
  if (impl === "latin1") return latin1(body);
  if (impl === "ascii") {
    for (let i = 0; i < body.length; i++) if (body[i]! >= 0x80) throw decodeError(codec, body, i, "ordinal not in range(128)");
    return latin1(body);
  }
  if (impl === "cp1252" || impl === "iso8859_9") {
    const codes = new Uint16Array(body.length);
    for (let i = 0; i < body.length; i++) {
      const b = body[i]!;
      let c: number | null | undefined = b;
      if (impl === "cp1252" && b >= 0x80 && b < 0xa0) c = CP1252_HIGH[b - 0x80];
      else if (impl === "iso8859_9") c = LATIN5[b] ?? b;
      if (c == null) throw decodeError(codec, body, i, "character maps to <undefined>");
      codes[i] = c;
    }
    return fromCodes(codes);
  }
  if (impl === "utf8" || impl === "utf8sig") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
    } catch {
      throw new UnicodeDecodeError(`'${codec}' codec can't decode bytes: invalid data`);
    }
    return impl === "utf8sig" && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }
  if (impl.undef) {
    for (let i = 0; i < body.length; i++) if (impl.undef.includes(body[i]!)) throw decodeError(codec, body, i, "character maps to <undefined>");
  }
  try {
    return new TextDecoder(impl.label, { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    throw new UnicodeDecodeError(`'${codec}' codec can't decode bytes: invalid data`);
  }
}

/** bytes.decode("latin-1"): never fails. */
export function latin1(body: Uint8Array): string { return fromCodes(body); }
