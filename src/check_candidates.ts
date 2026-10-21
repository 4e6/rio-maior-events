// Port of the former check_candidates.py. Owned by T11.
import { has, isDict, MAX_PROBLEMS, checkEvent, dumps, readText, realDate, textOk } from "./render.ts";
import { parseArgs } from "./cli-args.ts";
import { pyRepr } from "./py/str.ts";

/** check_candidates.problems_in(data, group, stamp, window): problem strings. */
export function problemsIn(data: unknown, group: string, stamp: string, window: readonly [string, string]): string[] {
  if (!isDict(data)) return ["the file must hold one JSON object"];
  const bad: string[] = [];
  for (const key of ["collected_at", "group", "events", "hints", "coverage"]) {
    if (!has(data, key)) bad.push("missing " + key);
  }
  if (bad.length) return bad;
  if (data.collected_at !== stamp) {
    bad.push(`collected_at is ${pyRepr(data.collected_at)} but the group file says ${pyRepr(stamp)}`);
  }
  if (data.group !== group) bad.push(`group is ${pyRepr(data.group)} but this file is for ${pyRepr(group)}`);
  if (!textOk(data.coverage)) bad.push("coverage must be a non-empty string");
  for (const key of ["events", "hints"]) {
    const items = data[key];
    if (!(Array.isArray(items) && items.every(isDict))) {
      bad.push(`${key} must be a list of events`);
      continue;
    }
    items.forEach((e, i) => {
      const label = `${key}[${i}] ${dumps(has(e, "title_pt") ? e.title_pt : "")}`;
      for (const m of checkEvent(e, window)) bad.push(label + ": " + m);
    });
  }
  return bad;
}

const USAGE = "usage: bun src/cli/check_candidates.ts [-h] --index INDEX --group GROUP path";

/** check_candidates.main(argv): exit code. */
export function main(argv: string[]): number {
  const args = parseArgs({
    prog: "bun src/cli/check_candidates.ts", usage: USAGE,
    positionals: [{ name: "path" }],
    values: [{ name: "--index", required: true }, { name: "--group", required: true }],
  }, argv);
  if (args === null) return 2;
  if (args.help) return 0;
  const path = args.positionals[0]!;
  const indexPath = args.values.get("--index")!;
  const group = args.values.get("--group")!;
  let window: [string, string];
  let stamp: string;
  try {
    const index = JSON.parse(readText(indexPath));
    if (!isDict(index)) throw new TypeError("the index must be a JSON object");
    if (!has(index, "window")) throw new Error("'window'");
    const w = index.window;
    if (!isDict(w)) throw new TypeError("the window must be an object");
    if (!has(w, "start")) throw new Error("'start'");
    if (!has(w, "end")) throw new Error("'end'");
    const start = realDate(w.start), end = realDate(w.end);
    if (!has(index, "collected_at")) throw new Error("'collected_at'");
    stamp = index.collected_at;
    if (start === null || end === null) throw new Error("window");
    window = [start, end];
  } catch (err) {
    console.log(`cannot use the index ${indexPath}: ${(err as Error).message}`);
    return 2;
  }
  let data: unknown;
  try {
    data = JSON.parse(readText(path));
  } catch (err) {
    console.log(`cannot read ${path}: ${(err as Error).message}`);
    return 2;
  }
  const bad = problemsIn(data, group, stamp, window);
  for (const line of bad.slice(0, MAX_PROBLEMS)) console.log(line);
  if (bad.length > MAX_PROBLEMS) console.log(`... and ${bad.length - MAX_PROBLEMS} more`);
  return bad.length ? 2 : 0;
}
