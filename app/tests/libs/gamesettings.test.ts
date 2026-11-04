import { afterEach, describe, expect, it, setSystemTime, vi } from "bun:test";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { PetArtProviders } from "@/drizzle/constants";
import type { GameSetting } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { actualGameSettings } from "../setup/preload";

const {
  fetchPetArtProvider,
  lockWithDailyTimer,
  lockWithHourlyTimer,
  lockWithMinuteTimer,
  lockWithMonthlyTimer,
  lockWithWeeklyTimer,
  lockWithGameTimer,
} = actualGameSettings;
const now = new Date("2026-10-21T10:30:10.000Z");
const oldTime = new Date("2026-09-01T00:00:00.000Z");
const dialect = new MySqlDialect();
const sqlTime = (time: Date) => time.toISOString().replace("T", " ").replace("Z", "");

/** Evaluate the generated CAS against a shared row, including stale reader snapshots. */
const timerStore = (time = oldTime, value = 7) => {
  let row: GameSetting = { id: "timer-id", name: "timer", time, value };
  const where = vi.fn(async (predicate: SQL, patch: Partial<GameSetting>) => {
    const compiled = dialect.sqlToQuery(predicate);
    expect(compiled.sql).toBe("(`GameSetting`.`id` = ? and `GameSetting`.`time` = ?)");
    const [expectedId, expectedTime] = compiled.params;
    if (expectedId !== row.id || expectedTime !== sqlTime(row.time)) {
      return { rowsAffected: 0 };
    }
    row = { ...row, ...patch };
    return { rowsAffected: 1 };
  });
  const client = {
    query: { gameSetting: { findFirst: vi.fn(async () => ({ ...row })) } },
    update: () => ({ set: (patch: Partial<GameSetting>) => ({
      where: (predicate: SQL) => where(predicate, patch),
    }) }),
  } as unknown as DrizzleClient;
  return { client, where, read: () => row, replace: (next: GameSetting) => { row = next; } };
};

afterEach(() => setSystemTime());

for (const [name, lock] of [
  ["hourly", lockWithHourlyTimer],
  ["minute", lockWithMinuteTimer],
  ["daily", lockWithDailyTimer],
  ["weekly", lockWithWeeklyTimer],
  ["monthly", lockWithMonthlyTimer],
] as const) {
  describe(`${name} timer claims`, () => {
    it("admits one concurrent caller and prevents the loser from releasing it", async () => {
      setSystemTime(now);
      const store = timerStore();
      const results = await Promise.all([
        lock(store.client, "timer"), lock(store.client, "timer"),
      ]);
      expect(results.filter((result) => result.isClaimed)).toHaveLength(1);
      const winner = results.find((result) => result.isClaimed)!;
      const loser = results.find((result) => !result.isClaimed)!;
      expect(winner.prevTime).toEqual(oldTime);
      expect(winner.prevValue).toBe(7);
      expect(await loser.response.json()).toBeString();
      expect(await loser.release()).toBe(false);
      expect(store.read().time).toEqual(now);
      expect(await winner.release()).toBe(true);
      expect(store.read()).toMatchObject({ time: oldTime, value: 0 });
      expect(await winner.release()).toBe(false);
    });

    it("never releases or completes a newer owner's claim", async () => {
      setSystemTime(now);
      const store = timerStore();
      const first = await lock(store.client, "timer");
      const later = new Date("2026-12-01T10:30:10.000Z");
      setSystemTime(later);
      const second = await lock(store.client, "timer");
      expect(second.isClaimed).toBe(true);
      expect(await first.release()).toBe(false);
      expect(await first.update(10, oldTime)).toBe(false);
      expect(store.read()).toMatchObject({ time: later, value: 0 });
      expect(await second.release()).toBe(true);
      expect(store.read().time).toEqual(now);
    });

    it("guards row identity when a timer is replaced", async () => {
      setSystemTime(now);
      const store = timerStore();
      const first = await lock(store.client, "timer");
      store.replace({ ...store.read(), id: "replacement" });
      expect(await first.release()).toBe(false);
      expect(store.read().time).toEqual(now);
    });
  });
}

describe("timer cadence", () => {
  it.each([
    ["hourly", lockWithHourlyTimer, "2026-10-21T09:31:00Z", false],
    ["hourly", lockWithHourlyTimer, "2026-10-21T09:30:10Z", true],
    ["hourly", lockWithHourlyTimer, "2026-10-20T10:30:10Z", true],
    ["minute", lockWithMinuteTimer, "2026-10-21T10:30:00Z", false],
    ["minute", lockWithMinuteTimer, "2026-10-21T10:29:59.999Z", true],
    ["daily", lockWithDailyTimer, "2026-10-21T00:00:00Z", false],
    ["daily", lockWithDailyTimer, "2025-10-21T10:30:10Z", true],
    ["weekly", lockWithWeeklyTimer, "2026-10-20T10:30:10Z", false],
    ["weekly", lockWithWeeklyTimer, "2026-10-01T10:30:10Z", true],
    ["monthly", lockWithMonthlyTimer, "2026-10-01T00:00:00Z", false],
    ["monthly", lockWithMonthlyTimer, "2025-10-21T10:30:10Z", true],
  ] as const)("%s with previous timestamp %s", async (_name, lock, previous, expected) => {
    setSystemTime(now);
    const store = timerStore(new Date(previous));
    expect((await lock(store.client, "timer")).isClaimed).toBe(expected);
    expect(store.where).toHaveBeenCalledTimes(expected ? 1 : 0);
  });

  it("keeps the generic timer name, duration tolerance and false/Response contract", async () => {
    setSystemTime(now);
    const store = timerStore();
    const results = await Promise.all([
      lockWithGameTimer(store.client, "indexer-1m", 60_000),
      lockWithGameTimer(store.client, "indexer-1m", 60_000),
    ]);
    expect(results.filter((result) => result === false)).toHaveLength(1);
    expect(results.filter((result) => result instanceof Response)).toHaveLength(1);
    expect(store.client.query.gameSetting.findFirst).toHaveBeenCalledTimes(2);
    expect(await lockWithGameTimer(store.client, "indexer-1m", 60_000)).toBeInstanceOf(Response);
    setSystemTime(new Date(now.getTime() + 59_994));
    expect(await lockWithGameTimer(store.client, "indexer-1m", 60_000)).toBe(false);
  });

  it("records a resume marker only while it owns the claim", async () => {
    setSystemTime(now);
    const store = timerStore();
    const claim = await lockWithDailyTimer(store.client, "daily-quest");
    const marker = new Date("2026-10-20T23:59:59.999Z");
    expect(await claim.update(1, marker)).toBe(true);
    expect(await claim.release()).toBe(false);
    expect(store.read()).toMatchObject({ time: marker, value: 1 });
  });
});

describe("fetchPetArtProvider", () => {
  it("selects the companion art provider from its game setting, defaulting to GPT", async () => {
    const client = (row?: { value: number }) => ({ query: { gameSetting: { findFirst: async () => row } } }) as unknown as DrizzleClient;
    expect(await fetchPetArtProvider(client())).toBe("GPT");
    expect(await fetchPetArtProvider(client({ value: PetArtProviders.indexOf("GPT") }))).toBe("GPT");
    expect(await fetchPetArtProvider(client({ value: PetArtProviders.indexOf("NANO_BANANA") }))).toBe("NANO_BANANA");
    expect(await fetchPetArtProvider(client({ value: 7 }))).toBe("GPT");
    expect(await fetchPetArtProvider(client({ value: 0.5 }))).toBe("GPT");
  });
});
