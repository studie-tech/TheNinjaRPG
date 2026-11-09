import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  actionLog,
  jutsu,
  jutsuLoadout,
  userData,
  userJutsu,
  userQueue,
} from "@/drizzle/schema";
import { updateUser } from "@/libs/combat/database";
import { calcBattleResult } from "@/libs/combat/settlement";
import type { PusherClient } from "@/libs/pusher";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { profileRouter } from "@/server/api/routers/profile";
import { insertJutsus, insertUsers, jutsuRow } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";
import { makeBattleUser, makeCompleteBattle } from "../../../../setup/combat";

const USER = "elite-progression";
/** Minimal catalog definition shared by training, evolution and combat fixtures. */
const definition = (
  id: string,
  requiredRank: "JONIN" | "ELITE JONIN" = "ELITE JONIN",
) => jutsuRow(id, { jutsuRank: "S", requiredRank });

describeWithDatabase("Elite Jonin jutsu progression", () => {
  beforeEach(async () => {
    await resetTables(userQueue, userJutsu, jutsuLoadout, jutsu, actionLog, userData);
    await insertUsers([
      {
        userId: USER,
        username: USER,
        rank: "ELITE JONIN",
        level: 100,
        role: "OWNER",
        status: "AWAKE",
        isOutlaw: true,
        money: 1_000_000,
        regeneration: 0,
      },
    ]);
    const db = await getTestDatabase();
    await insertJutsus([
      definition("elite"),
      definition("target"),
      definition("ordinary", "JONIN"),
      { ...definition("evolved"), parentJutsuId: "elite" },
    ]);
    await db.insert(userJutsu).values([
      { id: "owned-elite", userId: USER, jutsuId: "elite", level: 25 },
      { id: "owned-target", userId: USER, jutsuId: "target", level: 24 },
      { id: "owned-ordinary", userId: USER, jutsuId: "ordinary", level: 25 },
    ]);
  });

  it("enforces parent mastery and staff adjustment caps", async () => {
    const caller = await callerFor(jutsuRouter, USER);
    expect(
      (
        await caller.evolveJutsu({
          userJutsuId: "owned-elite",
          evolutionJutsuId: "evolved",
        })
      ).message,
    ).toContain("30");
    expect(
      (await caller.adjustUserJutsu({ userId: USER, jutsuId: "ordinary", level: 26 }))
        .success,
    ).toBe(false);
    expect(
      (await caller.adjustUserJutsu({ userId: USER, jutsuId: "elite", level: 31 }))
        .success,
    ).toBe(false);
    expect(
      (await caller.adjustUserJutsu({ userId: USER, jutsuId: "elite", level: 30 }))
        .success,
    ).toBe(true);
    expect(
      (
        await caller.evolveJutsu({
          userJutsuId: "owned-elite",
          evolutionJutsuId: "evolved",
        })
      ).success,
    ).toBe(true);
    const db = await getTestDatabase();
    expect(
      await db.query.userJutsu.findFirst({ where: eq(userJutsu.id, "owned-elite") }),
    ).toMatchObject({ jutsuId: "evolved", level: 1, experience: 0 });
  });

  it("transfers out of level 30 but never into a recipient past 25", async () => {
    const caller = await callerFor(jutsuRouter, USER);
    await caller.adjustUserJutsu({ userId: USER, jutsuId: "elite", level: 30 });
    const input = { fromJutsuId: "elite", toJutsuId: "target", transferLevels: 1 };
    expect((await caller.transferLevel(input)).success).toBe(true);
    expect((await caller.transferLevel(input)).success).toBe(false);
    expect((await caller.transferLevel({ ...input, toJutsuId: "elite" })).success).toBe(
      false,
    );
    const db = await getTestDatabase();
    expect(
      await db.query.userJutsu.findFirst({ where: eq(userJutsu.id, "owned-elite") }),
    ).toMatchObject({ level: 29 });
    expect(
      await db.query.userJutsu.findFirst({ where: eq(userJutsu.id, "owned-target") }),
    ).toMatchObject({ level: 25 });
  });

  it("allows only one concurrent transfer into a level-24 recipient", async () => {
    const caller = await callerFor(jutsuRouter, USER);
    const results = await Promise.all(
      ["elite", "ordinary"].map((fromJutsuId) =>
        caller.transferLevel({ fromJutsuId, toJutsuId: "target", transferLevels: 1 }),
      ),
    );
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const rows = await (await getTestDatabase()).query.userJutsu.findMany({
      where: eq(userJutsu.userId, USER),
    });
    expect(rows.find((row) => row.jutsuId === "target")!.level).toBe(25);
    expect(rows.reduce((sum, row) => sum + row.level, 0)).toBe(74);
  });

  it("prices queued Elite levels with the same per-level five-hour duration", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ federalStatus: "GOLD" })
      .where(eq(userData.userId, USER));
    await db
      .update(userJutsu)
      .set({ level: 17 })
      .where(eq(userJutsu.id, "owned-elite"));
    const caller = await callerFor(jutsuRouter, USER);
    expect((await caller.startTraining({ jutsuId: "elite", levels: 3 })).success).toBe(
      true,
    );
    const queued = await db.query.userQueue.findMany({
      where: eq(userQueue.userId, USER),
    });
    expect(queued).toHaveLength(2);
    expect(queued.every((row) => row.durationSeconds === 5 * 3600)).toBe(true);
  });

  it("stores five-hour training and sidebar start times while retaining the cap of 20", async () => {
    const db = await getTestDatabase();
    await db
      .update(userJutsu)
      .set({ level: 19 })
      .where(eq(userJutsu.id, "owned-elite"));
    const caller = await callerFor(jutsuRouter, USER);
    const before = Date.now();
    expect((await caller.startTraining({ jutsuId: "elite" })).success).toBe(true);
    const row = (await db.query.userJutsu.findFirst({
      where: eq(userJutsu.id, "owned-elite"),
    }))!;
    expect(row.level).toBe(20);
    expect(row.finishTraining!.getTime() - before).toBeGreaterThanOrEqual(
      5 * 3_600_000,
    );
    const sidebar = await (await callerFor(profileRouter, USER)).getSidebarTimers();
    expect(
      sidebar.jutsuTraining!.finishTraining.getTime() -
        sidebar.jutsuTraining!.trainingStartedAt.getTime(),
    ).toBe(5 * 3_600_000);
    await db
      .update(userJutsu)
      .set({ finishTraining: null })
      .where(eq(userJutsu.id, row.id));
    expect((await caller.startTraining({ jutsuId: "elite" })).success).toBe(false);
  });

  it.each([
    [1, 0, 1, 100],
    [24, 4899, 24, 4999],
    [24, 4900, 25, 0],
    [25, 4900, 25, 5000],
    [25, 9899, 25, 9999],
    [25, 9900, 26, 0],
    [29, 9900, 30, 0],
    [30, 42, 30, 42],
  ])(
    "settles Elite XP from level %i with %i XP to level %i and %i XP",
    async (level, experience, nextLevel, nextExperience) => {
      const db = await getTestDatabase();
      await db
        .update(userJutsu)
        .set({ level, experience })
        .where(eq(userJutsu.id, "owned-elite"));
      await db
        .update(userJutsu)
        .set({ level: 24, experience: 900 })
        .where(eq(userJutsu.id, "owned-ordinary"));
      await db
        .update(userData)
        .set({ status: "BATTLE", battleId: "xp-battle" })
        .where(eq(userData.userId, USER));
      const snapshot = makeCompleteBattle({
        id: "xp-battle",
        rewardScaling: 1,
        extraState: {
          jutsus: {
            elite: definition("elite") as never,
            ordinary: definition("ordinary", "JONIN") as never,
          },
        },
        usersState: [
          makeBattleUser(USER, {
            isAi: false,
            isSummon: false,
            rank: "ELITE JONIN",
            pvpStreak: 0,
            sector: 335,
            villageId: "red",
            curHealth: 100,
            usedActions: [
              { id: "elite", type: "jutsu" },
              { id: "ordinary", type: "jutsu" },
            ],
          }),
          makeBattleUser("opponent", {
            curHealth: 0,
            isAi: false,
            isSummon: false,
            rank: "ELITE JONIN",
            pvpStreak: 0,
            sector: 335,
            villageId: "blue",
          }),
        ],
      });
      const result = calcBattleResult(snapshot, USER, []);
      expect(result).not.toBeNull();
      await updateUser(
        db,
        { trigger: async () => {} } as unknown as PusherClient,
        snapshot,
        result,
        USER,
      );
      expect(
        await db.query.userJutsu.findFirst({ where: eq(userJutsu.id, "owned-elite") }),
      ).toMatchObject({ level: nextLevel, experience: nextExperience });
      expect(
        await db.query.userJutsu.findFirst({
          where: eq(userJutsu.id, "owned-ordinary"),
        }),
      ).toMatchObject({ level: 25, experience: 0 });
    },
  );
});
