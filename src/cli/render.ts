// CLI entry: bun src/cli/render.ts (see the usage line).
import { main } from "../render.ts";

process.exitCode = await main(process.argv.slice(2));
