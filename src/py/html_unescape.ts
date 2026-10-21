// Port of Python html.unescape (used at common.py:209, 275, 278, 312, 327, 445, 464;
// riomaior_calendar.py:51, 56) and of the attribute-value rule of 3.14 html/parser.py
// (_unescape_attrvalue). Owned by T1. Entity table: src/py/entities.generated.ts (T1, generated).
const NYI = (): never => { throw new Error("not ported"); };

/** html.unescape(s): named references (with or without ";" for the legacy names), numeric references,
 *  invalid code points dropped, 0x80-0x9F remapped as windows-1252. */
export function unescape(_s: string): string { return NYI(); }

/** html.parser._unescape_attrvalue (3.14): numeric always; named only on an exact match not followed by "=" or alphanumerics. */
export function unescapeAttrValue(_s: string): string { return NYI(); }
