import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Awaiting cache invalidations one after another costs one HTTP round-trip each, because the
 * refetch each one triggers only starts once the previous has landed. Fired together they leave
 * in the same tick and the tRPC httpBatchLink folds them into a single request, so a three-call
 * handler goes from three round-trips to one. This walks the client source and fails on any run
 * of awaited cache calls that should have been a single `await Promise.all([...])`.
 *
 * `cancel()` is deliberately not one of the verbs: it issues no request, and it is usually
 * followed by an invalidate or setData on the same key that must not race it. A pair that is
 * genuinely ordered can opt out with a `serial-invalidation-ok` comment saying why.
 */
const REPO_ROOT = join(import.meta.dirname, "../../..");
const SOURCE_ROOT = join(REPO_ROOT, "app/src");

/** Any receiver, since `api.useUtils()` is stored as both `utils` and `util` across the app. */
const CACHE_CALL =
  /^\s*await\s+[\w$]+(?:\.[\w$]+)+\.(?:invalidate|refetch|prefetch|reset|fetch|ensureData)\(/;
const IGNORABLE = /^\s*(\/\/|\/\*|\*|$)/;
const OPT_OUT = "serial-invalidation-ok";

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

/** Line indices where a cache call starts, skipping over calls whose arguments wrap. */
const cacheCalls = (lines: string[]) => {
  const starts: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!CACHE_CALL.test(lines[i] ?? "")) continue;
    let depth = 0;
    let end = i;
    for (; end < lines.length; end++) {
      const line = lines[end] ?? "";
      depth += (line.match(/\(/g)?.length ?? 0) - (line.match(/\)/g)?.length ?? 0);
      if (depth <= 0) break;
    }
    starts.push(i);
    ends.push(end);
    i = end;
  }
  return { starts, ends };
};

const serialRuns = (path: string) => {
  const lines = readFileSync(path, "utf8").split("\n");
  const { starts, ends } = cacheCalls(lines);
  const runs: string[] = [];
  let runStart = 0;
  for (let call = 1; call <= starts.length; call++) {
    // A blank line or a comment between two awaits does not make them any less serial
    const continues =
      call < starts.length &&
      lines
        .slice((ends[call - 1] ?? 0) + 1, starts[call])
        .every((line) => IGNORABLE.test(line));
    if (continues) continue;
    const first = starts[runStart] ?? 0;
    const last = ends[call - 1] ?? first;
    const excused = lines
      .slice(Math.max(first - 1, 0), last + 1)
      .some((line) => line.includes(OPT_OUT));
    if (call - runStart >= 2 && !excused) {
      runs.push(
        `${relative(REPO_ROOT, path)}:${first + 1} (${call - runStart} awaits in a row)`,
      );
    }
    runStart = call;
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
