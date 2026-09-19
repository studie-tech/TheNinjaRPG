// @vitest-environment node

import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { actionLog, userData } from "@/drizzle/schema";
import { profileRouter } from "@/routers/profile";
import { insertUsers } from "../../setup/factories";
import type { DrizzleClient } from "@/server/db";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const caller = (userId: string) => callerFor(profileRouter, userId);

const createUser = async (patch: Record<string, unknown> = {}) => {
  await insertUsers([
    {
      userId: "color-user",
      username: "ColorUser",
      reputationPoints: 30,
      ...patch,
    } as never,
  ]);
};

/**
 * Runs `race` while a locking read holds the user's row, releasing it only once every
 * caller has issued its UPDATE. Each caller issues that UPDATE after its own read, so by
 * the time all of them have, every read is complete and none of the writes has landed:
 * the writes then apply one after another, and every one after the first sees a row that
 * no longer matches what it read. That is the exact ordering a compare-and-swap exists to
 * survive, and the one Promise.all alone does not guarantee -- on CI the first mutation
 * regularly finished before the second had read, which made the second a legitimate
 * follow-on purchase rather than a stale one.
 *
 * The moment of issue is observed on the client handed to `race`, by wrapping the
 * builder `update()` returns so its `then` -- drizzle sends the statement when the
 * builder is awaited -- counts down before delegating. That is a signal from inside the
 * process, so it needs no polling and no information_schema privilege, and a slow
 * database only changes how long the test takes. fetchUser is a plain SELECT, a
 * consistent read under REPEATABLE READ, so the lock never blocks it.
 *
 * This is test scaffolding around a row that exists. It is not a pattern for production
 * code, where a locking read is how this codebase has deadlocked before.
 */
const withRowHeld = async <T>(
  userId: string,
  writers: number,
  race: (database: DrizzleClient) => Promise<T>,
): Promise<T> => {
  const database = await getTestDatabase();
  let remaining = writers;
  let allIssued!: () => void;
  const issued = new Promise<void>((resolve) => {
    allIssued = resolve;
  });
  const observing = new Proxy(database, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "update" || typeof value !== "function") return value;
      return (...args: unknown[]) =>
        countingBuilder(value.apply(target, args) as object, () => {
          if (--remaining === 0) allIssued();
        });
    },
  }) as DrizzleClient;

  let lockAcquired!: () => void;
  const locked = new Promise<void>((resolve) => {
    lockAcquired = resolve;
  });
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holder = database.transaction(async (tx) => {
    await tx
      .select({ userId: userData.userId })
      .from(userData)
      .where(eq(userData.userId, userId))
      .for("update");
    lockAcquired();
    await released;
  });
  await locked;
  const pending = race(observing);
  await issued;
  release();
  await holder;
  return await pending;
};

/** Mirrors the chaining wrapper in setup/testDatabase, adding a hook on `then`. */
const countingBuilder = <T extends object>(builder: T, onIssue: () => void): T =>
  new Proxy(builder, {
    get(target, property, receiver) {
      if (property === "then") {
        return (onFulfilled?: (value: unknown) => unknown, onRejected?: () => unknown) => {
          onIssue();
          return Promise.resolve(target as PromiseLike<unknown>).then(onFulfilled, onRejected);
        };
      }
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const next = (value as (...a: unknown[]) => unknown).apply(target, args);
        return next && typeof next === "object" ? countingBuilder(next as object, onIssue) : next;
      };
    },
  });

const readUser = async () => {
  const database = await getTestDatabase();
  const [user] = await database
    .select()
    .from(userData)
    .where(eq(userData.userId, "color-user"));
  return user;
};

describeWithDatabase("profile tavern color purchases", () => {
  beforeEach(async () => {
    await resetTables(actionLog, userData);
  });

  it("charges username and title as independent 10-reputation purchases", async () => {
    await createUser();
    const api = await caller("color-user");
    expect((await api.updateTavernColor({ target: "username", color: "NAVY" })).success).toBe(true);
    expect((await api.updateTavernColor({ target: "title", color: "COBALT" })).success).toBe(true);

    const user = await readUser();
    expect(user?.tavernUsernameColor).toBe("NAVY");
    expect(user?.tavernTitleColor).toBe("COBALT");
    expect(user?.reputationPoints).toBe(10);
  });

  it("charges 10 reputation when returning to DEFAULT", async () => {
    await createUser({ reputationPoints: 10, tavernUsernameColor: "NAVY" });
    const result = await (await caller("color-user")).updateTavernColor({
      target: "username",
      color: "DEFAULT",
    });
    expect(result.success).toBe(true);
    const user = await readUser();
    expect(user?.tavernUsernameColor).toBe("DEFAULT");
    expect(user?.reputationPoints).toBe(0);
  });

  it("rejects returning to DEFAULT without enough reputation", async () => {
    await createUser({ reputationPoints: 9, tavernUsernameColor: "NAVY" });
    const result = await (await caller("color-user")).updateTavernColor({
      target: "username",
      color: "DEFAULT",
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not enough/i);
    expect((await readUser())?.tavernUsernameColor).toBe("NAVY");
  });

  it("rejects insufficient reputation without changing the setting", async () => {
    await createUser({ reputationPoints: 9 });
    const result = await (await caller("color-user")).updateTavernColor({
      target: "title",
      color: "GOLD",
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not enough/i);
    expect((await readUser())?.tavernTitleColor).toBe("DEFAULT");
  });

  it("rejects unchanged selections", async () => {
    await createUser();
    const result = await (await caller("color-user")).updateTavernColor({
      target: "username",
      color: "DEFAULT",
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/unchanged/i);
  });

  it("rejects banned users", async () => {
    await createUser({ isBanned: true });
    const result = await (await caller("color-user")).updateTavernColor({
      target: "username",
      color: "SLATE",
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/banned/i);
  });

  it("writes an action log only after a successful change", async () => {
    await createUser();
    const api = await caller("color-user");
    await api.updateTavernColor({ target: "username", color: "NAVY" });
    await api.updateTavernColor({ target: "username", color: "NAVY" });
    const database = await getTestDatabase();
    const logs = await database
      .select()
      .from(actionLog)
      .where(eq(actionLog.userId, "color-user"));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.changes).toEqual([
      "Tavern username color changed from DEFAULT to NAVY (-10 reputation)",
    ]);
  });

  it("cannot overspend when two purchases race", async () => {
    await createUser({ reputationPoints: 10 });
    const api = await caller("color-user");
    const results = await Promise.all([
      api.updateTavernColor({ target: "username", color: "NAVY" }),
      api.updateTavernColor({ target: "title", color: "COBALT" }),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const user = await readUser();
    expect(user?.reputationPoints).toBe(0);
    expect(
      [user?.tavernUsernameColor, user?.tavernTitleColor].filter(
        (color) => color !== "DEFAULT",
      ),
    ).toHaveLength(1);
  });

  it("rejects a stale username color change after a concurrent update", async () => {
    await createUser({ reputationPoints: 20 });
    // The budget covers both purchases on purpose: the guard under test is the colour
    // predicate in the update's WHERE, not the reputation one, and it only fires when the
    // second write follows a read that the first write has since invalidated.
    const results = await withRowHeld("color-user", 2, (database) => {
      const api = callerForDatabase(profileRouter, "color-user", database);
      return Promise.all([
        api.updateTavernColor({ target: "username", color: "NAVY" }),
        api.updateTavernColor({ target: "username", color: "COBALT" }),
      ]);
    });
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.filter((result) => !result.success)).toHaveLength(1);
    expect(
      results.find((result) => !result.success)?.message,
    ).toMatch(/could not update tavern color/i);

    const user = await readUser();
    expect(user?.reputationPoints).toBe(10);
    expect(["NAVY", "COBALT"]).toContain(user?.tavernUsernameColor);

    const database = await getTestDatabase();
    const logs = await database
      .select()
      .from(actionLog)
      .where(eq(actionLog.userId, "color-user"));
    expect(logs).toHaveLength(1);
    const changes = logs[0]?.changes;
    expect(Array.isArray(changes)).toBe(true);
    if (!Array.isArray(changes)) {
      throw new Error("Expected action log changes to be an array");
    }
    expect(changes[0]).toMatch(
      /^Tavern username color changed from DEFAULT to (NAVY|COBALT)/,
    );
  });
});
