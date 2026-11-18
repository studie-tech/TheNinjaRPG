import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * A loading boundary streams its fallback before the segments beneath it render, so a
 * notFound() below it can no longer set the response status: the route would answer 200
 * with a not-found body, a soft 404 for crawlers. Boundaries therefore sit only in route
 * folders whose whole subtree has no not-found handling, and never at the shell level.
 */
const SHELL_ROOT = join(import.meta.dirname, "../../src/app/[shell]");
const NOT_FOUND_CALL = /\bnotFound\(/;

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );

const files = walk(SHELL_ROOT);
const loadingDirs = files
  .filter((file) => file.endsWith("/loading.tsx"))
  .map((file) => dirname(file));

describe("route loading boundaries", () => {
  it("never wrap a route that can answer 404", () => {
    const offenders = loadingDirs.flatMap((dir) =>
      files
        .filter((file) => file.startsWith(`${dir}/`))
        .filter(
          (file) =>
            file.endsWith("/not-found.tsx") ||
            (/\.tsx?$/.test(file) && NOT_FOUND_CALL.test(readFileSync(file, "utf8"))),
        )
        .map((file) => relative(SHELL_ROOT, file)),
    );
    expect(offenders).toEqual([]);
  });

  it("give the server-rendered board and guide pages an instant shell", () => {
    expect(loadingDirs.map((dir) => relative(SHELL_ROOT, dir))).toEqual(
      expect.arrayContaining([
        "globalanbuhq",
        "guide/(hub)",
        "historybuilding",
        "news",
      ]),
    );
  });
});
