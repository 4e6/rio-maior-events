// Port of scripts/merge.py. Owned by T11. Documents are JSON objects; they stay loosely typed.
// Plan decision 3: JSON.stringify(doc, null, 1) + "\n" output; `$`-before-newline fixed in the date regexes.
type Doc = Record<string, any>;
const NYI = (): never => { throw new Error("not ported"); };

/** merge.normalise (NFKD, no combining marks, casefold, collapsed whitespace; also LOOKALIKES). */
export function normalise(_text: string): string { return NYI(); }
/** merge.tokens */
export function tokens(_title: string): Set<string> { return NYI(); }
/** merge.full_date */
export function fullDate(_text: unknown): string | null { return NYI(); }
/** merge.town_names */
export function townNames(_town: unknown): Set<string> { return NYI(); }
/** merge.day_range */
export function dayRange(_e: Doc): [string, string] | null { return NYI(); }
/** merge.possible_duplicates */
export function possibleDuplicates(_events: Doc[]): string[] { return NYI(); }
/** merge.describe */
export function describe(_e: Doc): string { return NYI(); }
/** merge.municipal_or_venue */
export function municipalOrVenue(_source: Doc, _event: Doc): boolean { return NYI(); }
/** merge.preference */
export function preference(_e: Doc): [boolean, boolean, boolean] { return NYI(); }
/** merge.merge: (document, report lines) or (null, problems). `now` is injectable for tests. */
export function merge(_collected: string, _candidates: string, _now?: Date, _missingOk?: boolean): [Doc | null, string[]] { return NYI(); }
/** merge.finalize_document: make a document pass render's check. */
export function finalizeDocument(_doc: Doc): Doc { return NYI(); }
/** merge.finalize: in place on a file; exit code. */
export function finalize(_path: string): number { return NYI(); }
/** merge.main(argv, now): exit code. */
export function main(_argv: string[], _now?: Date): number { return NYI(); }
