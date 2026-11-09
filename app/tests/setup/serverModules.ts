/**
 * Registered via bunfig.toml, ahead of every suite.
 *
 * bun keeps one module registry for the whole run, so a `vi.mock` in any file replaces that
 * module for every other file too. A suite stubbing `@/routers/profile` to run without a
 * database would hand every other suite a `fetchUser` returning undefined -- fatal for anything
 * driving a real tRPC router, because the first guard then rejects.
 *
 * The stub lives here instead: registered once, and delegating to the real implementation
 * until a suite asks for something else. Suites opt in with `stubProfile` and hand the module
 * back with `resetServerModuleStubs`, so nothing leaks to the suites that never asked.
 */
import { vi } from "bun:test";
import * as actualNextServer from "next/server";
import * as actualProfileQueries from "@/queries/profile";
import * as actualSparringQueries from "@/queries/sparring";
import * as actualProfile from "@/routers/profile";
import * as actualSparring from "@/routers/sparring";
import * as actualDb from "@/server/db";
import * as actualCron from "@/server/utils/cron";
import { afterTasks } from "./after";
import { peekTestDatabase, withEmptyIsolationHistory } from "./testDatabase";

type AnyFn = (...args: never[]) => unknown;

const stubs = new Map<string, AnyFn>();
const actualAfter = actualNextServer.after;

// Next owns after() in HTTP requests. Direct test callers provide an isolated task queue.
vi.mock("next/server", () => ({
  ...actualNextServer,
  after: (task: Parameters<typeof actualNextServer.after>[0]) => {
    const tasks = afterTasks.getStore();
    if (!tasks) return actualAfter(task);
    tasks.push(() => (typeof task === "function" ? task() : task));
  },
}));

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
vi.mock("@/routers/sparring", () => delegating(actualSparring));
vi.mock("@/queries/profile", () => delegating(actualProfileQueries));
vi.mock("@/queries/sparring", () => delegating(actualSparringQueries));

/** Cron authentication stays real until a suite answers it with `stubCronAuth`. */
vi.mock("@/server/utils/cron", () => delegating(actualCron));

/**
 * `drizzleDB` is a module-level singleton, so suites that exercise cron routes cannot inject a
 * client, and replacing the module would replace it for every suite. Reads resolve, in order: whatever the current suite passed to `stubDatabase`, the throwaway database once it is
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
  databaseStub = withEmptyIsolationHistory(stub);
};

/** Override a profile workflow or query export for the current suite. */
export const stubProfile = (
  name: (keyof typeof actualProfile | keyof typeof actualProfileQueries) & string,
  implementation: AnyFn,
) => {
  stubs.set(name, implementation);
};

/** Override a sparring workflow or query export for the current suite. */
export const stubSparring = (
  name: (keyof typeof actualSparring | keyof typeof actualSparringQueries) & string,
  implementation: AnyFn,
) => {
  stubs.set(name, implementation);
};

/** Answer cron authentication with `implementation` for the current suite. */
export const stubCronAuth = (
  implementation: typeof actualCron.authenticateCronRequest,
) => {
  stubs.set("authenticateCronRequest", implementation);
};

/** Hand every stubbed export back to its real implementation. */
export const resetServerModuleStubs = () => {
  stubs.clear();
  databaseStub = null;
};
