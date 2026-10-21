"""One line per source from a collected folder's index.json: name, ok, status, counts, error."""

import json
import sys

index = json.load(open(sys.argv[1]))
print("window", index["window"]["start"], index["window"]["end"])
for row in index["sources"]:
    print("%-24s %-5s %-4s items=%-3s details=%-3s chars=%-6s %s" % (
        row["name"], row["ok"], row.get("status"), row.get("items"), row.get("details"),
        row.get("chars"), row.get("error") or ""))
