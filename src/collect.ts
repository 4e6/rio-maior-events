// Port of scripts/collect.py (without the network layer, which is src/net.ts). Owned by T10.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ADAPTERS } from "./adapters/index.ts";
import { defaultDetails } from "./adapters/common.ts";
import { AdapterError } from "./adapters/types.ts";
import type { Adapter, Config, Detail, Page, ParseResult, Request, Source, SourceResult, Window } from "./adapters/types.ts";
import { classifyFailure, classifyFollowFailure, ProxyError, triggersFallback } from "./net-errors.ts";
import { fetchFollow, fetchPage, garbled, ProxyGateway, toPage } from "./net.ts";
import type { FetchResult, Fetcher } from "./net.ts";
import { defaultEnd, lisbonToday, localIsoNow, parseIsoDate } from "./py/datetime.ts";
import { cpLen } from "./py/str.ts";
import { cleanUrl, hostOf, sameSite } from "./url.ts";

export { defaultEnd, lisbonToday };

export const MAX_WORKERS = 8;
export const SOURCES_PATH = join(import.meta.dir, "..", "sources.json");

/** collect.run_host's per-source record. */
export interface Outcome {
  pages: Page[] | null;
  status: number | null;
  error: string | null;
  /** The site refused or did not answer (a 403/429/5xx, a timeout, a connection error), here or earlier on its host. */
  refused?: boolean;
  /** Some request of the source went through the fallback proxy. */
  viaProxy?: boolean;
}

/** The fallback proxy as collect sees it: a fetcher pair, and (optionally) what it has used. */
export interface ProxyFetchers {
  fetch: Fetcher;
  followFetch: Fetcher;
  stats?: () => { bytes: number; max_bytes: number; dead: string | null; hosts: Record<string, number> };
}

/** Everything collectAll lets a test replace (collect.collect_all's fetch/sleep/clock/max_workers/report/follow_fetch). */
export interface CollectDeps {
  /** List requests. Default: net.fetchPage. */
  fetch?: Fetcher;
  /** Event-page requests. Default: net.fetchFollow when `fetch` is the default, else `fetch`. */
  followFetch?: Fetcher;
  /** Seconds. Default: waits on `signal`, so an interrupt ends a wait at once. */
  sleep?: (seconds: number, signal?: AbortSignal) => Promise<void> | void;
  /** Seconds, monotonic. Default: performance.now() / 1000. */
  clock?: () => number;
  maxWorkers?: number;
  /** Progress lines. Default: console.log. */
  report?: (line: string) => void;
  /** Default: ADAPTERS. */
  adapters?: Record<string, Adapter>;
  /** common.default_details, for adapters without a `details` step. Default: the one in adapters/common.ts. */
  defaultDetails?: Adapter["details"];
  /** Aborted by SIGINT/SIGTERM: no further request is made. Replaces threading.Event `stop`. */
  signal?: AbortSignal;
  /** The fallback proxy: a host whose direct request is refused (net-errors.triggersFallback) goes through it. Default: none. */
  proxy?: ProxyFetchers | null;
}

const abortError = (): Error => Object.assign(new Error("interrupted"), { name: "AbortError" });

const defaultSleep = (seconds: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, seconds * 1000);
    signal?.addEventListener("abort", done, { once: true });
  });

const defaultClock = (): number => performance.now() / 1000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const errName = (err: unknown): string => (err as { name?: string })?.name ?? "Error";
const errMessage = (err: unknown): string => (err as { message?: string })?.message ?? String(err);

/** collect.host_of */
export function hostOfSource(source: Source): string | null {
  return hostOf(source.url);
}

/** collect.collect_all: results for the sources, in the order given. Rejects (AbortError) when the signal aborts. */
export async function collectAll(sources: Source[], window: Window, hosts: Config["hosts"], defaultDelay: number,
  deps: CollectDeps = {}): Promise<SourceResult[]> {
  const fetch = deps.fetch ?? fetchPage;
  const followFetch = deps.followFetch ?? (deps.fetch === undefined ? fetchFollow : fetch);
  const adapters = deps.adapters ?? ADAPTERS;
  const report = deps.report ?? ((line: string) => console.log(line));
  const clock = deps.clock ?? defaultClock;
  const sleep = deps.sleep ?? defaultSleep;
  const maxWorkers = deps.maxWorkers ?? MAX_WORKERS;
  const signal = deps.signal;
  const parseDeps = { adapters, defaultDetails: deps.defaultDetails };

  const results = new Map<string, SourceResult>();
  const byHost = new Map<string, [Source, Request[]][]>();
  for (const source of sources) {
    let requests: Request[];
    try {
      requests = planRequests(source, window, adapters);
    } catch (err) {
      const result = newResult(source, { pages: null, status: null, error: `${errName(err)}: ${errMessage(err)}` });
      results.set(source.name, result);
      report(summaryLine(result));
      continue;
    }
    const host = hostOfSource(source) ?? "";
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host)!.push([source, requests]);
  }

  const delayOf = (host: string): number => hosts?.[host]?.delay ?? defaultDelay;

  const work = async (host: string, entries: [Source, Request[]][]): Promise<void> => {
    const byName = new Map(entries.map(([s]) => [s.name, s] as const));
    await runHost(host, entries.map(([s, r]) => [s.name, r] as [string, Request[]]), {
      fetch, sleep, clock, delay: delayOf(host), signal, followFetch, proxy: deps.proxy,
      onDone(name, outcome) {
        const [result, follow] = parseOutcome(byName.get(name)!, outcome, window, parseDeps.adapters);
        results.set(name, result);
        report(summaryLine(result));
        return follow;
      },
      onFollowed(name, pages, viaProxy) {
        const details = buildDetails(byName.get(name)!, pages, window, parseDeps.adapters, parseDeps.defaultDetails);
        const result = results.get(name)!;
        result.details = details;
        if (viaProxy) result.via = "proxy";
        report(detailsLine(result));
      },
    });
  };

  // The host that will take longest starts first (a stable sort, like Python's).
  const cost = (h: string): number => -delayOf(h) * (
    byHost.get(h)!.reduce((n, [, r]) => n + r.length, 0) + byHost.get(h)!.reduce((n, [s]) => n + (s.follow ?? 0), 0));
  const order = [...byHost.keys()].sort((a, b) => cost(a) - cost(b));

  // At most maxWorkers hosts at a time, each started in the order above; none after an abort.
  let next = 0;
  let failure: { error: unknown } | null = null;
  const runner = async (): Promise<void> => {
    while (next < order.length && !signal?.aborted && !failure) {
      const host = order[next++]!;
      try {
        await work(host, byHost.get(host)!);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(maxWorkers, 1), order.length) }, runner));
  if (failure) throw (failure as { error: unknown }).error;
  if (signal?.aborted) throw abortError();
  return sources.map((s) => results.get(s.name)!);
}

/** collect.plan_requests */
export function planRequests(source: Source, window: Window, adapters: Record<string, Adapter> = ADAPTERS): Request[] {
  const adapter = adapters[source.adapter]!;
  const requests = typeof adapter.requests === "function"
    ? [...adapter.requests(source, window)]
    : [{ url: source.url, data: null }];
  for (const request of requests) {
    const host = hostOf(request.url);
    if (host !== hostOfSource(source)) {
      throw new AdapterError(`a request to ${host}, not the source's host ${hostOfSource(source)}`);
    }
  }
  return requests;
}

/** collect.run_host: one host's requests in turn (async); see the Python docstring for the refusal rules. */
export async function runHost(host: string, jobs: [name: string, requests: Request[]][], deps: Required<Pick<CollectDeps, "fetch" | "sleep" | "clock">> & {
  delay: number; onDone?: (name: string, outcome: Outcome) => Request[] | null | undefined; signal?: AbortSignal;
  followFetch?: Fetcher; onFollowed?: (name: string, pages: Page[], viaProxy: boolean) => void;
  /** The fallback proxy; see CollectDeps.proxy. */
  proxy?: ProxyFetchers | null;
}): Promise<Record<string, Outcome>> {
  const { fetch, sleep, clock, delay, onDone, signal, onFollowed, proxy } = deps;
  const followFetch = deps.followFetch ?? fetch;
  const outcomes: Record<string, Outcome> = {};
  const wanted: [string, Request[]][] = [];
  let lastEnd: number | null = null;

  /** Waits out the delay; false once stopped. */
  const pause = async (): Promise<boolean> => {
    if (signal?.aborted) return false;
    if (lastEnd !== null) {
      const wait = delay - (clock() - lastEnd);
      if (wait > 0) await sleep(wait, signal);
      if (signal?.aborted) return false;
    }
    return true;
  };

  // Direct first. The first refusal (net-errors.triggersFallback) switches the host to the proxy: that request is
  // retried once through it and every later request of the host goes through it, with no second direct attempt.
  let viaProxy = false;
  const STOPPED = Symbol("stopped");
  const go = async (request: Request, follow: boolean): Promise<FetchResult> => {
    const direct = follow ? followFetch : fetch;
    const proxied = follow ? proxy?.followFetch : proxy?.fetch;
    if (!viaProxy || !proxied) {
      try {
        return await direct(request.url, follow ? null : request.data, signal);
      } catch (err) {
        if (!proxied || !triggersFallback(err)) throw err;
        viaProxy = true;
      }
      lastEnd = clock();
      if (!(await pause())) throw STOPPED;
    }
    return proxied!(request.url, follow ? null : request.data, signal);
  };
  /** The proxy failed or ran out of budget: ends the host without counting as the site refusing. */
  let proxyStopped: string | null = null;
  const stopOnProxy = (err: unknown): boolean => {
    if (!(err instanceof ProxyError)) return false;
    proxyStopped = err.message;
    return true;
  };

  let refused = false;
  for (const [name, requests] of jobs) {
    if (signal?.aborted) break;
    const outcome: Outcome = { pages: null, status: null, error: null };
    if (refused) {
      outcome.error = `skipped: ${host} refused or did not answer`;
      outcome.refused = true;
    } else if (proxyStopped) {
      outcome.error = `skipped: ${proxyStopped}`;
    } else {
      const pages: Page[] = [];
      for (const request of requests) {
        if (!(await pause())) return outcomes;
        try {
          const result = await go(request, false);
          if (viaProxy) outcome.viaProxy = true;
          outcome.status = result.status;
          if (garbled(result.body, result.contentType)) outcome.error = "unreadable response (binary or garbled)";
          else pages.push({ url: request.url, status: result.status, body: result.body, contentType: result.contentType });
        } catch (err) {
          if (err === STOPPED) return outcomes;
          if (viaProxy) outcome.viaProxy = true;
          const failure = classifyFailure(err);
          if (failure.status !== null) outcome.status = failure.status;
          outcome.error = failure.message;
          if (stopOnProxy(err)) { /* the host ends, the site did not refuse */ }
          else if (failure.refused) { refused = true; outcome.refused = true; }
        } finally {
          lastEnd = clock();
        }
        if (outcome.error) break;
      }
      if (!outcome.error) outcome.pages = pages;
    }
    outcomes[name] = outcome;
    const follows = onDone ? onDone(name, outcome) : null;
    if (follows && follows.length > 0 && !outcome.error) wanted.push([name, follows]);
  }

  if (refused || proxyStopped || wanted.length === 0) return outcomes;
  const got = new Map<string, Page | null>(); // url asked for -> Page, or null when it failed
  const proxiedUrls = new Set<string>();
  outer:
  for (const [, urls] of wanted) {
    for (const request of urls) {
      if (got.has(request.url)) continue;
      got.set(request.url, null);
      if (!(await pause())) return outcomes;
      try {
        const result = await go(request, true);
        if (viaProxy) proxiedUrls.add(request.url);
        if (!garbled(result.body, result.contentType)) got.set(request.url, toPage(request, result));
      } catch (err) {
        if (err === STOPPED) return outcomes;
        if (viaProxy) proxiedUrls.add(request.url);
        if (classifyFollowFailure(err) === "stop") break outer; // a refusal ends the host's follows
      } finally {
        lastEnd = clock();
      }
    }
  }
  if (onFollowed) {
    for (const [name, urls] of wanted) {
      const pages = urls.map((r) => got.get(r.url)).filter((p): p is Page => !!p);
      if (pages.length > 0) onFollowed(name, pages, urls.some((r) => proxiedUrls.has(r.url)));
    }
  }
  return outcomes;
}

/** collect.new_result */
export function newResult(source: Source, outcome: Outcome): SourceResult {
  return {
    name: source.name, label: source.label, url: source.url,
    town: source.town, adapter: source.adapter, ok: false, status: outcome.status,
    error: outcome.error, note: null, items: [], past: [],
    text: null, truncated: false, details: [],
    ...(outcome.refused ? { refused: true } : {}),
    ...(outcome.viaProxy ? { via: "proxy" as const } : {}),
  };
}

/** collect.parse_outcome: (result, follow requests). */
export function parseOutcome(source: Source, outcome: Outcome, window: Window, adapters: Record<string, Adapter> = ADAPTERS): [SourceResult, Request[]] {
  const result = newResult(source, outcome);
  if (outcome.error) return [result, []];
  let parsed: ParseResult;
  try {
    parsed = adapters[source.adapter]!.parse(source, outcome.pages!, window);
  } catch (err) {
    result.error = err instanceof AdapterError ? err.message : `${errName(err)}: ${errMessage(err)}`;
    return [result, []];
  }
  if (!wellFormed(parsed)) {
    result.error = "adapter returned a malformed result";
    return [result, []];
  }
  for (const key of ["items", "past", "text", "truncated", "note"] as const) {
    if (Object.hasOwn(parsed, key) && (parsed as unknown as Record<string, unknown>)[key] !== undefined) {
      (result as unknown as Record<string, unknown>)[key] = (parsed as unknown as Record<string, unknown>)[key];
    }
  }
  result.ok = true;
  return [result, followRequests(source, parsed.follow)];
}

/** collect.follow_requests: same-site https requests, once each, capped by source.follow. */
export function followRequests(source: Source, follow: Request[] | undefined): Request[] {
  const limit = source.follow ?? 0;
  const found: Request[] = [];
  for (const request of follow ?? []) {
    const url = cleanUrl(null, request.url);
    if (url && url.startsWith("https://") && sameSite(url, "https://" + hostOfSource(source))
        && !found.some((r) => r.url === url)) {
      found.push({ url, data: null });
    }
  }
  return Number.isInteger(limit) ? found.slice(0, limit) : [];
}

/** collect.build_details */
export function buildDetails(source: Source, pages: Page[], window: Window, adapters: Record<string, Adapter> = ADAPTERS,
  fallback: Adapter["details"] = defaultDetails): Detail[] {
  const adapter = adapters[source.adapter]!;
  let found: unknown;
  try {
    found = (adapter.details ?? fallback!).call(adapter, source, pages, window);
  } catch {
    return [];
  }
  return Array.isArray(found) && found.every(isObject) ? (found as unknown as Detail[]) : [];
}

/** collect.well_formed */
export function wellFormed(parsed: ParseResult): boolean {
  if (!isObject(parsed)) return false;
  const p = parsed as unknown as Record<string, unknown>;
  for (const key of ["items", "past"]) {
    const value = Object.hasOwn(p, key) ? p[key] : [];
    if (!(Array.isArray(value) && value.every(isObject))) return false;
  }
  for (const key of ["text", "note"]) {
    const value = p[key];
    if (!(value === undefined || value === null || typeof value === "string")) return false;
  }
  const follow = Object.hasOwn(p, "follow") ? p.follow : [];
  if (!(Array.isArray(follow) && follow.every((r) =>
      isObject(r) && typeof r.url === "string" && (r.data === null || r.data === undefined)))) return false;
  const truncated = Object.hasOwn(p, "truncated") ? p.truncated : false;
  return typeof truncated === "boolean";
}

const pad30 = (s: string): string => s + " ".repeat(Math.max(0, 30 - cpLen(s)));

/** collect.summary_line */
export function summaryLine(result: SourceResult): string {
  const via = result.via === "proxy" ? " (via proxy)" : "";
  if (!result.ok) return `${pad30(result.name)} FAILED  ${result.error}${via}`;
  const text = result.text === null ? "" : `, ${cpLen(result.text)} chars of text`;
  return `${pad30(result.name)} ok  ${result.items.length} items${text}${result.truncated ? " (truncated)" : ""}${via}`;
}

/** collect.details_line */
export function detailsLine(result: SourceResult): string {
  return `${pad30(result.name)}    ${result.details.length} event pages read`;
}

/** collect.load_config (sources.json). */
export function loadConfig(path: string = SOURCES_PATH): Config {
  return JSON.parse(readFileSync(path, "utf8")) as Config;
}

const dumps = (value: unknown): string => JSON.stringify(value, null, 1) + "\n";

/** collect.write_output: index.json and one <group>.json per group in outDir (JSON.stringify(x, null, 1) + "\n"). */
export function writeOutput(outDir: string, collectedAt: string, window: Window, groups: string[], sources: Source[], results: SourceResult[],
  extra: { collect_s?: number; proxy?: ReturnType<NonNullable<ProxyFetchers["stats"]>> } = {}): unknown {
  mkdirSync(outDir, { recursive: true });
  const groupOf = new Map(sources.map((s) => [s.name, s.group] as const));
  const span = { start: window[0], end: window[1] };
  const index: { collected_at: string; collect_s?: number; proxy?: unknown; window: typeof span; groups: Record<string, { file: string; sources: string[] }>; sources: unknown[] } =
    { collected_at: collectedAt, window: span, groups: {}, sources: [] };
  if (extra.collect_s !== undefined) index.collect_s = extra.collect_s;
  if (extra.proxy) index.proxy = extra.proxy;
  for (const group of groups) {
    const names = sources.filter((s) => s.group === group).map((s) => s.name);
    if (names.length === 0) continue;
    index.groups[group] = { file: group + ".json", sources: names };
    const body = { collected_at: collectedAt, window: span, group, sources: results.filter((r) => groupOf.get(r.name) === group).map(({ refused: _refused, via: _via, ...rest }) => rest) };
    writeFileSync(join(outDir, group + ".json"), dumps(body));
  }
  sources.forEach((source, i) => {
    const result = results[i]!;
    index.sources.push({
      name: source.name, group: source.group, town: source.town,
      adapter: source.adapter, url: source.url, ok: result.ok,
      status: result.status, error: result.error, refused: result.refused === true, via: result.via === "proxy" ? "proxy" : "direct", note: result.note,
      items: result.items.length, past: result.past.length,
      chars: cpLen(result.text || ""), details: result.details.length,
    });
  });
  writeFileSync(join(outDir, "index.json"), dumps(index));
  return index;
}

const USAGE = "usage: collect.ts [-h] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--only NAME [NAME ...]] out";

interface Args { out: string; start?: string; end?: string; only?: string[] }

/** argparse for collect.py's four arguments; a string is the usage error. */
function parseArgs(argv: string[]): Args | "help" | string {
  const args: Partial<Args> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i]!;
    if (arg === "-h" || arg === "--help") return "help";
    let inline: string | undefined;
    const eq = arg.indexOf("=");
    if (arg.startsWith("--") && eq > 0) { inline = arg.slice(eq + 1); arg = arg.slice(0, eq); }
    if (arg === "--from" || arg === "--to") {
      const value = inline ?? argv[++i];
      if (value === undefined || (inline === undefined && value.startsWith("-") && value.length > 1)) return `argument ${arg}: expected one argument`;
      if (arg === "--from") args.start = value; else args.end = value;
    } else if (arg === "--only") {
      const values: string[] = inline !== undefined ? [inline] : [];
      while (inline === undefined && i + 1 < argv.length && !argv[i + 1]!.startsWith("-")) values.push(argv[++i]!);
      if (values.length === 0) return "argument --only: expected at least one argument";
      args.only = values;
    } else if (arg.startsWith("-") && arg.length > 1) {
      return `unrecognized arguments: ${argv[i]}`;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length === 0) return "the following arguments are required: out";
  if (positional.length > 1) return `unrecognized arguments: ${positional.slice(1).join(" ")}`;
  args.out = positional[0]!;
  return args as Args;
}

export interface MainDeps extends CollectDeps {
  /** An ISO date, standing in for Lisbon's today. */
  today?: string;
  /** Default: py/datetime lisbonToday. */
  lisbonToday?: () => string;
  /** stdout / stderr lines. Default: console.log / console.error. */
  out?: (line: string) => void;
  err?: (line: string) => void;
  /** Where sources.json is. Default: sources.json. */
  config?: Config;
  /** The environment FALLBACK_PROXY_URL and FALLBACK_PROXY_MAX_MB are read from. Default: process.env. */
  env?: Record<string, string | undefined>;
}

/** collect.main(argv): returns the exit code (0, 2, 130). */
export async function main(argv: string[], deps: MainDeps = {}): Promise<number> {
  const out = deps.out ?? ((line: string) => console.log(line));
  const err = deps.err ?? ((line: string) => console.error(line));
  const args = parseArgs(argv);
  if (args === "help") {
    out(USAGE);
    return 0;
  }
  if (typeof args === "string") {
    err(USAGE);
    err(`collect.ts: error: ${args}`);
    return 2;
  }

  // The fallback proxy, only when FALLBACK_PROXY_URL is set. Nothing about it is printed except the masks Actions needs.
  const env = deps.env ?? process.env;
  let proxy: ProxyFetchers | null | undefined = deps.proxy;
  if (proxy === undefined) {
    try {
      proxy = ProxyGateway.fromEnv(env);
    } catch (e) {
      err(`FALLBACK_PROXY_URL ignored: ${errMessage(e)}`);
      proxy = null;
    }
  }
  if (proxy instanceof ProxyGateway && env.GITHUB_ACTIONS === "true") {
    for (const value of proxy.maskValues) if (!/[\r\n]/.test(value)) out(`::add-mask::${value}`);
  }
  if (proxy) out(`fallback proxy on: a host that refuses a direct request is read through it${proxy instanceof ProxyGateway ? `, at most ${Math.round(proxy.maxBytes / 1048576)} MB` : ""}`);

  const config = deps.config ?? loadConfig();
  const sources = config.sources;
  const names = sources.map((s) => s.name);
  let chosen = sources;
  if (args.only) {
    const unknown = args.only.filter((n) => !names.includes(n));
    if (unknown.length > 0) {
      err(`unknown source: ${unknown.join(", ")} (known: ${names.join(", ")})`);
      return 2;
    }
    chosen = sources.filter((s) => args.only!.includes(s.name));
  }

  const now = new Date();
  let start: string;
  let end: string;
  const parse = (value: string): string => {
    const day = parseIsoDate(value);
    if (day === null) throw new RangeError(`Invalid isoformat string: '${value}'`);
    return day;
  };
  try {
    start = args.start ? parse(args.start) : (deps.today ?? (deps.lisbonToday ?? lisbonToday)());
    end = args.end ? parse(args.end) : defaultEnd(start);
  } catch (e) {
    err(`bad date: ${errMessage(e)}`);
    return 2;
  }
  if (end < start) {
    err("--to is before --from");
    return 2;
  }
  const window: Window = [start, end];

  const controller = new AbortController();
  const stop = () => controller.abort();
  if (deps.signal?.aborted) controller.abort();
  deps.signal?.addEventListener("abort", stop, { once: true });
  // A second Ctrl-C leaves at once, without waiting for what is still in flight.
  const onSigint = () => { if (controller.signal.aborted) process.exit(130); stop(); };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", stop);
  let results: SourceResult[];
  const collectStart = Date.now();
  try {
    results = await collectAll(chosen, window, config.hosts, config.default_delay ?? 1.5,
      { ...deps, proxy, signal: controller.signal, report: deps.report ?? out });
  } catch (e) {
    if (controller.signal.aborted) {
      err("interrupted; nothing written");
      return 130;
    }
    throw e;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", stop);
    deps.signal?.removeEventListener("abort", stop);
  }
  const ok = results.filter((r) => r.ok).length;
  if (ok === 0) {
    err("every source failed; nothing written");
    return 2;
  }
  let index: { groups: Record<string, unknown> };
  try {
    index = writeOutput(args.out, localIsoNow(now), window, Object.keys(config.groups), chosen, results,
      { collect_s: Math.round((Date.now() - collectStart) / 100) / 10, proxy: proxy?.stats?.() }) as typeof index;
  } catch (e) {
    err(`cannot write ${args.out}: ${errMessage(e)}`);
    return 2;
  }
  const used = proxy?.stats?.();
  if (used) out(`fallback proxy: about ${(used.bytes / 1048576).toFixed(1)} MB of ${Math.round(used.max_bytes / 1048576)} MB used${used.dead ? `, ${used.dead}` : ""}`);
  out(`wrote ${args.out}: ${ok} sources ok, ${results.length - ok} failed in ${Object.keys(index.groups).length} groups`);
  return 0;
}
