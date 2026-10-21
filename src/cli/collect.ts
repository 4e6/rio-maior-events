// CLI entry: bun src/cli/collect.ts OUT [--from DATE] [--to DATE] [--only NAME ...]
import { main } from "../collect.ts";

process.exit(await main(process.argv.slice(2)));
