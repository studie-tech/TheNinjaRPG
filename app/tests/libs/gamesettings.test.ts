import { afterEach, describe, expect, it, setSystemTime, vi } from "bun:test";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { PET_ART_PROVIDER_SETTING, PetArtProviders } from "@/drizzle/constants";
import type { GameSetting } from "@/drizzle/schema";
import {
  getPetArtProvider,
  lockWithDailyTimer,
  lockWithGameTimer,
  lockWithHourlyTimer,
  lockWithMinuteTimer,
  lockWithMonthlyTimer,
  lockWithWeeklyTimer,
} from "@/libs/gamesettings";
import type { DrizzleClient } from "@/server/db";

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
  const findFirst = vi.fn(async (_query: { where: SQL }) => ({ ...row }));
  const client = {
    query: { gameSetting: { findFirst } },
    update: vi.fn(() => ({
      set: (patch: Partial<GameSetting>) => ({
        where: (predicate: SQL) => where(predicate, patch),
      }),
    })),
  } as unknown as DrizzleClient;
  return {
    client,
    where,
    findFirst,
    read: () => row,
    replace: (next: GameSetting) => {
      row = next;
    },
  };
};

afterEach(() => setSystemTime());

describe("weekly timer period", () => {
  it("opens on Monday UTC and stays claimed through the rest of the week", async () => {
    const store = timerStore();
    setSystemTime(new Date("2026-11-02T00:00:00.000Z"));
    expect((await lockWithWeeklyTimer(store.client, "timer")).isClaimed).toBe(true);
    setSystemTime(new Date("2026-11-08T23:59:59.000Z"));
    expect((await lockWithWeeklyTimer(store.client, "timer")).isClaimed).toBe(false);
    setSystemTime(new Date("2026-11-09T00:00:00.000Z"));
    expect((await lockWithWeeklyTimer(store.client, "timer")).isClaimed).toBe(true);
  });
});

describe("period lock responses", () => {
  it.each([
    ["hour", lockWithHourlyTimer],
    ["minute", lockWithMinuteTimer],
    ["day", lockWithDailyTimer],
    ["week", lockWithWeeklyTimer],
    ["month", lockWithMonthlyTimer],
  ] as const)(
    "answers the %s winner with null and the loser with the wait",
    async (period, lock) => {
      setSystemTime(now);
      const store = timerStore();
      const winner = await lock(store.client, "timer");
      const loser = await lock(store.client, "timer");
      expect(await winner.response.json()).toBeNull();
      expect(await loser.response.json()).toBe(
        `Wait until the next ${period} to run this again`,
      );
    },
  );
});

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
        lock(store.client, "timer"),
        lock(store.client, "timer"),
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
      expect(store.read()).toEqual(
        expect.objectContaining({ time: oldTime, value: 0 }),
      );
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
      expect(store.read()).toEqual(expect.objectContaining({ time: later, value: 0 }));
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
    ["hourly", lockWithHourlyTimer, "2026-10-21T10:00:00Z", false],
    ["hourly", lockWithHourlyTimer, "2026-10-21T09:59:59.999Z", true],
    ["hourly", lockWithHourlyTimer, "2026-10-21T09:31:00Z", true],
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
  ] as const)(
    "%s with previous timestamp %s",
    async (_name, lock, previous, expected) => {
      setSystemTime(now);
      const store = timerStore(new Date(previous));
      expect((await lock(store.client, "timer")).isClaimed).toBe(expected);
      expect(store.where).toHaveBeenCalledTimes(expected ? 1 : 0);
    },
  );

  it("runs a */10 hourly cron once per hour and a minute-0 cron despite an early fire", async () => {
    const store = timerStore();
    const claims: boolean[] = [];
    for (const time of ["09:00:05", "09:10:05", "09:50:05", "10:00:02", "10:10:02"]) {
      setSystemTime(new Date(`2026-10-21T${time}Z`));
      claims.push((await lockWithHourlyTimer(store.client, "timer")).isClaimed);
    }
    expect(claims).toEqual([true, false, false, true, false]);
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
    expect(await lockWithGameTimer(store.client, "indexer-1m", 60_000)).toBeInstanceOf(
      Response,
    );
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
    expect(store.read()).toEqual(expect.objectContaining({ time: marker, value: 1 }));
  });
});

describe("lockWithGameTimer", () => {
  it("updates the same persisted key that it checked", async () => {
    setSystemTime(now);
    const name = "transaction-sync-1h";
    const store = timerStore(new Date(now.getTime() - 60 * 60_000));

    expect(await lockWithGameTimer(store.client, name, 60 * 60_000)).toBe(false);

    for (const [query] of store.findFirst.mock.calls) {
      expect(dialect.sqlToQuery(query.where).params).toEqual([name]);
    }
    const [predicate, patch] = store.where.mock.calls[0]!;
    expect(patch).toEqual({ value: 0, time: now });
    expect(dialect.sqlToQuery(predicate).params).toEqual([
      "timer-id",
      "2026-10-21 09:30:10.000",
    ]);
  });

  it("does not update a timer while its duration has not elapsed", async () => {
    setSystemTime(now);
    const store = timerStore(new Date(now.getTime() - 10 * 60_000));

    expect(
      await lockWithGameTimer(store.client, "transaction-sync-1h", 60 * 60_000),
    ).toBeInstanceOf(Response);
    expect(store.client.update).not.toHaveBeenCalled();
  });

  it("reports remaining time from the duration rather than the key's label", async () => {
    setSystemTime(now);
    const store = timerStore(new Date(now.getTime() - 2 * 60_000));

    const response = await lockWithGameTimer(
      store.client,
      "auction-expire-0.083m",
      5 * 60_000,
    );

    expect(response).toBeInstanceOf(Response);
    if (response) {
      expect(await response.json()).toBe("Wait 2 mins, 59 secs before running again");
    }
  });
});

describe("getPetArtProvider", () => {
  it("selects the persistent companion art index from loaded settings, defaulting to GPT", () => {
    const settings = (value: number) => [{ name: PET_ART_PROVIDER_SETTING, value }];
    expect(getPetArtProvider([])).toBe("GPT");
    expect(
      getPetArtProvider([
        { name: "unrelated", value: PetArtProviders.indexOf("NANO_BANANA") },
      ]),
    ).toBe("GPT");
    expect(getPetArtProvider(settings(PetArtProviders.indexOf("GPT")))).toBe("GPT");
    expect(getPetArtProvider(settings(PetArtProviders.indexOf("NANO_BANANA")))).toBe(
      "NANO_BANANA",
    );
    expect(getPetArtProvider(settings(7))).toBe("GPT");
    expect(getPetArtProvider(settings(0.5))).toBe("GPT");
  });
});
