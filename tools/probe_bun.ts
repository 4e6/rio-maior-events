// One GET per source URL with Bun's fetch, one host at a time, to see whether
// a site answers Bun's client from here. Prints status per source; no bodies kept.
const config = await Bun.file(new URL("../sources.json", import.meta.url)).json();
const UA = process.argv[2] ?? "rio-maior-events probe";
for (const source of config.sources) {
  let line: string;
  try {
    const response = await fetch(source.url, {
      headers: { "User-Agent": UA, "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.5" },
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
    await response.arrayBuffer();
    line = `${response.status}`;
  } catch (error) {
    line = `error ${(error as Error).name}: ${(error as Error).message}`;
  }
  console.log(`${source.name.padEnd(24)} ${line}`);
  await Bun.sleep(1500);
}
