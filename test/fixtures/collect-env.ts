// Writes the fixture collected folder and records which environment variables it was started with.
import { cpSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

cpSync(join(import.meta.dir, "collected"), process.argv[2]!, { recursive: true });
writeFileSync(join(dirname(process.argv[2]!), "collect-env.json"), JSON.stringify(Object.keys(process.env)));
