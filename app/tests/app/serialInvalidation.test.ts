import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Awaiting cache invalidations one after another costs one HTTP round-trip each, because the
 * refetch each one triggers only starts once the previous has landed. Fired together they leave
 * in the same tick and the tRPC httpBatchLink folds them into a single request, so a three-call
 * handler goes from three round-trips to one. This walks the client source and fails on any run
 * of consecutive awaited cache calls that should have been a single `await Promise.all([...])`.
 */
const SOURCE_ROOT = join(import.meta.dirname, "../../src");

const CACHE_CALL =
  /^\s*await\s+utils\.[\w.]+\.(?:invalidate|refetch|cancel|reset|prefetch)\(/;

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

const serialRuns = (path: string) => {
  const lines = readFileSync(path, "utf8").split("\n");
  const runs: string[] = [];
  let start = 0;
  for (let i = 0; i <= lines.length; i++) {
    if (i < lines.length && CACHE_CALL.test(lines[i] ?? "")) {
      if (!CACHE_CALL.test(lines[i - 1] ?? "")) start = i;
      continue;
    }
    if (i - start >= 2 && CACHE_CALL.test(lines[i - 1] ?? "")) {
      const relative = path.slice(SOURCE_ROOT.length + 1);
      runs.push(`${relative}:${start + 1} (${i - start} awaits in a row)`);
    }
  }
  return runs;
};

describe("client cache invalidation", () => {
  it("never awaits invalidations one at a time", () => {
    const offenders = sourceFiles(SOURCE_ROOT).flatMap(serialRuns);
    expect(
      offenders,
      `Batch these into one await Promise.all([...]) so the refetches share a request:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
