// One GET per source URL of the sites that refuse GitHub's runners, through the fallback proxy (FALLBACK_PROXY_URL),
// one host at a time. Prints the site's name and a status only, scrubbed of the proxy's details; skipped without the
// variable. Never prints the URL, a body or a header.
import { ProxyGateway } from "../src/net.ts";

const SITES = ["cm-santarem", "cm-torresnovas", "cm-alcanena", "cm-entroncamento", "cm-vnbarquinha"];

let gateway: ProxyGateway | null = null;
try {
  gateway = ProxyGateway.fromEnv(process.env);
} catch (error) {
  console.log(`FALLBACK_PROXY_URL ignored: ${(error as Error).message}`);
}
if (process.env.GITHUB_ACTIONS === "true" && gateway) for (const v of gateway.maskValues) console.log(`::add-mask::${v}`);
if (!gateway) {
  console.log("FALLBACK_PROXY_URL is not set; nothing to check");
  process.exit(0);
}

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
  console.log(`${source.name.padEnd(24)} ${line}`);
  await Bun.sleep(1500);
}
const used = gateway.stats();
console.log(`about ${(used.bytes / 1048576).toFixed(2)} MB through the proxy${used.dead ? `; ${used.dead}` : ""}`);
