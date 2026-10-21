// CLI entry for scripts/render.py. Owned by the task that owns src/render.ts.
import { main } from "../render.ts";

process.exit(await main(process.argv.slice(2)));
