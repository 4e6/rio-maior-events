// Python-generated vectors (tools/gen_vectors.py).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./helpers.ts";

export interface StrRow {
  s: string; len: number; first: string; last: string; isalnum: boolean; isdigit: boolean; strip: string; split: string[];
  casefold: string; repr: string; slices: [number, number | null, string][]; fold_nfd: string; norm_render: string; norm_merge: string;
}
export const vectors = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "py_vectors.json"), "utf8")) as {
  python: string;
  unescape: [string, string][];
  attr: [string, string][];
  str: StrRow[];
  compare: [string, string, number][];
  repr_misc: [unknown, string][];
};
