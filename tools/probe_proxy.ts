// One GET per source URL of the sites that refuse GitHub's runners, through the fallback proxy (FALLBACK_PROXY_URL),
// one host at a time. Prints the site's name and a status only, scrubbed of the proxy's details; skipped without the
// variable. Never prints the URL, a body or a header.
import { writeFileSync } from "node:fs";
import { ProxyGateway } from "../src/net.ts";

const SITES = ["cm-santarem", "cm-torresnovas", "cm-alcanena", "cm-entroncamento", "cm-vnbarquinha"];

let gateway: ProxyGateway | null = null;
try {
  gateway = ProxyGateway.fromEnv(process.env);
} catch (error) {
  console.log(`FALLBACK_PROXY_URL ignored: ${(error as Error).message}`);
}
if (process.env.GITHUB_ACTIONS === "true" && gateway) for (const v of gateway.maskValues()) console.error(`::add-mask::${v}`); // stderr only: never in a file or a tee
if (!gateway) {
  console.log("FALLBACK_PROXY_URL is not set; nothing to check");
  writeFileSync(process.argv[2] ?? "proxy.txt", "FALLBACK_PROXY_URL is not set; nothing to check\n");
  process.exit(0);
}

// The statuses go to a file of our own (argv[2], default proxy.txt) with known content, and to the log.
const lines: string[] = [];
const say = (line: string) => { lines.push(line); console.log(line); };
const config = await Bun.file(new URL("../sources.json", import.meta.url)).json();
for (const source of config.sources.filter((s: { name: string }) => SITES.includes(s.name))) {
  let line: string;
  try {
    const result = await gateway.fetch(source.url, null);
    line = `${result.status}`;
  } catch (error) {
    const e = error as { name?: string; message?: string; code?: number };
    line = `error ${gateway.scrub(`${e.name ?? "Error"}: ${e.message ?? String(error)}`)}`;
  }
  say(`${source.name.padEnd(24)} ${line}`);
  await Bun.sleep(1500);
}
const used = gateway.stats();
say(`about ${(used.bytes / 1048576).toFixed(2)} MB through the proxy${used.dead ? `; ${used.dead}` : ""}`);
writeFileSync(process.argv[2] ?? "proxy.txt", lines.join("\n") + "\n");
