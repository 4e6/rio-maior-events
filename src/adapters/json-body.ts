// Shared by the JSON adapters: Python `json.loads(body.decode("utf-8"))` (strict UTF-8; a leading BOM is an error
// there as here). NaN and Infinity, which Python accepts, are not read (see the known differences).
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function loadJsonBody(body: Uint8Array): unknown {
  return JSON.parse(UTF8.decode(body));
}

/** Python truthiness of a JSON value. */
export function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "" || Number.isNaN(v)) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
