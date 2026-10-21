// Port of scripts/adapters/text.py. Owned by T8.
import type { Adapter } from "./types.ts";

/** text.parse: visible text plus JSON-LD events; `follow` from source.links markers. */
export const text: Adapter = {
  parse() { throw new Error("not ported"); },
};
