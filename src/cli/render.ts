// CLI entry for scripts/render.py.
import { main } from "../render.ts";

process.exitCode = await main(process.argv.slice(2));
