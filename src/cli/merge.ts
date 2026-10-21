// CLI entry for scripts/merge.py.
import { main } from "../merge.ts";

process.exitCode = await main(process.argv.slice(2));
