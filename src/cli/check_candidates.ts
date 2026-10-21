// CLI entry for scripts/check_candidates.py. Owned by the task that owns src/check_candidates.ts.
import { main } from "../check_candidates.ts";

process.exit(await main(process.argv.slice(2)));
