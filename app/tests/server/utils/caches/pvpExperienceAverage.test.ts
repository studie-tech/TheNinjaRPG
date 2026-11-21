import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { PVP_EXPERIENCE_AVERAGE_SETTING } from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import {
  fetchPvpExperienceAverage,
  invalidatePvpExperienceAverage,
} from "@/server/utils/caches/pvpExperienceAverage";

const start = new Date("2026-10-21T12:00:00Z");

/** Fake client whose average query resolves to the next queued value. */
const fakeClient = (averages: number[]) => {
  let queries = 0;
  const client = {
    select: () => ({
      from: () => ({
        where: async () => [{ average: averages[queries++] ?? 0 }],
      }),
    }),
  } as unknown as Pick<DrizzleClient, "select">;
  return { client, queries: () => queries };
};

describe("fetchPvpExperienceAverage shared cache", () => {
  beforeEach(() => {
    setSystemTime(start);
  });
  afterEach(() => {
    setSystemTime();
  });

  it("serves repeat calls within the TTL from one query", async () => {
    const { client, queries } = fakeClient([1000, 2000]);
    const first = await fetchPvpExperienceAverage(client);
    setSystemTime(new Date(start.getTime() + 30 * 1000));
    const second = await fetchPvpExperienceAverage(client);
    setSystemTime(new Date(start.getTime() + 10 * 60 * 1000 - 1));
    const third = await fetchPvpExperienceAverage(client);
    expect(queries()).toBe(1);
    expect(first).toMatchObject({ name: PVP_EXPERIENCE_AVERAGE_SETTING, value: 1000 });
    expect(first.time).toEqual(start);
    expect([second.value, third.value]).toEqual([1000, 1000]);
  });

  it("shares one query between concurrent misses", async () => {
    const { client, queries } = fakeClient([1000, 2000]);
    const results = await Promise.all([
      fetchPvpExperienceAverage(client),
      fetchPvpExperienceAverage(client),
    ]);
    expect(queries()).toBe(1);
    expect(results.map((r) => r.value)).toEqual([1000, 1000]);
  });

  it("re-queries once the TTL has passed", async () => {
    const { client, queries } = fakeClient([1000, 2000]);
    await fetchPvpExperienceAverage(client);
    setSystemTime(new Date(start.getTime() + 10 * 60 * 1000));
    const refreshed = await fetchPvpExperienceAverage(client);
    expect(queries()).toBe(2);
    expect(refreshed.value).toBe(2000);
  });

  it("re-queries after the daily decay invalidates it", async () => {
    const { client, queries } = fakeClient([1000, 900]);
    await fetchPvpExperienceAverage(client);
    await invalidatePvpExperienceAverage();
    const decayed = await fetchPvpExperienceAverage(client);
    expect(queries()).toBe(2);
    expect(decayed.value).toBe(900);
  });

  it("does not cache a failed query", async () => {
    let calls = 0;
    const client = {
      select: () => ({
        from: () => ({
          where: async () => {
            calls += 1;
            if (calls === 1) throw new Error("connection dropped");
            return [{ average: 1500 }];
          },
        }),
      }),
    } as unknown as Pick<DrizzleClient, "select">;
    await expect(fetchPvpExperienceAverage(client)).rejects.toThrow(
      "connection dropped",
    );
    expect((await fetchPvpExperienceAverage(client)).value).toBe(1500);
    expect(calls).toBe(2);
  });

  it("forces the covering index led by (isAi, pvpExperience)", async () => {
    let hint: unknown;
    const client = {
      select: () => ({
        from: (_table: unknown, config: unknown) => {
          hint = config;
          return { where: async () => [{ average: 1000 }] };
        },
      }),
    } as unknown as Pick<DrizzleClient, "select">;
    await fetchPvpExperienceAverage(client);
    const covering = getTableConfig(userData).indexes.find(
      (index) => index.config.name === "UserData_pvpExperienceAverage_idx",
    );
    expect(
      covering?.config.columns
        .slice(0, 2)
        .map((column) => "name" in column && column.name),
    ).toEqual(["isAi", "pvpExperience"]);
    expect(hint).toEqual({ forceIndex: covering?.config.name });
  });
});
