// Port of scripts/render.py. Owned by T11. Plan decision 3: deterministic event ids need not match Python's.
type Doc = Record<string, any>;
const NYI = (): never => { throw new Error("not ported"); };

export const CATEGORIES: readonly string[] = [];
export const KINDS = ["single", "multi_day", "ongoing", "recurring"] as const;
export const MAX_PROBLEMS = 20;

/** render.normalise */
export function normalise(_text: string): string { return NYI(); }
/** render.event_id: 10 hex chars from a hash of title|start_date|town. */
export function eventId(_event: Doc): string { return NYI(); }
/** render.real_date / real_month / text_ok */
export function realDate(_text: unknown): string | null { return NYI(); }
export function realMonth(_text: unknown): boolean { return NYI(); }
export function textOk(_value: unknown): boolean { return NYI(); }
/** render.check_event(e, window): problem strings. */
export function checkEvent(_e: Doc, _window?: readonly [string, string] | null): string[] { return NYI(); }
/** render.check(data): problem strings for a whole events document. */
export function check(_data: unknown): string[] { return NYI(); }
/** render.safe_url */
export function safeUrl(_url: string): string { return NYI(); }
/** render.page_data */
export function pageData(_data: Doc): Doc { return NYI(); }
/** render.embed */
export function embed(_data: Doc): string { return NYI(); }
/** render.build(data, css, js): the page HTML. */
export function build(_data: Doc, _css: string, _js: string): string { return NYI(); }
/** render.main(argv): exit code (0, 2). */
export function main(_argv: string[]): number { return NYI(); }
