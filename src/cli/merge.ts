// CLI entry: bun src/cli/merge.ts (see the usage line).
import { main } from "../merge.ts";

process.exitCode = await main(process.argv.slice(2));
