// CLI entry: bun src/cli/check_candidates.ts (see the usage line).
import { main } from "../check_candidates.ts";

process.exitCode = await main(process.argv.slice(2));
