import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { battleHistory, userData } from "@/drizzle/schema";
import { combatRouter } from "@/server/api/routers/combat";
import { insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../../setup/testDatabase";

const createdAt = new Date("2026-01-01T12:00:00.123Z");
const seed = async (
  ids: number[],
  extra: Partial<typeof battleHistory.$inferInsert> = {},
) => {
  const db = await getTestDatabase();
  await db.insert(battleHistory).values(
    ids.map((id) => ({
      id,
      createdAt,
      battleId: `battle-${id}`,
      battleType: "COMBAT" as const,
      attackedId: "actor",
      defenderId: "opponent",
      ...extra,
    })),
  );
};

const page = async (
  input: Parameters<
    ReturnType<typeof combatRouter.createCaller>["getBattleHistory"]
  >[0] = {},
) => (await callerFor(combatRouter, "actor")).getBattleHistory(input);

describeWithDatabase("battle history pagination", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    await resetTables(battleHistory, userData);
    await insertUsers([
      { userId: "actor", username: "Actor" },
      { userId: "opponent", username: "Opponent" },
    ]);
  });

  it("orders equal timestamps by ID and continues after inserts and deleting the cursor row", async () => {
    await seed([1, 2, 3, 4, 5]);
    await seed([6], { createdAt: new Date(createdAt.getTime() - 1) });
    const first = await page({ limit: 2 });
    expect(first.data.map((row) => row.id)).toEqual([5, 4]);
    expect(first.nextCursor).toEqual({ createdAt, id: 4 });
    await seed([7], { createdAt: new Date(createdAt.getTime() + 1) });
    const db = await getTestDatabase();
    await db.delete(battleHistory).where(eq(battleHistory.id, 4));
    const second = await page({ limit: 2, cursor: first.nextCursor });
    const third = await page({ limit: 2, cursor: second.nextCursor });
    expect([...first.data, ...second.data, ...third.data].map((row) => row.id)).toEqual(
      [5, 4, 3, 2, 1, 6],
    );
    expect(third.nextCursor).toBeUndefined();
    expect((await page()).data[0]?.id).toBe(7);
  });

  for (const count of [0, 19, 20, 21, 40]) {
    it(`keeps every row at the ${count}-row page boundary`, async () => {
      const ids = Array.from({ length: count }, (_, i) => count - i);
      if (count) await seed(ids);
      const found: number[] = [];
      let cursor: Awaited<ReturnType<typeof page>>["nextCursor"];
      do {
        const result = await page({ cursor });
        expect(result.data.length).toBeLessThanOrEqual(20);
        found.push(...result.data.map((row) => row.id));
        cursor = result.nextCursor;
      } while (cursor);
      expect(found).toEqual(ids);
    });
  }

  it("retains user/type filters on every page, including defender and deleted-user history", async () => {
    await seed([1, 2], { battleType: "RANKED_PVP" });
    await seed([3], {
      attackedId: "deleted-user",
      defenderId: "actor",
      battleType: "RANKED_PVP",
    });
    await seed([4], { battleType: "ARENA" });
    await seed([5], { attackedId: "other", battleType: "RANKED_PVP" });
    const first = await page({ combatTypes: ["RANKED_PVP"], limit: 1 });
    expect(first.data[0]).toMatchObject({
      id: 3,
      attacker: null,
      defender: { userId: "actor" },
    });
    const second = await page({
      combatTypes: ["RANKED_PVP"],
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.data.map((row) => row.id)).toEqual([2]);
    expect((await page({ userId: "other" })).data.map((row) => row.id)).toEqual([5]);
    expect((await page({ combatTypes: [] })).data).toEqual([]);
  });

  it("honors secondsBack, including zero, instead of a fixed three-hour window", async () => {
    const now = Date.now();
    await seed([1], { createdAt: new Date(now - 30_000) });
    await seed([2], { createdAt: new Date(now - 120_000) });
    await seed([3], { createdAt: new Date(now - 4 * 3600_000) });
    expect((await page({ secondsBack: 60 })).data.map((row) => row.id)).toEqual([1]);
    expect((await page({ secondsBack: 10800 })).data.map((row) => row.id)).toEqual([
      1, 2,
    ]);
    expect((await page({ secondsBack: 0 })).data).toEqual([]);
    expect((await page()).data.map((row) => row.id)).toEqual([1, 2, 3]);
  });

  it("rejects invalid sizes, cursors and negative windows", async () => {
    for (const input of [
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { secondsBack: -1 },
      { cursor: { id: 0, createdAt } },
      { cursor: { id: 1.5, createdAt } },
    ]) {
      await expect(page(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("bounds SQL hydration for a 10,000-row history", async () => {
    await seed(Array.from({ length: 10_000 }, (_, i) => i + 1));
    const db = await getTestDatabase();
    const findMany = vi.spyOn(db.query.battleHistory, "findMany");
    const { result, statements, roundTrips } = await recordQueries(() => page());
    expect(result.data).toHaveLength(20);
    expect(roundTrips).toBe(1);
    expect(statements.join(" ")).toMatch(/limit 21$/i);
    expect(findMany.mock.calls[0]?.[0]?.limit).toBe(21);
    expect((await page({ limit: 100 })).data).toHaveLength(100);
  });
});
