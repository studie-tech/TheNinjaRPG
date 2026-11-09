import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  bloodline,
  dataBattleAction,
  item,
  jutsu,
  userData,
  userItem,
  userJutsu,
} from "@/drizzle/schema";
import { dataRouter } from "@/server/api/routers/data";
import {
  insertItems,
  insertJutsus,
  insertUsers,
  jutsuRow,
} from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const statistics = async (input: {
  id: string;
  type: "jutsu" | "item" | "bloodline" | "ai";
}) => (await callerFor(dataRouter, "viewer")).getStatistics(input);

/** Content statistics: owner counts per level and in total, plus the battle usage rows. */
describeWithDatabase("data.getStatistics", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(async () => {
    stubRateLimitTransport();
    await resetTables(
      dataBattleAction,
      userJutsu,
      userItem,
      jutsu,
      item,
      bloodline,
      userData,
    );
    const db = await getTestDatabase();
    await db.insert(bloodline).values({
      id: "line",
      name: "Line",
      rank: "D",
      image: "",
      description: "Stats",
      effects: [],
    });
    await insertUsers([
      { userId: "viewer", username: "Viewer" },
      { userId: "low-a", username: "LowA", level: 5, bloodlineId: "line" },
      { userId: "low-b", username: "LowB", level: 5, bloodlineId: "line" },
      { userId: "high", username: "High", level: 20, bloodlineId: "line" },
      { userId: "machine", username: "Machine", isAi: true },
    ]);
    await insertJutsus([jutsuRow("fireball", { name: "Fireball" })]);
    await insertItems([{ id: "kunai", name: "Kunai" }]);
    await db.insert(userJutsu).values([
      { id: "uj-1", userId: "low-a", jutsuId: "fireball", level: 1 },
      { id: "uj-2", userId: "low-b", jutsuId: "fireball", level: 1 },
      { id: "uj-3", userId: "high", jutsuId: "fireball", level: 3 },
    ]);
    await db.insert(userItem).values([
      { id: "ui-1", userId: "low-a", itemId: "kunai" },
      { id: "ui-2", userId: "low-a", itemId: "kunai" },
      { id: "ui-3", userId: "high", itemId: "kunai" },
    ]);
    await db.insert(dataBattleAction).values([
      {
        type: "jutsu",
        contentId: "fireball",
        battleType: "ARENA",
        battleWon: 1,
        count: 4,
      },
      { type: "item", contentId: "kunai", battleType: "ARENA", battleWon: 0, count: 2 },
    ]);
  });

  it("totals jutsu owners across their level distribution", async () => {
    const result = await statistics({ id: "fireball", type: "jutsu" });
    expect(result.info).toMatchObject({ id: "fireball" });
    expect(result.levelDistribution).toEqual([
      { level: 1, count: 2 },
      { level: 3, count: 1 },
    ]);
    expect(result.totalUsers).toBe(3);
    expect(result.usage.length).toBeGreaterThan(0);
  });

  it("totals bloodline holders across their level distribution", async () => {
    const result = await statistics({ id: "line", type: "bloodline" });
    expect(result.info).toMatchObject({ id: "line" });
    expect(result.levelDistribution).toEqual([
      { level: 5, count: 2 },
      { level: 20, count: 1 },
    ]);
    expect(result.totalUsers).toBe(3);
  });

  it("counts distinct item owners without a level distribution", async () => {
    const result = await statistics({ id: "kunai", type: "item" });
    expect(result.info).toMatchObject({ id: "kunai" });
    expect(result.totalUsers).toBe(2);
    expect(result.levelDistribution).toBeNull();
  });

  it("describes AI profiles without owner counts", async () => {
    const result = await statistics({ id: "machine", type: "ai" });
    expect(result.info).toMatchObject({ userId: "machine", username: "Machine" });
    expect(result.totalUsers).toBeNull();
    expect(result.levelDistribution).toBeNull();
  });

  it("rejects balance filters outside their enums", async () => {
    const caller = await callerFor(dataRouter, "viewer");
    await expect(
      caller.getRankedLoadoutStatistics({ types: ["bogus"] as never }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.getBloodlineBalanceStatistics({ bloodlineRanks: ["Z"] as never }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects an unknown statistics type", async () => {
    await expect(
      statistics({ id: "fireball", type: "basic" as never }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
