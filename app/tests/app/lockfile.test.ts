import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `package.json` pins bun via `packageManager`, but nothing enforces it, and an older bun does
 * not refuse to work here — it silently rewrites `bun.lock` in the format it does understand.
 * That rewrite is not a formatting difference: it re-resolves every floating version and drops
 * the nested `overrides` that older versions cannot express, so a lockfile that arrives this way
 * quietly moves transitive dependencies for everyone. It is easy to sweep into a commit by
 * accident and nearly invisible in review, hence a test rather than a convention.
 */
const APP_ROOT = join(import.meta.dirname, "../..");

const readLockfile = () => readFileSync(join(APP_ROOT, "bun.lock"), "utf8");

/** bun.lock is JSONC — trailing commas make JSON.parse useless, so read the one field directly. */
const lockfileVersion = (source: string) => {
  const match = source.match(/"lockfileVersion"\s*:\s*(\d+)/);
  return match?.[1] === undefined ? undefined : Number(match[1]);
};

const packageManager = () => {
  const manifest = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8")) as {
    packageManager?: string;
  };
  return manifest.packageManager;
};

describe("bun.lock", () => {
  it("has not been downgraded by an older bun", () => {
    expect(
      lockfileVersion(readLockfile()),
      "bun.lock was written by a bun older than the one package.json pins. Install the pinned " +
        "version and re-run `bun install`, or restore the file with `git checkout -- app/bun.lock`.",
    ).toBeGreaterThanOrEqual(3);
  });

  it("still carries the nested overrides an older bun would have dropped", () => {
    // Scoped to the overrides block on purpose: both names also appear in the packages list, so
    // searching the whole file passes even on a lockfile that has lost them
    const source = readLockfile();
    const overrides = source.match(/"overrides":\s*\{([\s\S]*?)\n {2}\},/)?.[1] ?? "";
    expect(overrides).toContain("@types/cytoscape-edgehandles");
    expect(overrides).toContain("@types/react-cytoscapejs");
  });

  it("pins a package manager for everyone to match", () => {
    expect(packageManager()).toMatch(/^bun@\d+\.\d+\.\d+$/);
  });
});
