#!/usr/bin/env python3
"""Fetch the public event listings around Rio Maior into a folder of JSON files.

    python3 scripts/collect.py rio-maior-collected [--from DATE] [--to DATE] [--only NAME ...]

The window is --from (default today) to --to (default 42 days later); events
outside it are dropped where their dates can be read. scripts/sources.json is
the list of sources: each names the adapter (a module in scripts/adapters/)
that knows its kind of site, its town, its reading group and its URL. An
adapter plans the requests a source needs and turns the pages that come back
into `items` (events it could parse) and `text` (the visible text, capped), and
raises an error when the pages cannot be read. A result that is not shaped as
the adapters promise, or a request to a host other than the source's own, fails
that source. Each source's `label` (a name for people) is copied into its result. Reading, dating and merging the
events is left to whoever reads the files.

Requests go out with a 20 second timeout. Hosts are worked in parallel, one
worker per host (at most 8 at a time), and within a host one request at a time,
spaced by the host's delay in sources.json (1.5 seconds unless the host has its
own), counted from the end of the previous response. After a refusal (403, 429,
a 5xx), a timeout or a connection error the rest of that host's sources are
skipped; any other failed request, a 404 say, fails only its own source. A
source that fails is recorded with ok false and an error and the rest carry on.
A run makes about 32 requests and takes under a minute, the sites being worked
in parallel. Ctrl-C stops the workers between requests, writes nothing
and exits 130.

The output folder holds index.json (the window, `collected_at`, every group's
file and sources, and one summary row per source) and one file per reading
group, <group>.json, with that group's full source results. --only restricts
both to the sources run.

Exit 0 when at least one source was read, even if others failed. Exit 2, with a
message on stderr, for a usage error or when every source failed. Exit 130 when
interrupted.

Python 3.9, standard library only. Read-only requests; TLS is always verified.
A site that refuses the request (a 403, a timeout) is recorded as failed and
not retried another way.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime
import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

sys.dont_write_bytecode = True  # before the adapters are imported

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from adapters import ADAPTERS  # noqa: E402
from adapters.common import AdapterError, Page, Request  # noqa: E402

SOURCES_PATH = os.path.join(HERE, "sources.json")
TIMEOUT = 20
DEFAULT_DAYS = 42
MAX_WORKERS = 8
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 "
    "rio-maior-events/1.0 (personal events digest; one request per page)"
)


def load_config(path=SOURCES_PATH):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def fetch(url, data=None):
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.5"}
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    request = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.status, response.read(), response.headers.get("Content-Type")


def host_of(source):
    return urllib.parse.urlsplit(source["url"]).hostname


def plan_requests(source, window):
    """The requests a source needs: its adapter's, else one GET of its url."""
    adapter = ADAPTERS[source["adapter"]]
    if hasattr(adapter, "requests"):
        requests = list(adapter.requests(source, window))
    else:
        requests = [Request(source["url"])]
    for request in requests:
        host = urllib.parse.urlsplit(request.url).hostname
        if host != host_of(source):
            raise AdapterError("a request to %s, not the source's host %s" % (host, host_of(source)))
    return requests


def run_host(host, jobs, fetch, sleep, clock, delay, on_done=None, stop=None):
    """Fetch one host's requests in turn; jobs is [(name, [Request])].

    Returns {name: {"pages": [Page] or None, "status": int or None, "error": str or None}}.
    Two requests are `delay` seconds apart, from the end of one response to the
    start of the next. A refusal (403, 429, a 5xx), a timeout or a connection
    error fails its source and skips the host's remaining sources; any other
    failed request fails only its own source. Once `stop` (a threading.Event) is
    set, no further request is made and the host's work ends.
    """
    outcomes = {}
    last_end = None
    refused = False
    for name, requests in jobs:
        if stop is not None and stop.is_set():
            break
        outcome = {"pages": None, "status": None, "error": None}
        if refused:
            outcome["error"] = "skipped: %s refused or did not answer" % host
        else:
            pages = []
            for request in requests:
                if stop is not None and stop.is_set():
                    return outcomes
                if last_end is not None:
                    wait = delay - (clock() - last_end)
                    if wait > 0:
                        sleep(wait)
                    if stop is not None and stop.is_set():
                        return outcomes
                try:
                    status, body, content_type = fetch(request.url, request.data)
                    pages.append(Page(request.url, status, body, content_type))
                    outcome["status"] = status
                except urllib.error.HTTPError as err:
                    outcome["status"] = err.code
                    outcome["error"] = "HTTP %d %s" % (err.code, err.reason)
                    refused = err.code in (403, 429) or err.code >= 500
                except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as err:
                    outcome["error"] = "%s: %s" % (type(err).__name__, err)
                    refused = True
                except Exception as err:  # one source failing must not stop the others
                    outcome["error"] = "%s: %s" % (type(err).__name__, err)
                finally:
                    last_end = clock()
                if outcome["error"]:
                    break
            if not outcome["error"]:
                outcome["pages"] = pages
        outcomes[name] = outcome
        if on_done:
            on_done(name, outcome)
    return outcomes


def build_result(source, outcome, window):
    """The result of one source from what its host returned."""
    result = {
        "name": source["name"], "label": source["label"], "url": source["url"],
        "town": source["town"], "adapter": source["adapter"], "ok": False, "status": outcome["status"],
        "error": outcome["error"], "note": None, "items": [], "past": [],
        "text": None, "truncated": False,
    }
    if outcome["error"]:
        return result
    try:
        parsed = ADAPTERS[source["adapter"]].parse(source, outcome["pages"], window)
    except AdapterError as err:
        result["error"] = str(err)
        return result
    except Exception as err:  # one source failing must not stop the others
        result["error"] = "%s: %s" % (type(err).__name__, err)
        return result
    if not well_formed(parsed):
        result["error"] = "adapter returned a malformed result"
        return result
    for key in ("items", "past", "text", "truncated", "note"):
        result[key] = parsed.get(key, result[key])
    result["ok"] = True
    return result


def well_formed(parsed):
    """Whether an adapter's result has the shape the output files promise."""
    if not isinstance(parsed, dict):
        return False
    for key in ("items", "past"):
        value = parsed.get(key, [])
        if not (isinstance(value, list) and all(isinstance(i, dict) for i in value)):
            return False
    for key in ("text", "note"):
        if not isinstance(parsed.get(key), (str, type(None))):
            return False
    return isinstance(parsed.get("truncated", False), bool)


def summary_line(result):
    if not result["ok"]:
        return "%-30s FAILED  %s" % (result["name"], result["error"])
    text = "" if result["text"] is None else ", %d chars of text" % len(result["text"])
    return "%-30s ok  %d items%s%s" % (
        result["name"], len(result["items"]), text, " (truncated)" if result["truncated"] else "")


def collect_all(sources, window, hosts, default_delay, fetch=fetch, sleep=None,
                clock=time.monotonic, max_workers=MAX_WORKERS, report=print):
    """Results for the sources, in the order given, whatever order the hosts finish in.

    `sleep` defaults to waiting on the stop event, so an interrupt ends a wait at
    once. On KeyboardInterrupt the pending hosts are cancelled, the running ones
    stop before their next request, and the interrupt is raised again.
    """
    stop = threading.Event()
    if sleep is None:
        sleep = stop.wait
    results = {}
    by_host = {}
    for source in sources:
        try:
            requests = plan_requests(source, window)
        except Exception as err:
            results[source["name"]] = build_result(
                source, {"pages": None, "status": None, "error": "%s: %s" % (type(err).__name__, err)}, window)
            report(summary_line(results[source["name"]]))
            continue
        by_host.setdefault(host_of(source), []).append((source, requests))

    lock = threading.Lock()

    def delay_of(host):
        return hosts.get(host, {}).get("delay", default_delay)

    def work(host, entries):
        by_name = {s["name"]: s for s, _ in entries}

        def done(name, outcome):
            result = build_result(by_name[name], outcome, window)
            with lock:
                results[name] = result
                report(summary_line(result))
        run_host(host, [(s["name"], r) for s, r in entries], fetch, sleep, clock,
                 delay_of(host), done, stop)

    # The host that will take longest starts first.
    order = sorted(by_host, key=lambda h: -delay_of(h) * sum(len(r) for _, r in by_host[h]))
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = []
        try:
            for host in order:
                futures.append(pool.submit(work, host, by_host[host]))
            for future in futures:
                future.result()
        except BaseException:  # KeyboardInterrupt, or a worker that was interrupted
            stop.set()
            for future in futures:
                future.cancel()
            raise
    return [results[s["name"]] for s in sources]


def write_output(out_dir, collected_at, window, groups, sources, results):
    """index.json and one file per group in out_dir; the sources are those run."""
    os.makedirs(out_dir, exist_ok=True)
    group_of = {s["name"]: s["group"] for s in sources}
    span = {"start": window[0], "end": window[1]}
    index = {"collected_at": collected_at, "window": span, "groups": {}, "sources": []}
    for group in groups:
        names = [s["name"] for s in sources if s["group"] == group]
        if not names:
            continue
        index["groups"][group] = {"file": group + ".json", "sources": names}
        body = {"collected_at": collected_at, "window": span, "group": group,
                "sources": [r for r in results if group_of[r["name"]] == group]}
        with open(os.path.join(out_dir, group + ".json"), "w", encoding="utf-8") as handle:
            json.dump(body, handle, ensure_ascii=False, indent=1)
            handle.write("\n")
    for source, result in zip(sources, results):
        index["sources"].append({
            "name": source["name"], "group": source["group"], "town": source["town"],
            "adapter": source["adapter"], "url": source["url"], "ok": result["ok"],
            "status": result["status"], "error": result["error"], "note": result["note"],
            "items": len(result["items"]), "past": len(result["past"]),
            "chars": len(result["text"] or ""),
        })
    with open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8") as handle:
        json.dump(index, handle, ensure_ascii=False, indent=1)
        handle.write("\n")
    return index


def main(argv=None, fetch=fetch, sleep=None, clock=time.monotonic, max_workers=MAX_WORKERS):
    parser = argparse.ArgumentParser(description="Collect event listings around Rio Maior.")
    parser.add_argument("out", help="folder to write: index.json and one file per group")
    parser.add_argument("--from", dest="start", metavar="YYYY-MM-DD", help="first day (default today)")
    parser.add_argument("--to", dest="end", metavar="YYYY-MM-DD", help="last day (default 42 days after --from)")
    parser.add_argument("--only", nargs="+", metavar="NAME", help="fetch only these sources")
    args = parser.parse_args(argv)

    config = load_config()
    sources = config["sources"]
    names = [s["name"] for s in sources]
    chosen = sources
    if args.only:
        unknown = [n for n in args.only if n not in names]
        if unknown:
            print("unknown source: %s (known: %s)" % (", ".join(unknown), ", ".join(names)),
                  file=sys.stderr)
            return 2
        chosen = [s for s in sources if s["name"] in args.only]

    now = datetime.datetime.now().astimezone()
    try:
        start = datetime.date.fromisoformat(args.start) if args.start else now.date()
        end = datetime.date.fromisoformat(args.end) if args.end else start + datetime.timedelta(days=DEFAULT_DAYS)
    except ValueError as err:
        print("bad date: %s" % err, file=sys.stderr)
        return 2
    if end < start:
        print("--to is before --from", file=sys.stderr)
        return 2
    window = (start.isoformat(), end.isoformat())

    try:
        results = collect_all(chosen, window, config.get("hosts", {}), config.get("default_delay", 1.5),
                              fetch, sleep, clock, max_workers, lambda line: print(line, flush=True))
    except KeyboardInterrupt:
        print("interrupted; nothing written", file=sys.stderr)
        return 130
    ok = sum(1 for r in results if r["ok"])
    if not ok:
        print("every source failed; nothing written", file=sys.stderr)
        return 2
    try:
        index = write_output(args.out, now.isoformat(timespec="seconds"), window,
                             list(config["groups"]), chosen, results)
    except OSError as err:
        print("cannot write %s: %s" % (args.out, err), file=sys.stderr)
        return 2
    print("wrote %s: %d sources ok, %d failed in %d groups"
          % (args.out, ok, len(results) - ok, len(index["groups"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
