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

const manifest = () =>
  JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8")) as {
    packageManager?: string;
    overrides?: Record<string, unknown>;
  };

/**
 * The object-valued overrides, which are the ones an older bun cannot express and silently drops
 * ("Bun currently does not support nested overrides"). Read from package.json rather than listed
 * here, so an override added later is covered without anyone remembering to update this. The
 * string-valued ones are deliberately not checked: they survive the downgrade, so they would
 * report nothing about it.
 */
const nestedOverrideNames = () =>
  Object.entries(manifest().overrides ?? {})
    .filter(([, value]) => typeof value === "object" && value !== null)
    .map(([name]) => name);

describe("bun.lock", () => {
  it("has not been downgraded by an older bun", () => {
    expect(
      lockfileVersion(readLockfile()),
      "bun.lock was written by a bun older than the one package.json pins. Install the pinned " +
        "version and re-run `bun install`, or restore the file with `git checkout -- app/bun.lock`.",
    ).toBeGreaterThanOrEqual(3);
  });

  it("still carries the nested overrides an older bun would have dropped", () => {
    // Scoped to the overrides block on purpose: the names also appear in the packages list, so
    // searching the whole file passes even on a lockfile that has lost them
    const overrides = readLockfile().match(/"overrides":\s*\{([\s\S]*?)\n {2}\},/)?.[1] ?? "";
    const nested = nestedOverrideNames();
    // Without one of these the assertion below is vacuous and the canary watches nothing
    expect(nested.length).toBeGreaterThan(0);
    for (const name of nested) expect(overrides).toContain(name);
  });

  it("pins a package manager for everyone to match", () => {
    expect(manifest().packageManager).toMatch(/^bun@\d+\.\d+\.\d+$/);
  });
});
