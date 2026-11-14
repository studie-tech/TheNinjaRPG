import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { userData, userItem } from "@/drizzle/schema";
import {
  selectUserItemForGetItemBalanceStatistics,
  selectUserItemForGetStatistics,
} from "@/queries/data";
import { dataRouter } from "@/routers/data";
import { insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

/** Call the router as a signed-out visitor. */
const anonymousCaller = async () =>
  dataRouter.createCaller({
    drizzle: await getTestDatabase(),
    userId: null,
    userIp: "127.0.0.1",
    userAgent: undefined,
    userCountry: undefined,
    abLemuReplacementVariant: undefined,
    wallpaperVariant: undefined,
  } as never);

describeWithDatabase("public content statistics", () => {
  beforeEach(async () => {
    stubRateLimitTransport();
    await resetTables(userItem, userData);
    await insertUsers([
      { userId: "ai", username: "Bandit", isAi: true },
      {
        userId: "player",
        username: "Player",
        lastIp: "203.0.113.7",
        money: 123456,
        bank: 987654,
      },
      { userId: "owner" },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns only the public name of an AI", async () => {
    const result = await (await anonymousCaller()).getStatistics({
      id: "ai",
      type: "ai",
    });
    expect(result.info).toEqual({ userId: "ai", username: "Bandit" });
  });

  it("returns nothing about a player requested as an AI", async () => {
    const result = await (await anonymousCaller()).getStatistics({
      id: "player",
      type: "ai",
    });
    expect(result.info).toBeUndefined();
  });

  it("counts distinct owners of an item and copies equipped in any slot", async () => {
    const db = await getTestDatabase();
    await db.insert(userItem).values([
      { id: "a", userId: "player", itemId: "sword", equipped: "HAND_1" },
      { id: "b", userId: "player", itemId: "sword", equipped: "NONE" },
      { id: "c", userId: "owner", itemId: "sword", equipped: "HEAD" },
      { id: "d", userId: "owner", itemId: "shield", equipped: "NONE" },
    ]);
    expect(await selectUserItemForGetStatistics(db, { id: "sword" })).toEqual([
      { count: 2 },
    ]);
    const equipped = await selectUserItemForGetItemBalanceStatistics(db);
    expect(
      Object.fromEntries(equipped.map((row) => [row.itemId, row.equippedCount])),
    ).toEqual({
      sword: 2,
      shield: 0,
    });
  });
});
