// Port of scripts/adapters/cadaval_api.py. Owned by T7.
import type { Adapter, MadeItem } from "./types.ts";

/** cadaval_api.map_events */
export function mapEvents(_data: unknown, _base: string): MadeItem[] { throw new Error("not ported"); }

export const cadaval_api: Adapter = {
  parse() { throw new Error("not ported"); },
};
