// One line per source from a collected folder's index.json: name, ok, status, counts, error.
//   bun tools/probe_summary.ts COLLECTED/index.json
const index = await Bun.file(process.argv[2] ?? "index.json").json();
console.log("window", index.window.start, index.window.end);
for (const row of index.sources) {
  console.log(
    `${String(row.name).padEnd(24)} ${String(row.ok).padEnd(5)} ${String(row.status ?? "").padEnd(4)} ` +
      `items=${String(row.items ?? "").padEnd(3)} details=${String(row.details ?? "").padEnd(3)} ` +
      `chars=${String(row.chars ?? "").padEnd(6)} ${row.error ?? ""}`,
  );
}

export {};
