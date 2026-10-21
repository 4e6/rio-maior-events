// CLI entry for scripts/collect.py: bun src/cli/collect.ts OUT [--from DATE] [--to DATE] [--only NAME ...]
import { main } from "../collect.ts";

process.exit(await main(process.argv.slice(2)));
