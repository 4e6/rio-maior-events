// Port of scripts/adapters/santarem_rss.py. Owned by T7.
import type { Adapter, MadeItem } from "./types.ts";

/** santarem_rss.map_feed */
export function mapFeed(_body: Uint8Array): MadeItem[] { throw new Error("not ported"); }

export const santarem_rss: Adapter = {
  parse() { throw new Error("not ported"); },
};
