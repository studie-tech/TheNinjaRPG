/**
 * Registered via bunfig.toml, ahead of every suite.
 *
 * bun keeps one module registry for the whole run, so a `vi.mock` in any file replaces that
 * module for every other file too. When a suite stubbed `@/routers/profile` so it could run
 * without a database, every other suite silently inherited a `fetchUser` returning undefined
 * -- fatal for anything driving a real tRPC router, because the first guard then rejects.
 *
 * The stub lives here instead: registered once, and delegating to the real implementation
 * until a suite asks for something else. Suites opt in with `stubProfile` and hand the module
 * back with `resetServerModuleStubs`, so nothing leaks to the suites that never asked.
 */
import { vi } from "vitest";
import * as actualDb from "@/server/db";
import * as actualProfile from "@/routers/profile";
import { peekTestDatabase } from "./testDatabase";

type AnyFn = (...args: never[]) => unknown;

const stubs = new Map<string, AnyFn>();

/** Wraps every exported function so a stub can be swapped in per suite; data exports pass through. */
const delegating = <T extends object>(actual: T) =>
  Object.fromEntries(
    Object.entries(actual).map(([key, value]) => [
      key,
      typeof value === "function"
        ? (...args: never[]) => (stubs.get(key) ?? (value as AnyFn))(...args)
        : value,
    ]),
  );

vi.mock("@/routers/profile", () => delegating(actualProfile));

/**
 * `drizzleDB` is a module-level singleton, so suites that exercise cron routes cannot inject a
 * client and used to replace the whole module -- globally, for everyone. Reads now resolve, in
 * order: whatever the current suite passed to `stubDatabase`, the throwaway database once it is
 * connected, and only then the real export. A suite that never opts in therefore talks to the
 * test database rather than the developer's own, and a suite that does opt in keeps its stub to
 * itself.
 */
let databaseStub: object | null = null;

const databaseProxy = new Proxy(
  {},
  {
    get(_target, property) {
      const source =
        databaseStub ?? peekTestDatabase() ?? (actualDb.drizzleDB as unknown as object);
      return (source as Record<string | symbol, unknown>)[property];
    },
  },
);

vi.mock("@/server/db", () => ({ ...actualDb, drizzleDB: databaseProxy }));

/** Route `drizzleDB` to `stub` for the current suite. */
export const stubDatabase = (stub: object) => {
  databaseStub = stub;
};

/** Route one `@/routers/profile` export to `implementation` for the current suite. */
export const stubProfile = (
  name: keyof typeof actualProfile & string,
  implementation: AnyFn,
) => {
  stubs.set(name, implementation);
};

/** Hand every stubbed export back to its real implementation. */
export const resetServerModuleStubs = () => {
  stubs.clear();
  databaseStub = null;
};
