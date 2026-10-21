// Port of Python html.unescape (used at common.py:209, 275, 278, 312, 327, 445, 464;
// riomaior_calendar.py:51, 56) and of the attribute-value rule of 3.14 html/parser.py
// (_unescape_attrvalue). Owned by T1. Entity table: src/py/entities.generated.ts (T1, generated).
import { ENTITIES } from "./entities.generated.ts";

const has = (k: string): boolean => Object.hasOwn(ENTITIES, k);

// html._invalid_charrefs: 0x00, 0x0d and 0x80-0x9f (the windows-1252 remap; 0x81, 0x8d, 0x8f, 0x90, 0x9d stay).
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];

/** html._invalid_codepoints minus the 0x80-0x9f part handled by CP1252_HIGH. */
function isInvalidCodepoint(n: number): boolean {
  return (
    (n >= 0x01 && n <= 0x08) || n === 0x0b || (n >= 0x0e && n <= 0x1f) || (n >= 0x7f && n <= 0x9f) ||
    (n >= 0xfdd0 && n <= 0xfdef) || (n & 0xfffe) === 0xfffe
  );
}

function numeric(digits: string, radix: number): string {
  // Python int() raises ValueError past 4300 decimal digits; here a reference that large is just out of range.
  const num = parseInt(digits, radix);
  if (num === 0) return "�";
  if (num === 0x0d) return "\r";
  if (num >= 0x80 && num <= 0x9f) return String.fromCodePoint(CP1252_HIGH[num - 0x80]!);
  if ((num >= 0xd800 && num <= 0xdfff) || num > 0x10ffff) return "�";
  if (isInvalidCodepoint(num)) return "";
  return String.fromCodePoint(num);
}

function named(s: string): string {
  if (has(s)) return ENTITIES[s]!;
  // The longest legacy name that is a prefix (the standard's rule); prefixes are at least 2 code points.
  const cps = Array.from(s);
  for (let x = cps.length - 1; x > 1; x--) {
    const head = cps.slice(0, x).join("");
    if (has(head)) return ENTITIES[head]! + cps.slice(x).join("");
  }
  return "&" + s;
}

// html._charref; [^\t\n\f <&#;] runs over code points, hence the u flag.
const CHARREF = /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/gu;

/** html.unescape(s): named references (with or without ";" for the legacy names), numeric references,
 *  invalid code points dropped, 0x80-0x9F remapped as windows-1252. */
export function unescape(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(CHARREF, (_m, ref: string) => {
    if (ref[0] === "#") {
      const body = ref.endsWith(";") ? ref.slice(0, -1) : ref;
      return body[1] === "x" || body[1] === "X" ? numeric(body.slice(2), 16) : numeric(body.slice(1), 10);
    }
    return named(ref);
  });
}

// html.parser.attr_charref
const ATTR_CHARREF = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*)[;=]?/g;

/** html.parser._unescape_attrvalue (3.14): numeric always; named only on an exact match not followed by "=" or alphanumerics. */
export function unescapeAttrValue(s: string): string {
  return s.replace(ATTR_CHARREF, (ref) => {
    if (ref.startsWith("&#")) return unescape(ref);
    if (!ref.endsWith("=") && has(ref.slice(1))) return unescape(ref);
    return ref;
  });
}
