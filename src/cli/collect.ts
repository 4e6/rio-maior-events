// CLI entry for scripts/collect.py. Owned by the task that owns src/collect.ts.
import { main } from "../collect.ts";

process.exit(await main(process.argv.slice(2)));
