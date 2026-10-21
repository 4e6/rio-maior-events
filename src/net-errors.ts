// The error taxonomy of the network layer. Python counterparts: urllib.error.HTTPError, URLError,
// socket.timeout / TimeoutError / ConnectionError, collect.RedirectRefused, and the except
// clauses in collect.run_host (collect.py:232-241, 266-275).

/** A non-2xx answer (urllib.error.HTTPError). `reason` is the server's phrase where Bun exposes it. */
export class HttpError extends Error {
  override name = "HTTPError";
  constructor(public code: number, public reason: string) {
    super(`HTTP ${code} ${reason}`);
  }
}

/** Timeout (socket.timeout / TimeoutError): a refusal. */
export class TimeoutError extends Error {
  override name = "TimeoutError";
}

/** DNS, connection refused/reset, TLS (URLError, ConnectionError): a refusal. `code` e.g. ECONNREFUSED. */
export class NetworkError extends Error {
  override name = "URLError";
  constructor(message: string, public code?: string) {
    super(message);
  }
}

/** collect.RedirectRefused: a follow was redirected to another host or to plain http. */
export class RedirectRefused extends Error {
  override name = "RedirectRefused";
}

/** What run_host records for a failed list request. */
export interface Failure {
  /** HTTP status when the error is an HttpError, else null. */
  status: number | null;
  /** "HTTP 404 Not Found" or "<ClassName>: <message>" (collect.py:233-239). */
  message: string;
  /** Skip the host's remaining sources: 403, 429, >=500, timeout, network error. Other errors fail only the source. */
  refused: boolean;
}

/** Python counterpart: the except chain in collect.run_host for a list request. */
export function classifyFailure(_err: unknown): Failure {
  throw new Error("not ported");
}

/** Python counterpart: the except chain in collect.run_host for a followed page:
 *  "skip" = RedirectRefused, other HTTP codes and other errors; "stop" = a refusal (403/429/>=500,
 *  timeout, network error), which ends the host's follows. */
export function classifyFollowFailure(_err: unknown): "skip" | "stop" {
  throw new Error("not ported");
}
