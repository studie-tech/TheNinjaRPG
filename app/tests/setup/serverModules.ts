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
import * as actualProfile from "@/routers/profile";

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
};
