import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  FARM_MAX_PLOTS,
  FARM_PLOT_PURCHASE_COST,
  FARM_STARTING_PLOTS,
  FARM_WATER_EXPERIENCE,
} from "@/drizzle/constants";
import {
  farmCollectionLog,
  farmExtraction,
  farmPlot,
  item,
  quest,
  questHistory,
  skillTree,
  userData,
  userItem,
  userQueue,
  userSkill,
} from "@/drizzle/schema";
import { getFarmBulkMutationUpdate } from "@/deltas/farming";
import { setSystemTime } from "bun:test";
import { AUTO_CHECKOUT_MESSAGE, AUTO_WAKE_MESSAGE } from "@/libs/actionReadiness";
import { getFarmGrowTimeSeconds } from "@/libs/farming";
import { fetchActionUser } from "@/queries/actionReadiness";
import { farmingRouter } from "@/server/api/routers/farming";
import { itemRouter } from "@/server/api/routers/item";
import { DecreaseFarmingTime } from "@/validators/combat";
import { queueEnergy } from "../../../setup/queues";
import {
  beforeStatements,
  failStatements,
  overrideQuery,
} from "../../../setup/statements";
import { insertItems, insertUserItems, insertUsers } from "../../../setup/factories";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  recordQueries,
} from "../../../setup/testDatabase";
import { deferred } from "../../../setup/deferred";

/**
 * The farming router carries the economy: level gates, purchase caps, compare-and-swap
 * guards and the rules that keep farm produce out of the ryo economy. Those live inside
 * the procedures rather than in the pure helpers, so they can only be exercised against
 * a real database -- a mocked client would assert the query we wrote, not the row the
 * engine ends up with.
 */
const caller = (userId: string) => callerFor(farmingRouter, userId);

const seedItemRow = (overrides: Record<string, unknown> = {}) => ({
  id: "seed-1",
  name: "Test Seed",
  image: "/seed.png",
  description: "seed",
  itemType: "MATERIAL",
  rarity: "COMMON",
  slot: "ITEM",
  target: "CHARACTER",
  effects: [],
  isFarmSeed: true,
  farmGrowTimeSeconds: 60,
  farmYieldItemId: "crop-1",
  farmMinLevel: 1,
  farmSellValue: 5,
  canStack: true,
  stackSize: 50,
  ...overrides,
});

const cropItemRow = (overrides: Record<string, unknown> = {}) => ({
  id: "crop-1",
  name: "Test Crop",
  image: "/crop.png",
  description: "crop",
  itemType: "MATERIAL",
  rarity: "COMMON",
  slot: "ITEM",
  target: "CHARACTER",
  effects: [],
  farmSellValue: 40,
  farmHarvestExperience: 10,
  canStack: true,
  stackSize: 50,
  ...overrides,
});

const farmer = async (patch: Record<string, unknown> = {}) => {
  const [row] = await insertUsers([
    {
      userId: "farm-user",
      username: "farmer",
      status: "AWAKE",
      farmCurrency: 1000,
      ...patch,
    } as never,
  ]);
  return row as { userId: string };
};

const giveItem = async (id: string, itemId: string, quantity: number) => {
  const database = await getTestDatabase();
  await database
    .insert(userItem)
    .values({ id, userId: "farm-user", itemId, quantity, equipped: "NONE" } as never);
};

const insertFinishedExtraction = async (patch: Record<string, unknown> = {}) => {
  const database = await getTestDatabase();
  await database.insert(farmExtraction).values({
    id: "extraction-g",
    userId: "farm-user",
    extractorSlot: 0,
    cropItemId: "crop-1",
    seedItemId: "seed-1",
    cropQuantity: 1,
    seedQuantity: 3,
    startedAt: new Date(Date.now() - 120_000),
    finishAt: new Date(Date.now() - 60_000),
    ...patch,
  } as never);
  return database;
};

const activateFarmQuest = async (task: string, value = 10) => {
  const database = await getTestDatabase();
  await database.insert(quest).values({
    id: "farm-quest",
    name: "Work the field",
    questType: "event",
    content: {
      objectives: [
        { id: "farm-goal", task, value, description: "", successDescription: "" },
      ],
      reward: {},
      sceneBackground: "",
      sceneCharacters: [],
    },
  } as never);
  await database.insert(questHistory).values({
    id: "farm-quest-history",
    userId: "farm-user",
    questId: "farm-quest",
    questType: "event",
  } as never);
};

const readFarmGoal = async () => {
  const database = await getTestDatabase();
  const row = await database.query.userData.findFirst({
    where: eq(userData.userId, "farm-user"),
  });
  return row?.questData
    ?.find((tracker) => tracker.id === "farm-quest")
    ?.goals.find((goal) => goal.id === "farm-goal");
};

describeWithDatabase("farming router guards against a real MySQL", () => {
  beforeEach(async () => {
    await resetTables(
      userSkill,
      skillTree,
      userQueue,
      farmCollectionLog,
      farmExtraction,
      farmPlot,
      userItem,
      item,
      questHistory,
      quest,
      userData,
    );
    const database = await getTestDatabase();
    await database.insert(item).values([cropItemRow(), seedItemRow()] as never);
  });

  it.each(["AWAKE", "ASLEEP"] as const)(
    "preserves crops and coins when %s loses sale eligibility",
    async (status) => {
      await farmer({ status, autoWakeUp: true });
      await giveItem("sale-stack", "crop-1", 3);
      const database = await getTestDatabase();
      const guarded = beforeStatements(database, userData, [
        async () => {
          await database
            .update(userData)
            .set({ status: "BATTLE", battleId: "sale-battle" })
            .where(eq(userData.userId, "farm-user"));
        },
      ]);
      const result = await callerForDatabase(
        farmingRouter,
        "farm-user",
        guarded,
      ).sellCrop({ userItemId: "sale-stack", quantity: 1 });
      expect(result.success).toBe(false);
      expect(result.actionNotice).toBeUndefined();
      expect(
        await database.query.userItem.findFirst({
          where: eq(userItem.id, "sale-stack"),
        }),
      ).toMatchObject({ quantity: 3 });
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, "farm-user"),
        }),
      ).toMatchObject({
        status: "BATTLE",
        battleId: "sale-battle",
        farmCurrency: 1000,
      });
    },
  );

  it.each(["AWAKE", "ASLEEP", "HOSPITALIZED"] as const)(
    "atomically sells the last %s crop stack with its recovery",
    async (status) => {
      await farmer({ status, autoWakeUp: true, curHealth: 100, maxHealth: 100 });
      await giveItem("sale-stack", "crop-1", 3);
      const database = await getTestDatabase();
      const measured = await recordQueries(() =>
        callerForDatabase(farmingRouter, "farm-user", database).sellCrop({
          userItemId: "sale-stack",
          quantity: 3,
        }),
      );
      expect(measured.result.success).toBe(true);
      expect(measured.result.userDelta).toEqual({ farmCurrency: 120 });
      expect(measured.result.actionNotice).toBe(
        status === "ASLEEP"
          ? AUTO_WAKE_MESSAGE
          : status === "HOSPITALIZED"
            ? AUTO_CHECKOUT_MESSAGE
            : undefined,
      );
      expect(
        measured.statements.filter((statement) =>
          /^\s*(update|delete)/i.test(statement),
        ),
      ).toHaveLength(1);
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, "farm-user"),
        }),
      ).toMatchObject({ status: "AWAKE", farmCurrency: 1120 });
      expect(
        await database.query.userItem.findFirst({
          where: eq(userItem.id, "sale-stack"),
        }),
      ).toMatchObject({ quantity: 0 });
      expect(
        await callerForDatabase(farmingRouter, "farm-user", database).sellCrop({
          userItemId: "sale-stack",
          quantity: 1,
        }),
      ).toMatchObject({ success: false });
    },
  );

  for (const bulk of [false, true]) {
    it.each(["AWAKE", "ASLEEP"] as const)(
      `preserves ${bulk ? "all" : "one"} ready plot when %s loses harvest eligibility`,
      async (status) => {
        await farmer({ status, autoWakeUp: true });
        const database = await getTestDatabase();
        await database.insert(farmPlot).values({
          id: "claim-plot",
          userId: "farm-user",
          slotIndex: 0,
          seedItemId: "seed-1",
          plantedAt: new Date(Date.now() - 120_000),
          finishAt: new Date(Date.now() - 60_000),
        });
        const guarded = beforeStatements(database, farmPlot, [
          async () => {
            await database
              .update(userData)
              .set({ status: "BATTLE", battleId: "harvest-battle" })
              .where(eq(userData.userId, "farm-user"));
          },
        ]);
        const api = callerForDatabase(farmingRouter, "farm-user", guarded);
        const result = bulk
          ? await api.harvestAll()
          : await api.harvestPlot({ plotId: "claim-plot" });
        expect(result.success).toBe(false);
        expect(result.actionNotice).toBeUndefined();
        expect(
          await database.query.farmPlot.findFirst({
            where: eq(farmPlot.id, "claim-plot"),
          }),
        ).toMatchObject({ seedItemId: "seed-1" });
        expect(await database.query.userItem.findMany()).toHaveLength(0);
        expect(await database.query.farmCollectionLog.findMany()).toHaveLength(0);
        expect(
          await database.query.userData.findFirst({
            where: eq(userData.userId, "farm-user"),
          }),
        ).toMatchObject({
          status: "BATTLE",
          battleId: "harvest-battle",
          farmingExperience: 0,
        });
      },
    );

    it(`retains earned ${bulk ? "bulk" : "single"} harvest XP after a committed recovery enters battle`, async () => {
      await farmer({
        status: "ASLEEP",
        autoWakeUp: true,
        isOutlaw: true,
        curEnergy: 50,
        regeneration: 0,
        regenAt: new Date(),
      });
      await queueEnergy("farm-user", [{ stat: "offence", energy: 40 }]);
      await activateFarmQuest("plants_harvested");
      const database = await getTestDatabase();
      const plotCount = bulk ? 2 : 1;
      await database.insert(farmPlot).values(
        Array.from({ length: plotCount }, (_, slotIndex) => ({
          id: `claim-plot-${slotIndex}`,
          userId: "farm-user",
          slotIndex,
          seedItemId: "seed-1",
          plantedAt: new Date(Date.now() - 120_000),
          finishAt: new Date(Date.now() - 60_000),
        })),
      );
      let experienceAfterClaim = 0;
      const guarded = beforeStatements(database, userData, [
        async () => {},
        async () => {
          experienceAfterClaim = (await database.query.userData.findFirst({
            where: eq(userData.userId, "farm-user"),
          }))!.experience;
          await database
            .update(userData)
            .set({ status: "BATTLE", battleId: "harvest-battle" })
            .where(eq(userData.userId, "farm-user"));
        },
      ]);
      const api = callerForDatabase(farmingRouter, "farm-user", guarded);
      const result = bulk
        ? await api.harvestAll()
        : await api.harvestPlot({ plotId: "claim-plot-0" });
      expect(result).toMatchObject({ success: true, actionNotice: AUTO_WAKE_MESSAGE });
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, "farm-user"),
        }),
      ).toMatchObject({
        status: "BATTLE",
        battleId: "harvest-battle",
        farmingExperience: 10 * plotCount,
        curEnergy: 10,
        energyQueueHead: 1,
        experience: experienceAfterClaim,
      });
      expect(experienceAfterClaim).toBeGreaterThan(0);
      expect((await readFarmGoal())?.value).toBe(plotCount);
      expect(
        await database.query.farmPlot.findFirst({
          where: eq(farmPlot.id, "claim-plot-0"),
        }),
      ).toMatchObject({ seedItemId: null });
      const crops = await database.query.userItem.findMany();
      expect(crops.reduce((sum, stack) => sum + stack.quantity, 0)).toBe(plotCount);
      expect(await database.query.farmCollectionLog.findMany()).toHaveLength(1);
    });
  }

  it("reports confirmed recovery when a partial bulk harvest claim rejects", async () => {
    await farmer({
      status: "ASLEEP",
      autoWakeUp: true,
      isOutlaw: true,
      curEnergy: 50,
      regeneration: 0,
      regenAt: new Date(),
    });
    await queueEnergy("farm-user", [{ stat: "offence", energy: 40 }]);
    const database = await getTestDatabase();
    await database.insert(farmPlot).values(
      [0, 1].map((slotIndex) => ({
        id: `partial-harvest-${slotIndex}`,
        userId: "farm-user",
        slotIndex,
        seedItemId: "seed-1",
        plantedAt: new Date(Date.now() - 120_000),
        finishAt: new Date(Date.now() - 60_000),
      })),
    );
    const guarded = beforeStatements(database, farmPlot, [
      async () => {
        await database
          .update(farmPlot)
          .set({ finishAt: new Date(Date.now() + 3_600_000) })
          .where(eq(farmPlot.id, "partial-harvest-0"));
      },
    ]);
    const result = await callerForDatabase(
      farmingRouter,
      "farm-user",
      guarded,
    ).harvestAll();
    expect(result).toMatchObject({ success: false, actionNotice: AUTO_WAKE_MESSAGE });
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, "farm-user"),
      }),
    ).toMatchObject({
      status: "AWAKE",
      curEnergy: 10,
      energyQueueHead: 1,
      farmingExperience: 0,
    });
    expect(await database.query.userItem.findMany()).toHaveLength(0);
  });

  for (const bulk of [false, true]) {
    it(`preserves ${bulk ? "all" : "one"} growing plot when recovery loses watering eligibility`, async () => {
      await farmer({ status: "ASLEEP", autoWakeUp: true });
      const database = await getTestDatabase();
      const finishAt = new Date(Date.now() + 3_600_000);
      await database.insert(farmPlot).values({
        id: "water-claim",
        userId: "farm-user",
        slotIndex: 0,
        seedItemId: "seed-1",
        plantedAt: new Date(),
        finishAt,
      });
      const guarded = beforeStatements(database, farmPlot, [
        async () => {
          await database
            .update(userData)
            .set({ status: "BATTLE", battleId: "water-battle" })
            .where(eq(userData.userId, "farm-user"));
        },
      ]);
      const api = callerForDatabase(farmingRouter, "farm-user", guarded);
      const result = bulk
        ? await api.waterAll()
        : await api.waterPlot({ plotId: "water-claim" });
      expect(result.success).toBe(false);
      expect(result.actionNotice).toBeUndefined();
      expect(
        await database.query.farmPlot.findFirst({
          where: eq(farmPlot.id, "water-claim"),
        }),
      ).toMatchObject({ finishAt, lastWateredAt: null });
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, "farm-user"),
        }),
      ).toMatchObject({
        status: "BATTLE",
        battleId: "water-battle",
        farmingExperience: 0,
      });
    });

    it(`retains earned ${bulk ? "bulk" : "single"} watering XP after committed recovery enters battle`, async () => {
      await farmer({
        status: "ASLEEP",
        autoWakeUp: true,
        isOutlaw: true,
        curEnergy: 50,
        regeneration: 0,
        regenAt: new Date(),
      });
      await queueEnergy("farm-user", [{ stat: "offence", energy: 40 }]);
      await activateFarmQuest("plants_watered");
      const database = await getTestDatabase();
      const plotCount = bulk ? 2 : 1;
      await database.insert(farmPlot).values(
        Array.from({ length: plotCount }, (_, slotIndex) => ({
          id: `water-claim-${slotIndex}`,
          userId: "farm-user",
          slotIndex,
          seedItemId: "seed-1",
          plantedAt: new Date(),
          finishAt: new Date(Date.now() + (slotIndex + 1) * 3_600_000),
        })),
      );
      let experienceAfterClaim = 0;
      const guarded = beforeStatements(database, userData, [
        async () => {},
        async () => {
          const claimedUser = (await database.query.userData.findFirst({
            where: eq(userData.userId, "farm-user"),
          }))!;
          experienceAfterClaim = claimedUser.experience;
          // Battle admission advances the account revision together with its activity.
          await database
            .update(userData)
            .set({
              status: "BATTLE",
              battleId: "water-battle",
              updatedAt: new Date(claimedUser.updatedAt.getTime() + 1),
            })
            .where(eq(userData.userId, "farm-user"));
        },
      ]);
      const api = callerForDatabase(farmingRouter, "farm-user", guarded);
      const result = bulk
        ? await api.waterAll()
        : await api.waterPlot({ plotId: "water-claim-0" });
      expect(result).toMatchObject({ success: true, actionNotice: AUTO_WAKE_MESSAGE });
      expect(result.userPatch).toBeUndefined();
      expect(result.userDelta).toBeUndefined();
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, "farm-user"),
        }),
      ).toMatchObject({
        status: "BATTLE",
        battleId: "water-battle",
        farmingExperience: FARM_WATER_EXPERIENCE * plotCount,
        curEnergy: 10,
        energyQueueHead: 1,
        experience: experienceAfterClaim,
      });
      expect(experienceAfterClaim).toBeGreaterThan(0);
      expect((await readFarmGoal())?.value).toBe(plotCount);
      const plots = await database.query.farmPlot.findMany();
      expect(plots.every((plot) => plot.lastWateredAt !== null)).toBe(true);
    });
  }

  it.each(["harvest", "water"] as const)(
    "checks out for free with the %s plot claim",
    async (action) => {
      await farmer({
        status: "HOSPITALIZED",
        autoWakeUp: false,
        curHealth: 100,
        maxHealth: 100,
      });
      const database = await getTestDatabase();
      await database.insert(farmPlot).values({
        id: "free-claim",
        userId: "farm-user",
        slotIndex: 0,
        seedItemId: "seed-1",
        plantedAt: new Date(Date.now() - 120_000),
        finishAt: new Date(Date.now() + (action === "water" ? 3_600_000 : -60_000)),
      });
      const api = callerForDatabase(farmingRouter, "farm-user", database);
      expect(
        action === "water"
          ? await api.waterPlot({ plotId: "free-claim" })
          : await api.harvestPlot({ plotId: "free-claim" }),
      ).toMatchObject({ success: true, actionNotice: AUTO_CHECKOUT_MESSAGE });
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, "farm-user"),
        }),
      ).toMatchObject({
        status: "AWAKE",
        money: expect.any(Number),
        farmCurrency: 1000,
      });
    },
  );

  it("retains queued training goals when recovery and watering advance the same quest", async () => {
    await farmer({
      status: "ASLEEP",
      autoWakeUp: true,
      isOutlaw: true,
      curEnergy: 50,
      regeneration: 0,
      regenAt: new Date(),
    });
    const database = await getTestDatabase();
    await queueEnergy("farm-user", [{ stat: "offence", energy: 40 }]);
    await database.insert(quest).values({
      id: "recovery-goals",
      name: "Training and watering",
      questType: "event",
      content: {
        objectives: [
          {
            id: "training-goal",
            task: "stats_trained",
            value: 1,
            nextObjectiveId: "watering-goal",
            description: "",
            successDescription: "",
          },
          {
            id: "watering-goal",
            task: "plants_watered",
            value: 10,
            description: "",
            successDescription: "",
          },
        ],
        reward: {},
        sceneBackground: "",
        sceneCharacters: [],
      },
    } as never);
    await database.insert(questHistory).values({
      id: "recovery-history",
      userId: "farm-user",
      questId: "recovery-goals",
      questType: "event",
    } as never);
    await database.insert(farmPlot).values({
      id: "recovery-plot",
      userId: "farm-user",
      slotIndex: 0,
      seedItemId: "seed-1",
      plantedAt: new Date(),
      finishAt: new Date(Date.now() + 3_600_000),
    });
    const result = await callerForDatabase(
      farmingRouter,
      "farm-user",
      database,
    ).waterPlot({ plotId: "recovery-plot" });
    expect(result).toMatchObject({ success: true, actionNotice: AUTO_WAKE_MESSAGE });
    const stored = (await database.query.userData.findFirst({
      where: eq(userData.userId, "farm-user"),
    }))!;
    expect(stored).toMatchObject({
      status: "AWAKE",
      curEnergy: 10,
      energyQueueHead: 1,
    });
    const goals = stored.questData?.find(
      (entry) => entry.id === "recovery-goals",
    )?.goals;
    expect(goals?.find((goal) => goal.id === "training-goal")?.value).toBeGreaterThan(
      0,
    );
    expect(goals?.find((goal) => goal.id === "watering-goal")?.value).toBe(1);
    expect(result.userPatch?.questData).toEqual(stored.questData);
    expect(result.userPatch?.updatedAt).toEqual(stored.updatedAt);
    expect(result.userDelta).toEqual({
      farmingExperience: result.farmingExperienceDelta,
    });
    expect(result.userRecovery?.userPatch).toMatchObject({
      status: "AWAKE",
      curEnergy: 10,
    });
  });

  it.each(["ASLEEP", "HOSPITALIZED"] as const)(
    "recovers %s in the guarded farm purchase",
    async (status) => {
      await farmer({
        status,
        autoWakeUp: true,
        curHealth: 100,
        maxHealth: 100,
        regenAt: new Date(),
        farmingExperience: 100_000_000,
      });
      const database = await getTestDatabase();
      const executed = await recordQueries(() =>
        callerForDatabase(farmingRouter, "farm-user", database).buyShopItem({
          type: "PLOT",
          quantity: 1,
        }),
      );
      expect(executed.result).toMatchObject({
        success: true,
        actionNotice: status === "ASLEEP" ? AUTO_WAKE_MESSAGE : AUTO_CHECKOUT_MESSAGE,
      });
      expect(
        executed.statements.filter((statement) => /^\s*update /i.test(statement)),
      ).toHaveLength(1);
      const stored = await database.query.userData.findFirst({
        where: eq(userData.userId, "farm-user"),
      });
      expect(stored).toMatchObject({
        status: "AWAKE",
        farmPlotsPurchased: 1,
        farmCurrency: 1000 - FARM_PLOT_PURCHASE_COST,
      });
    },
  );

  it.each([
    { status: "ASLEEP", autoWakeUp: false, curHealth: 100 },
    { status: "HOSPITALIZED", autoWakeUp: true, curHealth: 1 },
  ] as const)(
    "rejects an unavailable farm actor before purchases: %j",
    async (patch) => {
      await farmer({ ...patch, maxHealth: 100, regenAt: new Date() });
      const database = await getTestDatabase();
      const result = await callerForDatabase(
        farmingRouter,
        "farm-user",
        database,
      ).buyShopItem({ type: "PLOT", quantity: 1 });
      expect(result.success).toBe(false);
      expect(result.actionNotice).toBeUndefined();
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, "farm-user"),
        }),
      ).toMatchObject({
        status: patch.status,
        farmPlotsPurchased: 0,
        farmCurrency: 1000,
      });
    },
  );

  it.each(["water", "harvest", "first collection", "new stack"] as const)(
    "reconciles bulk %s against the canonical farm view",
    async (action) => {
      const now = new Date("2026-11-02T12:00:00Z");
      setSystemTime(now);
      try {
        await farmer({ farmingExperience: 1000 });
        const db = await getTestDatabase();
        await giveItem("existing-crop", "crop-1", action === "new stack" ? 50 : 2);
        if (action !== "first collection")
          await db.insert(farmCollectionLog).values({
            id: "collected-crop",
            userId: "farm-user",
            itemId: "crop-1",
            firstHarvestedAt: now,
          });
        await db.insert(farmPlot).values(
          [0, 1].map((slotIndex) => ({
            id: `bulk-${slotIndex}`,
            userId: "farm-user",
            slotIndex,
            seedItemId: "seed-1",
            plantedAt: new Date(now.getTime() - 120000),
            finishAt: new Date(now.getTime() + (action === "water" ? 3600000 : -60000)),
          })),
        );
        const api = await caller("farm-user"),
          before = await api.getFarmState();
        const result =
          action === "water" ? await api.waterAll() : await api.harvestAll();
        expect(result.success, result.message).toBe(true);
        const next = getFarmBulkMutationUpdate(
          before,
          result,
          action === "water" ? "water" : "harvest",
        );
        if (action === "first collection" || action === "new stack")
          expect(next).toBeUndefined();
        else {
          const canonical = await api.getFarmState();
          expect(next).toEqual(canonical);
        }
      } finally {
        setSystemTime();
      }
    },
  );

  it.each(["AWAKE", "ASLEEP"] as const)(
    "withholds bulk watering metadata when one plot loses its timeline CAS for %s",
    async (status) => {
      await farmer({ status, autoWakeUp: true });
      const db = await getTestDatabase(),
        finishAt = new Date(Date.now() + 3600000);
      await db.insert(farmPlot).values(
        [0, 1].map((slotIndex) => ({
          id: `partial-${slotIndex}`,
          slotIndex,
          userId: "farm-user",
          seedItemId: "seed-1",
          plantedAt: new Date(),
          finishAt,
        })),
      );
      const client = beforeStatements(db, farmPlot, [
        async () => {
          await db
            .update(farmPlot)
            .set({ finishAt: new Date(finishAt.getTime() + 60000) })
            .where(eq(farmPlot.id, "partial-0"));
        },
      ]);
      const result = await callerForDatabase(
        farmingRouter,
        "farm-user",
        client,
      ).waterAll();
      expect(result.success).toBe(true);
      expect(result.updatedPlots).toBeUndefined();
      expect(result.farmingExperienceDelta).toBeGreaterThan(0);
    },
  );

  for (const action of [
    "plantSeed",
    "plantAllEmpty",
    "applyFertilizer",
    "fertilizeAll",
  ] as const) {
    it(`${action} advances its own claimed quest snapshot without a guaranteed retry`, async () => {
      await farmer();
      const database = await getTestDatabase();
      const isPlanting = action === "plantSeed" || action === "plantAllEmpty";
      const isBulk = action === "plantAllEmpty" || action === "fertilizeAll";
      await activateFarmQuest(isPlanting ? "seeds_planted" : "plants_fertilized");
      await giveItem("ui-seed", "seed-1", 5);
      await database.insert(item).values(
        seedItemRow({
          id: "fert-1",
          name: "Compost",
          isFarmSeed: false,
          isFarmFertilizer: true,
          farmTimeReductionSeconds: 60,
          farmYieldItemId: null,
        }) as never,
      );
      await giveItem("ui-fert", "fert-1", 5);
      await database.insert(farmPlot).values(
        [0, 1].map((slotIndex) => ({
          id: `plot-${slotIndex}`,
          userId: "farm-user",
          slotIndex,
          ...(!isPlanting
            ? {
                seedItemId: "seed-1",
                plantedAt: new Date(),
                finishAt: new Date(Date.now() + 3_600_000),
              }
            : {}),
        })) as never,
      );
      const api = await caller("farm-user");
      const recorded = await recordQueries(() => {
        switch (action) {
          case "plantSeed":
            return api.plantSeed({ plotId: "plot-0", seedItemId: "seed-1" });
          case "plantAllEmpty":
            return api.plantAllEmpty({ seedItemId: "seed-1" });
          case "applyFertilizer":
            return api.applyFertilizer({ plotId: "plot-0", userItemId: "ui-fert" });
          case "fertilizeAll":
            return api.fertilizeAll({ userItemId: "ui-fert" });
        }
      });
      expect(recorded.result.success).toBe(true);
      expect((await readFarmGoal())?.value).toBe(isBulk ? 2 : 1);
      // A same-snapshot claim must not invalidate the quest JSON it just protected.
      const userReads = recorded.statements.filter(
        (statement) =>
          statement.startsWith("select") &&
          statement.includes("from `UserData`") &&
          !/\bavg\s*\(/i.test(statement),
      );
      expect(userReads).toHaveLength(1);
    });
  }

  for (const action of [
    "plantSeed",
    "plantAllEmpty",
    "applyFertilizer",
    "fertilizeAll",
  ] as const) {
    it.each([false, true])(
      `${action} uses activated skill requirements from the actor (activated=%s)`,
      async (activated) => {
        await farmer();
        const db = await getTestDatabase();
        const isPlanting = action === "plantSeed" || action === "plantAllEmpty";
        await db.insert(skillTree).values({
          id: "farm-required",
          name: "Farm Requirement",
          image: "/skill.png",
          description: "Farm requirement",
          effects: [],
        });
        await db.insert(userSkill).values({
          id: "farm-required-owned",
          userId: "farm-user",
          skillId: "farm-required",
          activated,
        });
        await db
          .update(item)
          .set({ requiredSkillId: "farm-required" })
          .where(eq(item.id, "seed-1"));
        await db.insert(item).values(
          seedItemRow({
            id: "fert-required",
            name: "Required Compost",
            isFarmSeed: false,
            isFarmFertilizer: true,
            requiredSkillId: "farm-required",
            farmTimeReductionSeconds: 60,
            farmYieldItemId: null,
          }) as never,
        );
        await giveItem("required-seed", "seed-1", 2);
        await giveItem("required-fertilizer", "fert-required", 2);
        await db.insert(farmPlot).values({
          id: "required-plot",
          userId: "farm-user",
          slotIndex: 0,
          ...(!isPlanting
            ? {
                seedItemId: "seed-1",
                plantedAt: new Date(),
                finishAt: new Date(Date.now() + 3_600_000),
              }
            : {}),
        });
        const api = callerForDatabase(farmingRouter, "farm-user", db);
        const result = await recordQueries(() => {
          switch (action) {
            case "plantSeed":
              return api.plantSeed({ plotId: "required-plot", seedItemId: "seed-1" });
            case "plantAllEmpty":
              return api.plantAllEmpty({ seedItemId: "seed-1" });
            case "applyFertilizer":
              return api.applyFertilizer({
                plotId: "required-plot",
                userItemId: "required-fertilizer",
              });
            case "fertilizeAll":
              return api.fertilizeAll({ userItemId: "required-fertilizer" });
          }
        });
        expect(result.result.success).toBe(activated);
        expect(
          result.statements.filter(
            (statement) =>
              statement.startsWith("select") &&
              statement.includes("from `UserSkill`") &&
              !statement.includes("from `UserData`"),
          ),
        ).toHaveLength(0);
        const stack = await db.query.userItem.findFirst({
          where: eq(userItem.id, isPlanting ? "required-seed" : "required-fertilizer"),
        });
        expect(stack?.quantity).toBe(activated ? 1 : 2);
        if (!activated)
          expect(result.result.message).toContain("Activate the required skill");
      },
    );
  }

  it("preserves quest progress when planting loses its actor snapshot", async () => {
    await farmer({
      questData: [
        {
          id: "farm-quest",
          goals: [{ id: "farm-goal", task: "seeds_planted", value: 1, done: false }],
        },
      ],
    });
    await activateFarmQuest("seeds_planted");
    await giveItem("ui-seed", "seed-1", 5);
    const database = await getTestDatabase();
    await database
      .insert(farmPlot)
      .values({ id: "plot-0", userId: "farm-user", slotIndex: 0 } as never);
    const client = beforeStatements(database, userData, [
      async () => {
        const current = (await database.query.userData.findFirst({
          where: eq(userData.userId, "farm-user"),
        }))!;
        await database
          .update(userData)
          .set({
            updatedAt: new Date(current.updatedAt.getTime() + 1),
            questData: [
              {
                id: "farm-quest",
                startAt: new Date().toISOString(),
                goals: [
                  {
                    id: "farm-goal",
                    value: 2,
                    done: false,
                    collected: false,
                    recentlyDied: false,
                  },
                ],
              },
            ],
          })
          .where(eq(userData.userId, "farm-user"));
      },
    ]);
    const result = await callerForDatabase(
      farmingRouter,
      "farm-user",
      client,
    ).plantSeed({ plotId: "plot-0", seedItemId: "seed-1" });
    expect(result.success).toBe(false);
    expect((await readFarmGoal())?.value).toBe(2);
    expect(
      await database.query.farmPlot.findFirst({ where: eq(farmPlot.id, "plot-0") }),
    ).toMatchObject({ seedItemId: null });
    expect(
      await database.query.userItem.findFirst({ where: eq(userItem.id, "ui-seed") }),
    ).toMatchObject({ quantity: 5 });
  });

  for (const isBulk of [false, true]) {
    it(`records a ${isBulk ? "bulk" : "single"} harvest without an unused collection recount`, async () => {
      await farmer();
      const database = await getTestDatabase();
      await database.insert(farmPlot).values({
        id: "plot-harvest",
        userId: "farm-user",
        slotIndex: 0,
        seedItemId: "seed-1",
        plantedAt: new Date(Date.now() - 120_000),
        finishAt: new Date(Date.now() - 60_000),
      } as never);
      const api = await caller("farm-user");
      const recorded = await recordQueries(() =>
        isBulk ? api.harvestAll() : api.harvestPlot({ plotId: "plot-harvest" }),
      );
      expect(recorded.result.success).toBe(true);
      expect(
        recorded.statements.filter(
          (statement) =>
            statement.startsWith("select") && statement.includes("FarmCollectionLog"),
        ),
      ).toHaveLength(0);
      expect(await database.select().from(farmCollectionLog)).toHaveLength(1);
    });
  }

  it("counts both concurrent first harvests for an unfinished collection objective", async () => {
    await farmer();
    await activateFarmQuest("farming_collection_log", 2);
    const database = await getTestDatabase();
    await database
      .insert(item)
      .values([
        cropItemRow({ id: "crop-2", name: "Second Crop" }),
        seedItemRow({ id: "seed-2", name: "Second Seed", farmYieldItemId: "crop-2" }),
      ] as never);
    await database.insert(farmPlot).values(
      [0, 1].map((slotIndex) => ({
        id: `plot-${slotIndex}`,
        userId: "farm-user",
        slotIndex,
        seedItemId: `seed-${slotIndex + 1}`,
        plantedAt: new Date(Date.now() - 120_000),
        finishAt: new Date(Date.now() - 60_000),
      })) as never,
    );
    const api = await caller("farm-user");
    const results = await Promise.all([
      api.harvestPlot({ plotId: "plot-0" }),
      api.harvestPlot({ plotId: "plot-1" }),
    ]);
    expect(results.every((result) => result.success)).toBe(true);
    expect((await readFarmGoal())?.value).toBe(2);
    expect((await readFarmGoal())?.done).toBe(true);
    expect(await database.select().from(farmCollectionLog)).toHaveLength(2);
  });

  it("skips the collection recount after its objective is complete", async () => {
    await farmer({
      questData: [
        {
          id: "farm-quest",
          goals: [
            { id: "farm-goal", task: "farming_collection_log", value: 1, done: true },
          ],
        },
      ],
    });
    await activateFarmQuest("farming_collection_log", 1);
    const database = await getTestDatabase();
    await database.insert(farmPlot).values({
      id: "plot-harvest",
      userId: "farm-user",
      slotIndex: 0,
      seedItemId: "seed-1",
      plantedAt: new Date(Date.now() - 120_000),
      finishAt: new Date(Date.now() - 60_000),
    } as never);
    const api = await caller("farm-user");
    const recorded = await recordQueries(() =>
      api.harvestPlot({ plotId: "plot-harvest" }),
    );
    expect(recorded.result.success).toBe(true);
    expect(
      recorded.statements.filter(
        (statement) =>
          statement.startsWith("select") && statement.includes("FarmCollectionLog"),
      ),
    ).toHaveLength(0);
    expect((await readFarmGoal())?.done).toBe(true);
    expect(await database.select().from(farmCollectionLog)).toHaveLength(1);
  });

  it("refuses to sell a farm seed for coins, so shop stock cannot be cashed back", async () => {
    await farmer();
    await giveItem("ui-seed", "seed-1", 3);
    const api = await caller("farm-user");
    const result = await api.sellCrop({ userItemId: "ui-seed", quantity: 1 });
    expect(result.success).toBe(false);
    const database = await getTestDatabase();
    const [stack] = await database
      .select()
      .from(userItem)
      .where(eq(userItem.id, "ui-seed"));
    expect(stack?.quantity).toBe(3);
    const [user] = await database
      .select()
      .from(userData)
      .where(eq(userData.userId, "farm-user"));
    expect(user?.farmCurrency).toBe(1000);
  });

  it("keeps hidden shop items unbuyable even when their id is supplied directly", async () => {
    await farmer();
    const database = await getTestDatabase();
    await database.update(item).set({ hidden: true }).where(eq(item.id, "seed-1"));
    const api = await caller("farm-user");
    const result = await api.buyShopItem({
      type: "SEED",
      itemId: "seed-1",
      quantity: 1,
    });
    expect(result.success).toBe(false);
    const rows = await database.select().from(userItem);
    expect(rows).toHaveLength(0);
  });

  it("reaches exactly the plot ceiling and refuses the purchase past it", async () => {
    const maxPurchases = FARM_MAX_PLOTS - FARM_STARTING_PLOTS;
    await farmer({
      farmingExperience: 100_000_000,
      farmCurrency: FARM_PLOT_PURCHASE_COST * (maxPurchases + 1),
      farmPlotsPurchased: maxPurchases - 1,
    });
    const api = await caller("farm-user");
    const last = await api.buyShopItem({ type: "PLOT", quantity: 1 });
    expect(last.success).toBe(true);
    const database = await getTestDatabase();
    const [user] = await database
      .select()
      .from(userData)
      .where(eq(userData.userId, "farm-user"));
    expect(FARM_STARTING_PLOTS + (user?.farmPlotsPurchased ?? 0)).toBe(FARM_MAX_PLOTS);
    const beyond = await api.buyShopItem({ type: "PLOT", quantity: 1 });
    expect(beyond.success).toBe(false);
  });

  it("pays out once when the same ready plot is harvested twice at the same moment", async () => {
    await farmer();
    const database = await getTestDatabase();
    await database.insert(farmPlot).values({
      id: "plot-1",
      userId: "farm-user",
      slotIndex: 0,
      seedItemId: "seed-1",
      plantedAt: new Date(Date.now() - 120_000),
      finishAt: new Date(Date.now() - 60_000),
    } as never);
    const api = await caller("farm-user");
    // The plot row is the only thing serialising these two callers; without the
    // compare-and-swap on finishAt both would clear it and both would grant a crop.
    const [first, second] = await Promise.all([
      api.harvestPlot({ plotId: "plot-1" }),
      api.harvestPlot({ plotId: "plot-1" }),
    ]);
    expect([first.success, second.success].filter(Boolean)).toHaveLength(1);
    const crops = await database
      .select()
      .from(userItem)
      .where(eq(userItem.itemId, "crop-1"));
    expect(crops.reduce((sum, row) => sum + row.quantity, 0)).toBe(1);
  });

  it("plants the first empty plots the seed stack covers when it cannot cover all", async () => {
    await farmer();
    await giveItem("ui-seed", "seed-1", 2);
    const database = await getTestDatabase();
    await database.insert(farmPlot).values(
      [4, 2, 0, 3, 1].map((slotIndex) => ({
        id: `plot-${slotIndex}`,
        userId: "farm-user",
        slotIndex,
      })) as never,
    );
    const api = await caller("farm-user");
    const result = await api.plantAllEmpty({ seedItemId: "seed-1" });
    expect(result.success).toBe(true);
    expect(result.inventoryDeltas).toEqual([{ itemId: "seed-1", quantityDelta: -2 }]);
    const plots = await database
      .select()
      .from(farmPlot)
      .where(eq(farmPlot.userId, "farm-user"));
    expect(
      plots
        .filter((plot) => plot.seedItemId)
        .map((plot) => plot.slotIndex)
        .sort(),
    ).toEqual([0, 1]);
    const seeds = await database
      .select()
      .from(userItem)
      .where(eq(userItem.itemId, "seed-1"));
    expect(seeds.reduce((sum, row) => sum + row.quantity, 0)).toBe(0);
  });

  it("fertilizes the first growing plots the fertilizer stack covers when it cannot cover all", async () => {
    await farmer();
    const database = await getTestDatabase();
    await database.insert(item).values(
      seedItemRow({
        id: "fert-1",
        name: "Compost",
        isFarmSeed: false,
        isFarmFertilizer: true,
        farmTimeReductionSeconds: 60,
        farmYieldItemId: null,
      }) as never,
    );
    await giveItem("ui-fert", "fert-1", 1);
    await database.insert(farmPlot).values(
      [2, 0, 1].map((slotIndex) => ({
        id: `plot-${slotIndex}`,
        userId: "farm-user",
        slotIndex,
        seedItemId: "seed-1",
        plantedAt: new Date(),
        finishAt: new Date(Date.now() + 3_600_000),
      })) as never,
    );
    const api = await caller("farm-user");
    const result = await api.fertilizeAll({ userItemId: "ui-fert" });
    expect(result.success).toBe(true);
    const plots = await database
      .select()
      .from(farmPlot)
      .where(eq(farmPlot.userId, "farm-user"));
    expect(
      plots.filter((plot) => plot.fertilizerApplied).map((plot) => plot.slotIndex),
    ).toEqual([0]);
    const fertilizer = await database
      .select()
      .from(userItem)
      .where(eq(userItem.itemId, "fert-1"));
    expect(fertilizer.reduce((sum, row) => sum + row.quantity, 0)).toBe(0);
  });

  it.each(["single", "bulk"] as const)(
    "snapshots the same per-crop passive reduction for %s planting and previews",
    async (mode) => {
      await farmer({ federalStatus: "GOLD" });
      const db = await getTestDatabase();
      await db.insert(skillTree).values({
        id: "farm-skill",
        name: "Farm Skill",
        image: "/skill.png",
        description: "Farm skill",
        effects: [DecreaseFarmingTime.parse({ power: 5 })],
      });
      await db.insert(userSkill).values({
        id: "farm-skill-owned",
        userId: "farm-user",
        skillId: "farm-skill",
        activated: true,
      });
      await giveItem("ui-seed", "seed-1", 10);
      // Farm-shop seeds are excluded from the regular item shop.
      await db.update(item).set({ inShop: false }).where(eq(item.id, "seed-1"));
      await insertItems([
        {
          id: "farm-gear",
          itemType: "ARMOR",
          maxDurability: 100,
          effects: [DecreaseFarmingTime.parse({ power: 10 })],
        },
      ]);
      await insertUserItems([
        {
          id: "farm-gear-owned",
          itemId: "farm-gear",
          userId: "farm-user",
          equipped: "CHEST",
          durability: 100,
        },
      ]);
      const api = await caller("farm-user");
      const preview = await api.getFarmState();
      const player = await db.query.userData.findFirst({
        where: eq(userData.userId, "farm-user"),
      });
      const seconds = getFarmGrowTimeSeconds(60, player!, 15);
      expect(preview.availableSeeds[0]?.growTimeSeconds).toBe(seconds);
      expect(
        preview.shopEntries.find((entry) => entry.itemId === "seed-1")?.growTimeSeconds,
      ).toBe(seconds);
      const result =
        mode === "single"
          ? await api.plantSeed({ plotId: preview.plots[0]!.id, seedItemId: "seed-1" })
          : await api.plantAllEmpty({ seedItemId: "seed-1" });
      expect(result.success).toBe(true);
      const planted = (await db.query.farmPlot.findMany()).filter(
        (plot) => plot.seedItemId,
      );
      expect(planted).toHaveLength(mode === "single" ? 1 : FARM_STARTING_PLOTS);
      for (const plot of planted)
        expect(plot.finishAt!.getTime() - plot.plantedAt!.getTime()).toBe(
          seconds * 1000,
        );
      await db
        .update(userItem)
        .set({ equipped: "NONE" })
        .where(eq(userItem.id, "farm-gear-owned"));
      const refreshed = await api.getFarmState();
      for (const plot of planted)
        expect(refreshed.plots.find((entry) => entry.id === plot.id)?.finishAt).toEqual(
          plot.finishAt,
        );
    },
  );

  it("plants a seed and returns the prefetched yield on the updated plot", async () => {
    await farmer();
    await giveItem("ui-seed", "seed-1", 2);
    const database = await getTestDatabase();
    await database.insert(farmPlot).values({
      id: "plot-plant",
      userId: "farm-user",
      slotIndex: 0,
    } as never);
    const api = await caller("farm-user");
    const result = await api.plantSeed({ plotId: "plot-plant", seedItemId: "seed-1" });
    expect(result.success).toBe(true);
    expect(result.updatedPlot?.cropName).toBe("Test Crop");
    expect(result.updatedPlot?.cropImage).toBe("/crop.png");
    expect(result.updatedPlot?.harvestExperience).toBe(10);
    expect(result.updatedPlot?.seedItemId).toBe("seed-1");
    const [stack] = await database
      .select()
      .from(userItem)
      .where(eq(userItem.id, "ui-seed"));
    expect(stack?.quantity).toBe(1);
    const [plot] = await database
      .select()
      .from(farmPlot)
      .where(eq(farmPlot.id, "plot-plant"));
    expect(plot?.seedItemId).toBe("seed-1");
    expect(plot?.finishAt).toBeTruthy();
  });

  it("resolves planted crop names without querying beyond the overlapped yield catalog", async () => {
    await farmer();
    await giveItem("ui-seed", "seed-1", 1);
    const database = await getTestDatabase();
    await database.insert(farmPlot).values(
      Array.from({ length: FARM_STARTING_PLOTS }, (_, slotIndex) => ({
        id: `plot-${slotIndex}`,
        userId: "farm-user",
        slotIndex,
        seedItemId: "seed-1",
        plantedAt: new Date(),
        finishAt: new Date(Date.now() + 60_000),
      })) as never,
    );
    const api = await caller("farm-user");
    const recorded = await recordQueries(() => api.getFarmState());
    const state = recorded.result;
    expect(state.plots.find((plot) => plot.id === "plot-0")?.cropName).toBe(
      "Test Crop",
    );
    expect(
      state.availableSeeds.find((seed) => seed.itemId === "seed-1")?.yieldName,
    ).toBe("Test Crop");
    expect(recorded.statements).toHaveLength(11);
  });

  it("completes yields changed after the catalog read before clearing orphaned crops", async () => {
    await farmer();
    const database = await getTestDatabase();
    await database
      .insert(item)
      .values([
        cropItemRow({ id: "crop-2", name: "Planted Crop" }),
        cropItemRow({ id: "crop-3", name: "Inventory Crop" }),
        cropItemRow({ id: "crop-4", name: "Shop Crop" }),
        seedItemRow({ id: "seed-inventory", name: "Inventory Seed" }),
        seedItemRow({ id: "seed-shop", name: "Shop Seed", inShop: false }),
        seedItemRow({ id: "seed-missing", name: "Missing Yield Seed" }),
      ] as never);
    await giveItem("ui-inventory", "seed-inventory", 2);
    const plantedAt = new Date(Date.now() - 30_000);
    const finishAt = new Date(Date.now() + 30_000);
    await database.insert(farmPlot).values(
      Array.from({ length: FARM_STARTING_PLOTS }, (_, slotIndex) => ({
        id: `plot-${slotIndex}`,
        userId: "farm-user",
        slotIndex,
        ...(slotIndex < 2
          ? {
              seedItemId: slotIndex === 0 ? "seed-1" : "seed-missing",
              plantedAt,
              finishAt,
            }
          : {}),
      })) as never,
    );

    const { promise: catalogUpdated, resolve: releaseReads } = deferred<void>();
    let catalogRead = false;
    let completionReads = 0;
    const waitForCatalog = async <Result>(read: () => PromiseLike<Result>) => {
      await catalogUpdated;
      return read();
    };
    const skewed = overrideQuery(
      overrideQuery(
        overrideQuery(database, "item", {
          findMany: async (read, args) => {
            if (args?.with?.farmYieldItem) {
              // Read the old catalog, then let the independently loaded references see
              // staff's reassignment. None of the new crops has another seed reference.
              const catalog = await read(args);
              catalogRead = true;
              await Promise.all(
                Object.entries({
                  "seed-1": "crop-2",
                  "seed-inventory": "crop-3",
                  "seed-shop": "crop-4",
                  "seed-missing": "missing-crop",
                }).map(([seedId, yieldId]) =>
                  database
                    .update(item)
                    .set({ farmYieldItemId: yieldId })
                    .where(eq(item.id, seedId)),
                ),
              );
              releaseReads();
              return catalog;
            }
            await catalogUpdated;
            if (!args?.columns && !args?.orderBy) completionReads += 1;
            return read(args);
          },
        }),
        "farmPlot",
        { findMany: (read, args) => waitForCatalog(() => read(args)) },
      ),
      "userItem",
      { findMany: (read, args) => waitForCatalog(() => read(args)) },
    );
    const api = callerForDatabase(farmingRouter, "farm-user", skewed);
    const recorded = await recordQueries(() => api.getFarmState());
    const state = recorded.result;
    expect(catalogRead).toBe(true);
    expect(state.plots.find((plot) => plot.id === "plot-0")?.cropName).toBe(
      "Planted Crop",
    );
    expect(
      state.availableSeeds.find((seed) => seed.itemId === "seed-inventory")?.yieldName,
    ).toBe("Inventory Crop");
    expect(
      state.shopEntries.find((entry) => entry.itemId === "seed-shop")?.yieldName,
    ).toBe("Shop Crop");
    expect(completionReads).toBe(1);
    expect(
      recorded.statements.filter((statement) =>
        statement.startsWith("update `FarmPlot`"),
      ),
    ).toHaveLength(1);
    const plots = await database.query.farmPlot.findMany({
      where: eq(farmPlot.userId, "farm-user"),
    });
    const planted = plots.find((plot) => plot.id === "plot-0");
    expect(planted?.seedItemId).toBe("seed-1");
    expect(planted?.plantedAt?.getTime()).toBe(plantedAt.getTime());
    expect(planted?.finishAt?.getTime()).toBe(finishAt.getTime());
    const orphaned = plots.find((plot) => plot.id === "plot-1");
    expect(orphaned?.seedItemId).toBeNull();
    expect(orphaned?.plantedAt).toBeNull();
    expect(orphaned?.finishAt).toBeNull();
    expect(state.plots.find((plot) => plot.id === "plot-1")?.seedItemId).toBeNull();
  });

  it("grants every distinct crop exactly once when a mixed harvest is settled together", async () => {
    await farmer();
    const database = await getTestDatabase();
    // A second seed/crop pair so harvestAll has to fan out over two different stacks.
    await database
      .insert(item)
      .values([
        cropItemRow({ id: "crop-2", name: "Second Crop" }),
        seedItemRow({ id: "seed-2", name: "Second Seed", farmYieldItemId: "crop-2" }),
      ] as never);
    const ripe = (id: string, slotIndex: number, seedItemId: string) => ({
      id,
      userId: "farm-user",
      slotIndex,
      seedItemId,
      plantedAt: new Date(Date.now() - 120_000),
      finishAt: new Date(Date.now() - 60_000),
    });
    await database
      .insert(farmPlot)
      .values([
        ripe("plot-a", 0, "seed-1"),
        ripe("plot-b", 1, "seed-1"),
        ripe("plot-c", 2, "seed-2"),
      ] as never);
    const api = await caller("farm-user");
    const result = await api.harvestAll();
    expect(result.success).toBe(true);
    const totalFor = async (itemId: string) =>
      (
        await database.select().from(userItem).where(eq(userItem.itemId, itemId))
      ).reduce((sum, row) => sum + row.quantity, 0);
    expect(await totalFor("crop-1")).toBe(2);
    expect(await totalFor("crop-2")).toBe(1);
    const plots = await database
      .select()
      .from(farmPlot)
      .where(eq(farmPlot.userId, "farm-user"));
    expect(plots.every((plot) => plot.seedItemId === null)).toBe(true);
  });

  it("keeps farm produce out of the ryo item shop", async () => {
    await farmer({ money: 10_000, villageId: null });
    const database = await getTestDatabase();
    // A crop priced in farm coins but flagged for the ryo shop: buying it for ryo and
    // selling it at the farm would mint farm currency out of the ryo economy.
    await database
      .update(item)
      .set({ inShop: true, cost: 1 })
      .where(eq(item.id, "crop-1"));
    const shop = await callerFor(itemRouter, "farm-user");
    const result = await shop.buy({
      itemId: "crop-1",
      stack: 1,
      villageId: null,
    } as never);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/farm/i);
  });

  it("refuses a fertilizer stack that is stored at home", async () => {
    await farmer();
    const database = await getTestDatabase();
    await database.insert(item).values(
      seedItemRow({
        id: "fert-1",
        name: "Compost",
        isFarmSeed: false,
        isFarmFertilizer: true,
        farmTimeReductionSeconds: 600,
        farmYieldItemId: null,
      }) as never,
    );
    await database.insert(userItem).values({
      id: "ui-fert",
      userId: "farm-user",
      itemId: "fert-1",
      quantity: 2,
      equipped: "NONE",
      storedAtHome: true,
    } as never);
    const finishAt = new Date(Date.now() + 3_600_000);
    await database.insert(farmPlot).values({
      id: "plot-f",
      userId: "farm-user",
      slotIndex: 0,
      seedItemId: "seed-1",
      plantedAt: new Date(Date.now() - 60_000),
      finishAt,
    } as never);
    const api = await caller("farm-user");
    const result = await api.applyFertilizer({
      plotId: "plot-f",
      userItemId: "ui-fert",
    });
    expect(result.success).toBe(false);
    const [stack] = await database
      .select()
      .from(userItem)
      .where(eq(userItem.id, "ui-fert"));
    expect(stack?.quantity).toBe(2);
    const [plot] = await database
      .select()
      .from(farmPlot)
      .where(eq(farmPlot.id, "plot-f"));
    expect(plot?.fertilizerApplied).toBe(false);
    expect(plot?.finishAt?.getTime()).toBe(finishAt.getTime());
  });

  it("does not let a stale watering overwrite a timer that moved underneath it", async () => {
    await farmer();
    const database = await getTestDatabase();
    const original = new Date(Date.now() + 3_600_000);
    const moved = new Date(original.getTime() - 600_000);
    await database.insert(farmPlot).values({
      id: "plot-w",
      userId: "farm-user",
      slotIndex: 0,
      seedItemId: "seed-1",
      plantedAt: new Date(Date.now() - 60_000),
      finishAt: moved,
    } as never);

    // Stand in for a request that read the plot before something else pulled the timer in:
    // reads answer with the pre-move row, writes go to the real database.
    const stalePlot = {
      id: "plot-w",
      userId: "farm-user",
      slotIndex: 0,
      seedItemId: "seed-1",
      plantedAt: new Date(Date.now() - 60_000),
      finishAt: original,
      lastWateredAt: null,
      fertilizerApplied: false,
      seedItem: null,
      yieldItem: null,
    };
    const staleClient = overrideQuery(database, "farmPlot", {
      findFirst: async () => stalePlot,
      findMany: async () => [stalePlot],
    });
    const api = callerForDatabase(farmingRouter, "farm-user", staleClient);

    const result = await api.waterPlot({ plotId: "plot-w" });

    // The reduction was derived from `original`; applying it would resurrect the longer timer.
    expect(result.success).toBe(false);
    const [plot] = await database
      .select()
      .from(farmPlot)
      .where(eq(farmPlot.id, "plot-w"));
    expect(plot?.finishAt?.getTime()).toBe(moved.getTime());
    expect(plot?.lastWateredAt).toBeNull();
  });

  it("keeps both watering goals when the initial actor snapshot is stale", async () => {
    await farmer();
    const database = await getTestDatabase();
    await database.insert(quest).values({
      id: "farm-quest",
      name: "Water the field",
      questType: "event",
      content: {
        objectives: [
          {
            id: "water-goal",
            task: "plants_watered",
            value: 2,
            description: "",
            successDescription: "",
          },
        ],
        reward: {},
        sceneBackground: "",
        sceneCharacters: [],
      },
    } as never);
    await database.insert(questHistory).values({
      id: "farm-quest-history",
      userId: "farm-user",
      questId: "farm-quest",
      questType: "event",
    } as never);
    await database.insert(farmPlot).values(
      [0, 1].map((slotIndex) => ({
        id: `plot-q${slotIndex}`,
        userId: "farm-user",
        slotIndex,
        seedItemId: "seed-1",
        plantedAt: new Date(Date.now() - 60_000),
        finishAt: new Date(Date.now() + 3_600_000),
      })) as never,
    );

    const staleActor = await fetchActionUser(database, "farm-user");

    const first = await (await caller("farm-user")).waterPlot({ plotId: "plot-q0" });
    expect(first.success).toBe(true);

    // The opening actor read is stale; quest-CAS retries must load current trackers.
    let skewServed = false;
    const skewedClient = overrideQuery(database, "userData", {
      findFirst: async (read, args) => {
        if (!args?.columns && !skewServed) {
          skewServed = true;
          return staleActor;
        }
        return await read(args);
      },
    });
    const skewed = callerForDatabase(farmingRouter, "farm-user", skewedClient);

    const second = await skewed.waterPlot({ plotId: "plot-q1" });
    expect(second.success).toBe(true);
    expect(skewServed).toBe(true);

    // Both waterings have to survive: the stale document would otherwise be written back
    // over the first one, because it arrived carrying a timestamp the CAS accepted.
    const [row] = await database
      .select()
      .from(userData)
      .where(eq(userData.userId, "farm-user"));
    const goal = (
      row?.questData as { id: string; goals: { id: string; value: number }[] }[]
    )
      ?.find((tracker) => tracker.id === "farm-quest")
      ?.goals.find((entry) => entry.id === "water-goal");
    expect(goal?.value).toBe(2);
    expect(second.userPatch?.questData).toEqual(row?.questData);
    expect(second.userDelta).toEqual({ farmingExperience: FARM_WATER_EXPERIENCE });
    expect(row?.farmingExperience).toBe(FARM_WATER_EXPERIENCE * 2);
  });

  it("settles a finished extraction once when two reads race to award it", async () => {
    await farmer();
    const database = await getTestDatabase();
    await giveItem("ui-seed-stack", "seed-1", 49);
    await database.insert(farmExtraction).values({
      id: "extraction-1",
      userId: "farm-user",
      extractorSlot: 0,
      cropItemId: "crop-1",
      seedItemId: "seed-1",
      cropQuantity: 1,
      seedQuantity: 1,
      startedAt: new Date(Date.now() - 120_000),
      finishAt: new Date(Date.now() - 60_000),
    } as never);
    const finished = await database.query.farmExtraction.findFirst({
      where: eq(farmExtraction.id, "extraction-1"),
      with: { cropItem: true, seedItem: true },
    });

    const settled = await (await caller("farm-user")).getFarmState();
    expect(settled).toBeTruthy();
    if (!("availableSeeds" in settled)) throw new Error("Expected farm state");
    expect(
      settled.availableSeeds.find((seed) => seed.itemId === "seed-1")?.quantity,
    ).toBe(50);

    // A concurrent request that read the extraction before the settling delete removed it.
    const staleClient = overrideQuery(database, "farmExtraction", {
      findMany: async () => [finished],
      findFirst: async () => finished,
    });
    await callerForDatabase(farmingRouter, "farm-user", staleClient).getFarmState();

    // One extraction, one payout: awarding before claiming mints a seed and, at the
    // material cap, an extra inventory row alongside the full stack.
    const stacks = await database
      .select()
      .from(userItem)
      .where(eq(userItem.itemId, "seed-1"));
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.quantity).toBe(50);
    const remaining = await database.select().from(farmExtraction);
    expect(remaining).toHaveLength(0);
  });

  it("counts seeds already promised by the other extractors when admitting a job", async () => {
    await farmer({ farmExtractorsOwned: 2 });
    const database = await getTestDatabase();
    // Materials sit exactly at the cap, with one seed of room left in the existing stack.
    const fillers = Array.from({ length: 23 }, (_, index) =>
      cropItemRow({ id: `filler-${index}`, name: `Filler ${index}` }),
    );
    await database.insert(item).values(fillers as never);
    await database.insert(userItem).values(
      fillers.map((filler, index) => ({
        id: `ui-filler-${index}`,
        userId: "farm-user",
        itemId: filler.id,
        quantity: 1,
        equipped: "NONE",
      })) as never,
    );
    await database
      .update(item)
      .set({ farmExtractSeedItemId: "seed-1", farmExtractSeedCount: 1 })
      .where(eq(item.id, "crop-1"));
    await giveItem("ui-crop", "crop-1", 2);
    await giveItem("ui-seed-stack", "seed-1", 49);
    const api = await caller("farm-user");

    const first = await api.extractSeeds({
      extractorSlot: 0,
      userItemId: "ui-crop",
      quantity: 1,
    });
    expect(first.success).toBe(true);

    // The first extractor is already holding the one seed that fits. Sizing this job
    // against the inventory alone admits it, and both land on a full stack at settlement.
    const second = await api.extractSeeds({
      extractorSlot: 1,
      userItemId: "ui-crop",
      quantity: 1,
    });
    expect(second.success).toBe(false);
    expect(second.message).toContain("Materials inventory is full");
    expect(await database.select().from(farmExtraction)).toHaveLength(1);
  });

  it("keeps the crop when another extraction takes the slot first", async () => {
    await farmer({ farmExtractorsOwned: 1 });
    const database = await getTestDatabase();
    await database
      .update(item)
      .set({ farmExtractSeedItemId: "seed-1", farmExtractSeedCount: 1 })
      .where(eq(item.id, "crop-1"));
    await giveItem("ui-crop", "crop-1", 2);
    const rival = {
      id: "rival-extraction",
      userId: "farm-user",
      extractorSlot: 0,
      cropItemId: "crop-1",
      seedItemId: "seed-1",
      cropQuantity: 1,
      seedQuantity: 1,
      startedAt: new Date(),
      finishAt: new Date(Date.now() + 60_000),
    };
    const raced = beforeStatements(
      database,
      farmExtraction,
      [() => database.insert(farmExtraction).values(rival)],
      { operations: ["insert"] },
    );
    const result = await callerForDatabase(
      farmingRouter,
      "farm-user",
      raced,
    ).extractSeeds({
      extractorSlot: 0,
      userItemId: "ui-crop",
      quantity: 1,
    });
    expect(result).toMatchObject({
      success: false,
      message: "Seed extractor 1 is already processing crops",
    });
    expect(
      await database.select({ id: farmExtraction.id }).from(farmExtraction),
    ).toEqual([{ id: "rival-extraction" }]);
    expect(
      await database.query.userItem.findFirst({ where: eq(userItem.id, "ui-crop") }),
    ).toMatchObject({ quantity: 2 });
  });

  it("merges two extractions of the same seed into one stack", async () => {
    await farmer();
    const database = await getTestDatabase();
    await giveItem("ui-seed-stack", "seed-1", 48);
    await database.insert(farmExtraction).values(
      [0, 1].map((extractorSlot) => ({
        id: `extraction-${extractorSlot}`,
        userId: "farm-user",
        extractorSlot,
        cropItemId: "crop-1",
        seedItemId: "seed-1",
        cropQuantity: 1,
        seedQuantity: 1,
        startedAt: new Date(Date.now() - 120_000),
        finishAt: new Date(Date.now() - 60_000),
      })) as never,
    );

    await (await caller("farm-user")).getFarmState();

    // Both extractions are valid and both must pay, but they share one inventory snapshot.
    // Granted separately, each measures the same 48-seed stack and the second opens a row
    // for a seed that belonged in the first.
    const stacks = await database
      .select()
      .from(userItem)
      .where(eq(userItem.itemId, "seed-1"));
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.quantity).toBe(50);
    expect(await database.select().from(farmExtraction)).toHaveLength(0);
  });

  it("fills the real stack when the inventory snapshot went stale under it", async () => {
    await farmer();
    const database = await getTestDatabase();
    await giveItem("ui-seed-stack", "seed-1", 48);
    await database.insert(farmExtraction).values({
      id: "extraction-s",
      userId: "farm-user",
      extractorSlot: 0,
      cropItemId: "crop-1",
      seedItemId: "seed-1",
      cropQuantity: 1,
      seedQuantity: 2,
      startedAt: new Date(Date.now() - 120_000),
      finishAt: new Date(Date.now() - 60_000),
    } as never);

    // Stand in for a grant that landed on this stack after settlement read its snapshot.
    // Aggregation cannot help here -- the staleness comes from another request.
    const staleClient = overrideQuery(database, "userItem", {
      findMany: async (read, args) =>
        (await read(args)).map((row) => ({ ...row, quantity: 40 })),
    });
    await callerForDatabase(farmingRouter, "farm-user", staleClient).getFarmState();

    // The two seeds belong in the existing stack. Opening a row for them because the
    // snapshot said 40 puts the player a row closer to the cap for nothing.
    const stacks = await database
      .select()
      .from(userItem)
      .where(eq(userItem.itemId, "seed-1"));
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.quantity).toBe(50);
  });

  it("holds a payout that would open a row past the material cap", async () => {
    await farmer();
    const database = await getTestDatabase();
    // Fill materials to the cap: 24 filler rows plus a seed stack one short of full.
    const fillers = Array.from({ length: 24 }, (_, index) =>
      cropItemRow({ id: `filler-${index}`, name: `Filler ${index}` }),
    );
    await database.insert(item).values(fillers as never);
    await database.insert(userItem).values(
      fillers.map((filler, index) => ({
        id: `ui-filler-${index}`,
        userId: "farm-user",
        itemId: filler.id,
        quantity: 1,
        equipped: "NONE",
      })) as never,
    );
    await giveItem("ui-seed-stack", "seed-1", 49);
    await database.insert(farmExtraction).values(
      [0, 1].map((extractorSlot) => ({
        id: `extraction-${extractorSlot}`,
        userId: "farm-user",
        extractorSlot,
        cropItemId: "crop-1",
        seedItemId: "seed-1",
        cropQuantity: 1,
        seedQuantity: 1,
        startedAt: new Date(Date.now() - 120_000),
        finishAt: new Date(Date.now() - 60_000),
      })) as never,
    );

    const state = await (await caller("farm-user")).getFarmState();

    // 25 rows is the cap and the two seeds need a 26th. Nothing may be spent to get there:
    // the seeds stay in the extractors, which keep showing them, until space is freed.
    expect(await database.select().from(userItem)).toHaveLength(25);
    const [stack] = await database
      .select()
      .from(userItem)
      .where(eq(userItem.id, "ui-seed-stack"));
    expect(stack?.quantity).toBe(49);
    const held = await database.select().from(farmExtraction);
    expect(held).toHaveLength(2);
    expect(held.every((row) => row.claimedAt === null)).toBe(true);
    expect(
      (state as { activeSeedExtractions: unknown[] }).activeSeedExtractions,
    ).toHaveLength(2);
  });

  it("does not pay twice when the delete fails and the claim later goes stale", async () => {
    await farmer();
    const database = await getTestDatabase();
    await database.insert(farmExtraction).values({
      id: "extraction-d",
      userId: "farm-user",
      extractorSlot: 0,
      cropItemId: "crop-1",
      seedItemId: "seed-1",
      cropQuantity: 1,
      seedQuantity: 3,
      startedAt: new Date(Date.now() - 120_000),
      finishAt: new Date(Date.now() - 60_000),
    } as never);

    // The seed grant commits, then the delete of the settled row fails transiently.
    const failingDelete = failStatements(database, farmExtraction, Infinity, {
      operations: ["delete"],
    });
    await callerForDatabase(farmingRouter, "farm-user", failingDelete).getFarmState();

    const [afterGrant] = await database.select().from(farmExtraction);
    expect(afterGrant).toBeDefined();
    expect(afterGrant?.settledAt).not.toBeNull();
    expect((await database.select().from(userItem))[0]?.quantity).toBe(3);

    // Age the claim past the takeover window: a row that has already paid must be cleaned
    // up, never re-granted, however stale its claim looks.
    await database
      .update(farmExtraction)
      .set({ claimedAt: new Date(Date.now() - 3_600_000) })
      .where(eq(farmExtraction.id, "extraction-d"));

    await (await caller("farm-user")).getFarmState();

    const stacks = await database
      .select()
      .from(userItem)
      .where(eq(userItem.itemId, "seed-1"));
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.quantity).toBe(3);
    expect(await database.select().from(farmExtraction)).toHaveLength(0);
  });

  it("keeps a finished extraction when its payout write fails, and settles it later", async () => {
    await farmer();
    const database = await getTestDatabase();
    await database.insert(farmExtraction).values({
      id: "extraction-f",
      userId: "farm-user",
      extractorSlot: 0,
      cropItemId: "crop-1",
      seedItemId: "seed-1",
      cropQuantity: 1,
      seedQuantity: 3,
      startedAt: new Date(Date.now() - 120_000),
      finishAt: new Date(Date.now() - 60_000),
    } as never);

    // Stand in for the item write failing after the extraction has been claimed.
    const failingClient = failStatements(database, userItem, Infinity, {
      operations: ["insert"],
    });
    await callerForDatabase(farmingRouter, "farm-user", failingClient).getFarmState();

    // The reward must not go down with the row: the claim is released and the next
    // settlement pays it out.
    const kept = await database.select().from(farmExtraction);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.claimedAt).toBeNull();
    expect(await database.select().from(userItem)).toHaveLength(0);

    await (await caller("farm-user")).getFarmState();

    const stacks = await database
      .select()
      .from(userItem)
      .where(eq(userItem.itemId, "seed-1"));
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.quantity).toBe(3);
    expect(await database.select().from(farmExtraction)).toHaveLength(0);
  });

  it("pays once when a second settlement runs while the first holds its claim", async () => {
    await farmer();
    const database = await insertFinishedExtraction();

    let competed = false;
    const holdingClaim = beforeStatements(database, userItem, [
      async () => {
        await (await caller("farm-user")).getFarmState();
        competed = true;
      },
    ]);
    await callerForDatabase(farmingRouter, "farm-user", holdingClaim).getFarmState();

    expect(competed).toBe(true);
    const stacks = await database.select().from(userItem);
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.quantity).toBe(3);
    expect(await database.select().from(farmExtraction)).toHaveLength(0);
  });

  it("takes over a stale claim left by a request that died before paying", async () => {
    await farmer();
    const database = await insertFinishedExtraction({
      claimedAt: new Date(Date.now() - 3_600_000),
    });

    await (await caller("farm-user")).getFarmState();

    const stacks = await database.select().from(userItem);
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.quantity).toBe(3);
    expect(await database.select().from(farmExtraction)).toHaveLength(0);
  });

  it("does not take over a stale claim that settled after the read", async () => {
    await farmer();
    const database = await insertFinishedExtraction({
      claimedAt: new Date(Date.now() - 3_600_000),
    });

    // The slow request's seeds land and its settledAt commits just before this claim runs.
    let settled = false;
    const racing = beforeStatements(database, farmExtraction, [
      async () => {
        await database.update(farmExtraction).set({ settledAt: new Date() });
        settled = true;
      },
    ]);
    await callerForDatabase(farmingRouter, "farm-user", racing).getFarmState();

    expect(settled).toBe(true);
    expect(await database.select().from(userItem)).toHaveLength(0);

    // The next settlement sees the settled row and only cleans it up.
    await (await caller("farm-user")).getFarmState();
    expect(await database.select().from(userItem)).toHaveLength(0);
    expect(await database.select().from(farmExtraction)).toHaveLength(0);
  });

  it("refuses every farming mutation for a banned user", async () => {
    await farmer({ isBanned: true });
    await giveItem("ui-seed", "seed-1", 3);
    const api = await caller("farm-user");
    const results = await Promise.all([
      api.buyShopItem({ type: "SEED", itemId: "seed-1", quantity: 1 }),
      api.sellCrop({ userItemId: "ui-seed", quantity: 1 }),
      api.harvestAll(),
    ]);
    expect(results.every((result) => !result.success)).toBe(true);
    expect(results.every((result) => /banned/i.test(result.message))).toBe(true);
  });
});
