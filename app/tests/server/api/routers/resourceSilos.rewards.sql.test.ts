import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { setTimeout } from "node:timers/promises";
import { eq, getTableName } from "drizzle-orm";
import mysql from "mysql2/promise";
import { MASTERY_RANK_CAPS, MasteryNames } from "@/drizzle/constants";
import {
  anbuSquad,
  clan,
  jutsu,
  resourceSilo,
  sageMode,
  sageModeRolls,
  userData,
  userJutsu,
  userPet,
  userQueue,
  userVote,
  village,
  villageStructure,
  war,
} from "@/drizzle/schema";
import {
  claimResourceSilo,
  claimResourceSiloWithRewards,
} from "@/queries/resourceSilos";
import { resourceSilosRouter } from "@/server/api/routers/resourceSilos";
import type { DrizzleClient } from "@/server/db";
import { prepareActionReadiness } from "@/server/utils/actionReadiness";
import { invalidatePvpExperienceAverage } from "@/server/utils/caches/pvpExperienceAverage";
import { updateRewards } from "@/server/utils/questRewards";
import * as time from "@/utils/time";
import {
  ObjectiveReward,
  type ObjectiveRewardType,
  PostProcessedRewardSchema,
} from "@/validators/rewards";
import {
  insertClans,
  insertJutsus,
  insertUserPets,
  insertUsers,
  insertUserVotes,
} from "../../../setup/factories";
import { queueEnergy } from "../../../setup/queues";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  lockWaitObserved,
  recordQueries,
  resetTables,
  runRawSql,
} from "../../../setup/testDatabase";

const userId = "silo-update-player";
let window: ReturnType<typeof time.getResourceSiloWindow>;
/** Seed an unconsumed threshold receipt for the controlled active spawn. */
const progress = () => ({ windowId: window.id, points: 60, claimed: false });
/** Load stored queue relations for recovery comparisons without profile settlement. */
const player = async (id = userId) => {
  const result = await (await getTestDatabase()).query.userData.findFirst({
    where: eq(userData.userId, id),
    with: { queue: true },
  });
  if (!result) throw new Error("Missing silo fixture player");
  return { ...result, userQuests: [] };
};
/** Configure a guaranteed package so a claim exercises the intended payout shape. */
const configure = async (rewards: Partial<ObjectiveRewardType>) => {
  await (await getTestDatabase()).insert(resourceSilo).values({
    id: "war-torn",
    updatedAt: new Date(),
    entries: [
      {
        kind: "package",
        sourceId: "supplies",
        name: "Supplies",
        chance: 100,
        rewards: ObjectiveReward.parse(rewards),
      },
    ],
  });
};

/** Claims confirm delivered rewards and keep their receipt, recovery and balances indivisible. */
describeWithDatabase("resource silo reward payouts", () => {
  beforeEach(async () => {
    await resetTables(
      userData,
      resourceSilo,
      jutsu,
      userJutsu,
      sageMode,
      sageModeRolls,
      userVote,
      userQueue,
      userPet,
      anbuSquad,
      clan,
      village,
      villageStructure,
      war,
    );
    await invalidatePvpExperienceAverage();
    const now = new Date();
    window = {
      active: true,
      id: "silo-update-window",
      start: new Date(now.getTime() - 60000),
      end: new Date(now.getTime() + 60000),
      next: now,
    };
    vi.spyOn(time, "getResourceSiloWindow").mockImplementation(() => window);
    await insertUsers([
      {
        userId,
        sector: 335,
        status: "AWAKE",
        resourceSiloProgress: progress(),
        money: 50000,
      },
    ]);
    await insertUserVotes([{ userId }]);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["receipt", "account", "faction"] as const)(
    "rejects a blocked %s claim when the silo closes before its write",
    async (payout) => {
      const db = await getTestDatabase();
      await db
        .insert(village)
        .values({ id: "home", name: "Home", sector: 1, kageId: userId });
      await db
        .update(userData)
        .set({ villageId: "home" })
        .where(eq(userData.userId, userId));
      const ready = prepareActionReadiness(await player(), []);
      const rewards = PostProcessedRewardSchema.parse({
        reward_money: 123,
        reward_tokens: payout === "faction" ? 5 : 0,
      });
      const blocker = await mysql.createConnection(process.env.TEST_MYSQL_URL!);
      let claim: Promise<{ rowsAffected: number }> | undefined;
      try {
        // Only the fixture holds a lock, so each production helper must recheck its deadline.
        await blocker.beginTransaction();
        await blocker.query("SELECT userId FROM UserData WHERE userId = ? FOR UPDATE", [
          userId,
        ]);
        window.end = new Date(Date.now() + 3000);
        claim = Promise.resolve(
          payout === "receipt"
            ? claimResourceSilo(db, ready.initial, window, ready)
            : claimResourceSiloWithRewards(db, ready, window, rewards),
        );
        expect(
          await lockWaitObserved({
            table: getTableName(userData),
            heldLockData: userId,
          }),
        ).toBe(true);
        const [clock] = await blocker.query<mysql.RowDataPacket[]>(
          "SELECT TIMESTAMPDIFF(MICROSECOND, SYSDATE(3), ?) / 1000 AS remainingMs",
          [window.end],
        );
        const remainingMs = Number(clock[0]?.remainingMs);
        expect(remainingMs).toBeGreaterThan(0);
        await setTimeout(remainingMs + 100);
        await blocker.commit();
        expect((await claim).rowsAffected).toBe(0);
      } finally {
        await blocker.rollback();
        await claim?.catch(() => {});
        await blocker.end();
      }
      expect(await player()).toMatchObject({
        money: 50000,
        resourceSiloProgress: { claimed: false },
      });
      expect((await db.query.village.findFirst())?.tokens).toBe(0);
    },
  );

  it.each([false, true])(
    "confirms only the sage mode actually acquired, equipped=%s",
    async (equipped) => {
      const db = await getTestDatabase();
      await db.insert(sageMode).values(
        ["first-mode", "second-mode"].map((id) => ({
          id,
          name: id,
          image: "mode.png",
          description: "Silo reward mode",
        })),
      );
      if (equipped)
        await db
          .update(userData)
          .set({ sageModeId: "first-mode" })
          .where(eq(userData.userId, userId));
      await configure({ reward_sage_modes: ["first-mode", "second-mode"] });

      const result = await (await callerFor(resourceSilosRouter, userId)).claim();

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        equipped
          ? "Resource Silo unlocked. No rewards dropped this time."
          : "Resource Silo: 1 sage modes",
      );
      expect(await db.query.sageModeRolls.findMany()).toHaveLength(equipped ? 0 : 1);
    },
  );

  it("excludes already-owned jutsus from the claim confirmation", async () => {
    const db = await getTestDatabase();
    await insertJutsus([{ id: "owned-jutsu" }, { id: "new-jutsu" }]);
    await db.insert(userJutsu).values({
      id: "owned-jutsu-receipt",
      userId,
      jutsuId: "owned-jutsu",
    });
    await configure({ reward_jutsus: ["owned-jutsu", "new-jutsu"] });

    const result = await (await callerFor(resourceSilosRouter, userId)).claim();

    expect(result.success).toBe(true);
    expect(result.message).toBe("Resource Silo: 1 jutsus");
    expect(await db.query.userJutsu.findMany()).toHaveLength(2);
  });

  it("boosts scalar rewards exactly once without starting a transaction", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ pvpExperience: 100 })
      .where(eq(userData.userId, userId));
    await configure({ reward_money: 123 });
    const caller = await callerFor(resourceSilosRouter, userId);
    const { result, statements } = await recordQueries(() => caller.claim());
    expect(result.success).toBe(true);
    expect((await player()).money).toBe(50125);
    expect(
      statements.some((statement) => /^(?:begin|start transaction)/i.test(statement)),
    ).toBe(false);
    expect(
      statements.filter(
        (statement) =>
          /^update/i.test(statement) && statement.includes("resourceSiloProgress"),
      ),
    ).toHaveLength(1);
  });

  it("awards faction counters and the receipt only once in one joined update", async () => {
    const db = await getTestDatabase();
    await db
      .insert(village)
      .values({ id: "home", name: "Home", sector: 1, kageId: userId, tokens: 10 });
    await insertClans([
      { id: "clan", villageId: "home", points: 20, activityPoints: 30 },
    ]);
    await db.insert(anbuSquad).values({
      id: "anbu",
      image: "",
      name: "Squad",
      villageId: "home",
      kageOrderId: "order",
      leaderOrderId: "leader",
      points: 40,
    });
    await db
      .update(userData)
      .set({ villageId: "home", clanId: "clan", anbuId: "anbu" })
      .where(eq(userData.userId, userId));
    await configure({
      reward_money: 123,
      reward_tokens: 5,
      reward_clanpoints: 7,
      reward_anbupoints: 11,
    });
    const caller = await callerFor(resourceSilosRouter, userId);
    const { result, statements } = await recordQueries(() =>
      Promise.all([caller.claim(), caller.claim()]),
    );
    expect(result.filter((outcome) => outcome.success)).toHaveLength(1);
    expect(await player()).toMatchObject({
      money: 50123,
      resourceSiloProgress: { claimed: true },
    });
    expect((await db.query.village.findFirst())?.tokens).toBe(15);
    expect(await db.query.clan.findFirst()).toMatchObject({
      points: 27,
      activityPoints: 37,
    });
    expect((await db.query.anbuSquad.findFirst())?.points).toBe(51);
    expect(
      statements.some((statement) => /^(?:begin|start transaction)/i.test(statement)),
    ).toBe(false);
  });

  it("leaves the receipt and all balances available after a joined write failure", async () => {
    const db = await getTestDatabase();
    await insertClans([{ id: "clan", points: 20 }]);
    await db
      .update(userData)
      .set({ clanId: "clan" })
      .where(eq(userData.userId, userId));
    await configure({ reward_money: 123, reward_clanpoints: 7 });
    await runRawSql(
      "CREATE TRIGGER silo_fail_counter BEFORE UPDATE ON Clan FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'counter unavailable'",
    );
    try {
      await expect(
        (await callerFor(resourceSilosRouter, userId)).claim(),
      ).rejects.toThrow();
    } finally {
      await runRawSql("DROP TRIGGER IF EXISTS silo_fail_counter");
    }
    expect(await player()).toMatchObject({
      money: 50000,
      resourceSiloProgress: { claimed: false },
    });
    expect((await db.query.clan.findFirst())?.points).toBe(20);
    expect((await (await callerFor(resourceSilosRouter, userId)).claim()).success).toBe(
      true,
    );
    expect(await player()).toMatchObject({
      money: 50123,
      resourceSiloProgress: { claimed: true },
    });
  });

  it.each([
    { joined: false, queued: false, promotion: false },
    { joined: false, queued: false, promotion: true },
    { joined: true, queued: false, promotion: true },
    { joined: true, queued: true, promotion: true },
  ])(
    "matches sequential recovery and reward mastery allocation: %j",
    async ({ joined, queued, promotion }) => {
      const db = await getTestDatabase();
      const now = new Date();
      const state = {
        sector: 335,
        resourceSiloProgress: progress(),
        rank: "GENIN" as const,
        status: queued ? ("ASLEEP" as const) : ("AWAKE" as const),
        autoWakeUp: true,
        villageId: joined ? "home" : null,
        ninjutsuMastery: MASTERY_RANK_CAPS.NONE - 1,
        genjutsuMastery: 10,
        petExperience: 7,
        activePetId: "pet",
        curEnergy: 10,
        regenAt: new Date(now.getTime() - 16 * 60000),
        currentlyTrainingMastery: queued ? ("ninjutsuMastery" as const) : null,
        masteryTrainingStartedAt: queued ? new Date(now.getTime() - 16 * 60000) : null,
        trainingSpeed: "15min" as const,
      };
      await db.update(userData).set(state).where(eq(userData.userId, userId));
      await insertUsers([
        {
          userId: "sequential",
          username: "Sequential",
          ...state,
          activePetId: "other-pet",
        },
      ]);
      await insertUserPets([
        {
          id: "pet",
          userId,
          generationStatus: "READY",
          rank: 1,
          artRank: 1,
          avatar: "pet.png",
          battleEnabled: true,
        },
        {
          id: "other-pet",
          userId: "sequential",
          generationStatus: "READY",
          rank: 1,
          artRank: 1,
          avatar: "pet.png",
          battleEnabled: true,
        },
      ]);
      if (joined)
        await db
          .insert(village)
          .values({ id: "home", name: "Home", sector: 1, kageId: userId });
      if (queued)
        for (const id of [userId, "sequential"])
          await queueEnergy(id, [{ stat: "strength", energy: 1 }]);
      const rewards = PostProcessedRewardSchema.parse({
        reward_ninjutsu_experience: 100,
        reward_genjutsu_experience: 20,
        reward_exp: 17,
        reward_pet_experience: 3,
        reward_tokens: joined ? 5 : 0,
        ...(promotion
          ? { reward_mastery_stat: "ninjutsuMastery", reward_mastery_rank: "NOVICE" }
          : {}),
      });
      const ready = prepareActionReadiness(await player(), [], now);
      const reference = prepareActionReadiness(await player("sequential"), [], now);
      if (queued) {
        expect(ready.set).toHaveProperty("ninjutsuMastery");
        expect(ready.set).toHaveProperty("petExperience");
      }
      expect(
        (
          await claimResourceSiloWithRewards(
            db,
            ready,
            window,
            structuredClone(rewards),
          )
        ).rowsAffected,
      ).toBeGreaterThan(0);
      await db.transaction(async (tx) => {
        const client = tx as unknown as DrizzleClient;
        expect(
          (await claimResourceSilo(client, reference.initial, window, reference))
            .rowsAffected,
        ).toBe(1);
        await updateRewards({
          client,
          user: reference.user,
          rewards: structuredClone(rewards),
          reason: "comparison",
          pvpBoostApplied: true,
          inTransaction: true,
          persistQuestData: false,
        });
      });
      const actual = await player();
      const expected = await player("sequential");
      for (const key of [
        ...MasteryNames,
        "masteryRanks",
        "petExperience",
        "earnedExperience",
        "experience",
        "energyQueueHead",
        "currentlyTrainingMastery",
        "status",
      ] as const)
        expect(actual[key]).toEqual(expected[key]);
      expect(actual.ninjutsuMastery).toBe(
        promotion
          ? (queued ? MASTERY_RANK_CAPS.NONE : MASTERY_RANK_CAPS.NONE - 1) + 100
          : MASTERY_RANK_CAPS.NONE,
      );
      expect(actual.petExperience).toBeGreaterThan(7);
    },
  );

  it("rejects a changed mastery source before consuming a receipt or faction reward", async () => {
    const db = await getTestDatabase();
    await db
      .insert(village)
      .values({ id: "home", name: "Home", sector: 1, kageId: userId, tokens: 10 });
    await db
      .update(userData)
      .set({ villageId: "home" })
      .where(eq(userData.userId, userId));
    const ready = prepareActionReadiness(await player(), []);
    await db
      .update(userData)
      .set({ ninjutsuMastery: 99 })
      .where(eq(userData.userId, userId));
    const result = await claimResourceSiloWithRewards(
      db,
      ready,
      window,
      PostProcessedRewardSchema.parse({
        reward_ninjutsu_experience: 10,
        reward_tokens: 5,
      }),
    );
    expect(result.rowsAffected).toBe(0);
    expect(await player()).toMatchObject({
      ninjutsuMastery: 99,
      resourceSiloProgress: { claimed: false },
    });
    expect((await db.query.village.findFirst())?.tokens).toBe(10);
  });

  it("rejects a stale raid source before changing either joined war or the receipt", async () => {
    const db = await getTestDatabase();
    const fixtures = ["first", "second"].map((id) => ({
      id,
      type: "WAR_RAID" as const,
      status: "ACTIVE" as const,
      attackerVillageId: "home",
      defenderVillageId: "foe",
      attackerWarHealth: 100,
      defenderWarHealth: 100,
      attackerWarHealthMax: 120,
      defenderWarHealthMax: 120,
    }));
    await db.insert(war).values(fixtures);
    const ready = prepareActionReadiness(await player(), []);
    const rewards = PostProcessedRewardSchema.parse({
      reward_money: 123,
      reward_war_damage: 10,
      reward_war_healing: 5,
    });
    const sources = fixtures.map((entry) => ({ ...entry, side: "attacker" as const }));
    await db.update(war).set({ defenderWarHealth: 9 }).where(eq(war.id, "second"));
    expect(
      (
        await claimResourceSiloWithRewards(
          db,
          ready,
          window,
          rewards,
          undefined,
          sources,
        )
      ).rowsAffected,
    ).toBe(0);
    expect(await player()).toMatchObject({
      money: 50000,
      resourceSiloProgress: { claimed: false },
    });
    expect(await db.query.war.findFirst({ where: eq(war.id, "first") })).toMatchObject({
      attackerWarHealth: 100,
      defenderWarHealth: 100,
    });
    expect(await db.query.war.findFirst({ where: eq(war.id, "second") })).toMatchObject(
      { attackerWarHealth: 100, defenderWarHealth: 9 },
    );
    const second = sources.find((entry) => entry.id === "second");
    if (!second) throw new Error("Missing second raid fixture");
    second.defenderWarHealth = 9;
    expect(
      (
        await claimResourceSiloWithRewards(
          db,
          ready,
          window,
          rewards,
          undefined,
          sources,
        )
      ).rowsAffected,
    ).toBeGreaterThan(0);
    expect(await db.query.war.findFirst({ where: eq(war.id, "first") })).toMatchObject({
      attackerWarHealth: 105,
      defenderWarHealth: 90,
    });
    expect(await db.query.war.findFirst({ where: eq(war.id, "second") })).toMatchObject(
      { attackerWarHealth: 100, defenderWarHealth: 0 },
    );
  });

  it.each([
    { type: "VILLAGE_WAR" as const, enemyHealth: 10, ownExpected: 105 },
    { type: "WAR_RAID" as const, enemyHealth: 100, ownExpected: 105 },
    { type: "WAR_RAID" as const, enemyHealth: 10, ownExpected: 100 },
  ])(
    "preserves damage-before-healing for %j",
    async ({ type, enemyHealth, ownExpected }) => {
      const db = await getTestDatabase();
      await db.insert(village).values([
        { id: "home", name: "Home", sector: 1, kageId: userId, tokens: 1000 },
        { id: "foe", name: "Foe", sector: 2, kageId: "foe-kage", tokens: 1000 },
      ]);
      await db.insert(villageStructure).values(
        ["home", "foe"].map((id) => ({
          id: `${id}-hall`,
          villageId: id,
          name: "Town Hall",
          route: "/townhall",
          image: "",
          curSp: 1000,
        })),
      );
      await db.insert(war).values({
        id: "silo-war",
        type,
        status: "ACTIVE",
        attackerVillageId: "home",
        defenderVillageId: "foe",
        attackerWarHealth: 100,
        attackerWarHealthMax: 120,
        defenderWarHealth: enemyHealth,
        defenderWarHealthMax: 120,
      });
      await db
        .update(userData)
        .set({ villageId: "home" })
        .where(eq(userData.userId, userId));
      await configure({
        reward_war_damage: 10,
        reward_war_healing: 5,
        reward_money: 123,
      });
      const caller = await callerFor(resourceSilosRouter, userId);
      const { result, statements } = await recordQueries(() => caller.claim());
      expect(result.success).toBe(true);
      expect(await db.query.war.findFirst()).toMatchObject({
        attackerWarHealth: ownExpected,
        defenderWarHealth: enemyHealth - 10,
      });
      expect((await player()).money).toBe(50123);
      expect(
        statements.some((statement) => /^(?:begin|start transaction)/i.test(statement)),
      ).toBe(false);
    },
  );
});
