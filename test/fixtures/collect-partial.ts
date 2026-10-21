// Writes the fixture collected folder, then exits non-zero as the collector does for some failures.
import { cpSync } from "node:fs";
import { join } from "node:path";

cpSync(join(import.meta.dir, "collected"), process.argv[2]!, { recursive: true });
process.exit(3);
