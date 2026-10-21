// A small stand-in for the argparse use of merge.py, render.py and check_candidates.py: positionals, boolean flags
// and flags taking one value (`--name value` or `--name=value`, unique prefixes allowed). On a mistake it prints
// argparse's usage and error lines to stderr and returns null (the caller exits 2); `-h` prints the usage, exit 0.

export interface ArgSpec {
  prog: string;
  usage: string;
  /** Positional names; `optional` ones may be left out. */
  positionals: { name: string; optional?: boolean }[];
  /** Boolean flags, e.g. "--missing-ok". */
  flags?: string[];
  /** Flags that take a value, e.g. "--index". */
  values?: { name: string; required?: boolean }[];
}

export interface Parsed {
  help: boolean;
  positionals: (string | undefined)[];
  flags: Set<string>;
  values: Map<string, string>;
}

export function parseArgs(spec: ArgSpec, argv: string[]): Parsed | null {
  const flags = spec.flags ?? [];
  const values = spec.values ?? [];
  const fail = (msg: string): null => {
    console.error(spec.usage);
    console.error(`${spec.prog}: error: ${msg}`);
    return null;
  };
  const known = ["--help", ...flags, ...values.map((v) => v.name)];
  const out: Parsed = { help: false, positionals: [], flags: new Set(), values: new Map() };
  const rest: string[] = [];
  const extra: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") { rest.push(...argv.slice(i + 1)); break; }
    if (arg === "-h") { out.help = true; continue; }
    if (!arg.startsWith("-") || arg === "-" || /^-\d+$|^-\d*\.\d+$/.test(arg)) { rest.push(arg); continue; }
    if (!arg.startsWith("--")) { extra.push(arg); continue; }
    const eq = arg.indexOf("=");
    const given = eq === -1 ? arg : arg.slice(0, eq);
    const matches = known.includes(given) ? [given] : known.filter((k) => k.startsWith(given));
    if (matches.length > 1) return fail(`ambiguous option: ${given} could match ${matches.join(", ")}`);
    if (matches.length === 0) { extra.push(arg); continue; }
    const name = matches[0]!;
    if (name === "--help") { out.help = true; continue; }
    if (flags.includes(name)) {
      if (eq !== -1) return fail(`argument ${name}: ignored explicit argument '${arg.slice(eq + 1)}'`);
      out.flags.add(name);
      continue;
    }
    if (eq !== -1) { out.values.set(name, arg.slice(eq + 1)); continue; }
    const next = argv[i + 1];
    if (next === undefined || (next.startsWith("-") && !/^-\d+$|^-\d*\.\d+$/.test(next) && next !== "-")) {
      return fail(`argument ${name}: expected one argument`);
    }
    out.values.set(name, next);
    i++;
  }
  if (out.help) { console.log(spec.usage); return out; }
  // positionals are filled in order; a required one that has no argument is reported by name
  const missing: string[] = [];
  spec.positionals.forEach((p, i) => { if (!p.optional && rest[i] === undefined) missing.push(p.name); });
  for (const v of values) if (v.required && !out.values.has(v.name)) missing.push(v.name);
  if (missing.length) return fail(`the following arguments are required: ${missing.join(", ")}`);
  if (rest.length > spec.positionals.length) extra.push(...rest.slice(spec.positionals.length));
  if (extra.length) return fail(`unrecognized arguments: ${extra.join(" ")}`);
  out.positionals = spec.positionals.map((_, i) => rest[i]);
  return out;
}
