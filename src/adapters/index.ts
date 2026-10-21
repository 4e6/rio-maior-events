// scripts/adapters/__init__.py: sources.json names the adapter a source uses.
import type { Adapter } from "./types.ts";
import { cadaval_api } from "./cadaval_api.ts";
import { events_calendar } from "./events_calendar.ts";
import { municipal_rss } from "./municipal_rss.ts";
import { nextjs } from "./nextjs.ts";
import { riomaior_calendar } from "./riomaior_calendar.ts";
import { santarem_rss } from "./santarem_rss.ts";
import { text } from "./text.ts";

export const ADAPTERS: Record<string, Adapter> = {
  text,
  riomaior_calendar,
  events_calendar,
  cadaval_api,
  nextjs,
  santarem_rss,
  municipal_rss,
};
