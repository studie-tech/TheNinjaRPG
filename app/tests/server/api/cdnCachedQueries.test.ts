import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { CDN_CACHED_QUERY_PATHS } from "@/api/root";

/**
 * A query built with cdnCachedProcedure is answered by the CDN for up to a minute, so a
 * client that invalidates or refetches it after an action would be served the copy from
 * before the action. This walks the client source for cache calls on those queries; a
 * query that needs one belongs on the session endpoint instead.
 */
const SOURCE_ROOT = join(import.meta.dirname, "../../../src");
const CACHE_VERBS = ["invalidate", "refetch", "reset", "setData", "fetch", "ensureData"];

/** Every regex metacharacter, so a router path is matched literally. */
const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

describe("CDN-cached queries", () => {
  it("are derived from the router, so the client list cannot drift from it", () => {
    expect(CDN_CACHED_QUERY_PATHS).toContain("profile.getStrongestUsers");
    expect(CDN_CACHED_QUERY_PATHS).not.toContain("profile.getUser");
    expect(CDN_CACHED_QUERY_PATHS).not.toContain("profile.getPublicUsers");
  });

  it("are never invalidated or refetched by client code", () => {
    // A cache call naming the query, one naming its router, a `refetch` destructured
    // from its useQuery result, or an invalidation by its query key. A blanket
    // `utils.invalidate()` is not matched: it is the retry in [shell]/error.tsx, where
    // refetching a shared copy up to a minute old is the intended outcome.
    const patterns = CDN_CACHED_QUERY_PATHS.map((path) => {
      const escaped = escapeForRegExp(path);
      const router = escapeForRegExp(path.split(".")[0] ?? path);
      const verbs = CACHE_VERBS.join("|");
      return new RegExp(
        `\\b${escaped}\\.(?:${verbs})\\(|` +
          `\\butils?\\.${router}\\.(?:${verbs})\\(|` +
          `\\brefetch\\b[^=;]*=\\s*api\\.${escaped}\\.useQuery\\(|` +
          `getQueryKey\\(\\s*api\\.${escaped}`,
      );
    });
    const offenders = sourceFiles(SOURCE_ROOT).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return patterns.some((pattern) => pattern.test(source))
        ? [relative(SOURCE_ROOT, file)]
        : [];
    });
    expect(offenders).toEqual([]);
  });
});
