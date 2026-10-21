// CLI entry for scripts/merge.py. Owned by the task that owns src/merge.ts.
import { main } from "../merge.ts";

process.exit(await main(process.argv.slice(2)));
