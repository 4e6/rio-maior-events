// Helpers for the adapter tests. Page fixtures live in test/fixtures/pages.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "..");
export const FIXTURES = join(ROOT, "test", "fixtures", "pages");

/** helpers.WINDOW */
export const WINDOW = ["2026-10-20", "2026-12-01"] as const;

/** helpers.fixture(name): the bytes of a fixture file. */
export function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

/** Fixture decoded as UTF-8 (tests that call .decode("utf-8") on it). */
export function fixtureText(name: string): string {
  return new TextDecoder().decode(fixture(name));
}
