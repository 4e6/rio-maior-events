// CLI entry for scripts/check_candidates.py.
import { main } from "../check_candidates.ts";

process.exitCode = await main(process.argv.slice(2));
