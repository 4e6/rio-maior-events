// Port of scripts/collect.py (without the network layer, which is src/net.ts). Owned by T10.
import type { Adapter, Config, Detail, Page, ParseResult, Request, Source, SourceResult, Window } from "./adapters/types.ts";
import type { Fetcher } from "./net.ts";

const NYI = (): never => { throw new Error("not ported"); };

export const MAX_WORKERS = 8;

/** collect.run_host's per-source record. */
export interface Outcome {
  pages: Page[] | null;
  status: number | null;
  error: string | null;
}

/** Everything collectAll lets a test replace (collect.collect_all's fetch/sleep/clock/max_workers/report/follow_fetch). */
export interface CollectDeps {
  /** List requests. Default: net.fetchPage. */
  fetch?: Fetcher;
  /** Event-page requests. Default: net.fetchFollow when `fetch` is the default, else `fetch`. */
  followFetch?: Fetcher;
  /** Seconds. Default: waits on `signal`, so an interrupt ends a wait at once. */
  sleep?: (seconds: number, signal?: AbortSignal) => Promise<void>;
  /** Seconds, monotonic. Default: performance.now() / 1000. */
  clock?: () => number;
  maxWorkers?: number;
  /** Progress lines. Default: console.log. */
  report?: (line: string) => void;
  /** Default: ADAPTERS. */
  adapters?: Record<string, Adapter>;
  /** Aborted by SIGINT/SIGTERM: no further request is made. Replaces threading.Event `stop`. */
  signal?: AbortSignal;
}

/** collect.collect_all: results for the sources, in the order given. Rejects (AbortError) when the signal aborts. */
export async function collectAll(_sources: Source[], _window: Window, _hosts: Config["hosts"], _defaultDelay: number,
  _deps?: CollectDeps): Promise<SourceResult[]> { return NYI(); }

/** collect.plan_requests */
export function planRequests(_source: Source, _window: Window, _adapters?: Record<string, Adapter>): Request[] { return NYI(); }

/** collect.run_host: one host's requests in turn (async); see the Python docstring for the refusal rules. */
export async function runHost(_host: string, _jobs: [name: string, requests: Request[]][], _deps: Required<Pick<CollectDeps, "fetch" | "sleep" | "clock">> & {
  delay: number; onDone?: (name: string, outcome: Outcome) => Request[] | null | undefined; signal?: AbortSignal;
  followFetch?: Fetcher; onFollowed?: (name: string, pages: Page[]) => void;
}): Promise<Record<string, Outcome>> { return NYI(); }

/** collect.new_result */
export function newResult(_source: Source, _outcome: Outcome): SourceResult { return NYI(); }

/** collect.parse_outcome: (result, follow requests). */
export function parseOutcome(_source: Source, _outcome: Outcome, _window: Window, _adapters?: Record<string, Adapter>): [SourceResult, Request[]] { return NYI(); }

/** collect.follow_requests: same-site https requests, once each, capped by source.follow. */
export function followRequests(_source: Source, _follow: Request[] | undefined): Request[] { return NYI(); }

/** collect.build_details */
export function buildDetails(_source: Source, _pages: Page[], _window: Window, _adapters?: Record<string, Adapter>): Detail[] { return NYI(); }

/** collect.well_formed */
export function wellFormed(_parsed: ParseResult): boolean { return NYI(); }

/** collect.summary_line */
export function summaryLine(_result: SourceResult): string { return NYI(); }

/** collect.details_line */
export function detailsLine(_result: SourceResult): string { return NYI(); }

/** collect.load_config (scripts/sources.json; src location decided by T10 per the plan). */
export function loadConfig(_path?: string): Config { return NYI(); }

/** collect.write_output: index.json and one <group>.json per group in outDir (JSON.stringify(x, null, 1) + "\n"). */
export function writeOutput(_outDir: string, _collectedAt: string, _window: Window, _groups: string[], _sources: Source[], _results: SourceResult[]): unknown { return NYI(); }

/** collect.main(argv): returns the exit code (0, 2, 130). */
export async function main(_argv: string[], _deps?: CollectDeps & { today?: string }): Promise<number> { return NYI(); }
