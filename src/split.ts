// Optional split of the reading groups into smaller pieces (READ_SPLIT_CHARS).
// Writes <work>/rio-maior-split/: index.json (collected_at, window, and the pieces) and one file per piece,
// shaped like a group file (`group` is the piece's id), so a reader, check_candidates and merge treat it as a unit.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Doc = Record<string, any>;

export type Piece = { id: string; group: string; file: string; sources: string[]; chars: number };

/** The size of a source as it sits in the group file. */
const sizeOf = (source: Doc): number => JSON.stringify(source, null, 1).length;

/**
 * Cut the sources of one group (in file order) into pieces of at most `limit` characters.
 * A source is never split; sources of one town stay together when they fit; greedy; a source over the limit
 * is a piece of its own.
 */
export function cutSources(sources: Doc[], limit: number): Doc[][] {
  const clusters: Doc[][] = [];
  const byTown = new Map<string, Doc[]>();
  for (const s of sources) {
    const town = typeof s.town === "string" && s.town ? s.town : `\0${s.name}`;
    let cluster = byTown.get(town);
    if (!cluster) { cluster = []; byTown.set(town, cluster); clusters.push(cluster); }
    cluster.push(s);
  }
  const pieces: Doc[][] = [];
  let current: Doc[] = [];
  let used = 0;
  const flush = () => { if (current.length) pieces.push(current); current = []; used = 0; };
  const add = (s: Doc) => {
    const size = sizeOf(s);
    if (used + size > limit) flush();
    current.push(s);
    used += size;
  };
  for (const cluster of clusters) {
    const total = cluster.reduce((n, s) => n + sizeOf(s), 0);
    if (used + total <= limit) { for (const s of cluster) add(s); continue; }
    flush();
    for (const s of cluster) add(s); // a cluster over the limit is cut at source boundaries
  }
  flush();
  // A piece of failed sources only would have no reader and fail its group: attach it to a neighbour
  // (the previous piece, else the next); failed sources are tiny, so the limit hardly matters.
  const failedOnly = (piece: Doc[]) => piece.every((s) => s.ok !== true);
  while (pieces.some((p) => !failedOnly(p))) {
    const n = pieces.findIndex(failedOnly);
    if (n === -1) break;
    const [moved] = pieces.splice(n, 1);
    if (n > 0) pieces[n - 1]!.push(...moved!); else pieces[0]!.unshift(...moved!);
  }
  return pieces;
}

/** Write the split of a collected folder; returns the pieces in group order. */
export function splitCollected(collected: string, splitDir: string, limit: number): Piece[] {
  rmSync(splitDir, { recursive: true, force: true });
  mkdirSync(splitDir, { recursive: true });
  const index: Doc = JSON.parse(readFileSync(join(collected, "index.json"), "utf8"));
  const pieces: Piece[] = [];
  for (const [group, info] of Object.entries<Doc>(index.groups)) {
    let data: Doc;
    try {
      data = JSON.parse(readFileSync(join(collected, info.file ?? `${group}.json`), "utf8"));
      if (data === null || typeof data !== "object") throw new Error("not an object");
    } catch (error) {
      console.error(`group ${group}: cannot split its file (${(error as Error).message}); it counts as not read`);
      continue; // no pieces: the group fails alone
    }
    const cut = cutSources(Array.isArray(data.sources) ? data.sources : [], limit);
    cut.forEach((sources, n) => {
      const id = cut.length === 1 ? group : `${group}-${n + 1}`;
      const file = `${id}.json`;
      const body = { ...data, group: id, sources };
      writeFileSync(join(splitDir, file), JSON.stringify(body, null, 1) + "\n", "utf8");
      pieces.push({ id, group, file, sources: sources.map((s) => s.name), chars: sources.reduce((n, s) => n + sizeOf(s), 0) });
    });
  }
  writeFileSync(
    join(splitDir, "index.json"),
    JSON.stringify({ collected_at: index.collected_at, window: index.window, limit, pieces }, null, 1) + "\n",
    "utf8",
  );
  return pieces;
}

/** The pieces of a split folder, or null when it has none. */
export function readSplit(splitDir: string): Piece[] | null {
  try {
    const index = JSON.parse(readFileSync(join(splitDir, "index.json"), "utf8"));
    return Array.isArray(index.pieces) ? index.pieces : null;
  } catch {
    return null;
  }
}
