import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import {
  aiProfile,
  battle,
  battleHistory,
  gameSetting,
  quest,
  questHistory,
  item,
  jutsu,
  userJutsu,
  userItem,
  sectorMap,
  trainingLog,
  userData,
  userQueue,
  userVote,
  userRaidBuff,
  village,
  villageStructure,
  war,
  warCamp,
} from "@/drizzle/schema";
import { getServerPusher } from "@/libs/pusher";
import { getEnergyQueue } from "@/libs/queue";
import { initiateBattle } from "@/server/api/routers/combat";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { trainRouter } from "@/server/api/routers/train";
import { IncreaseRegenerationTag } from "@/validators/combat";
import { defaultWarRules } from "@/validators/war";
import { completeExpiredGlobalTravel, travelRouter } from "@/server/api/routers/travel";
import {
  invalidatePublishedMapCache,
  getSectorNeighborIds,
} from "@/server/utils/sectorMap";
import {
  insertItems,
  insertUserItems,
  insertUsers,
  insertJutsus,
  insertDefaultAiProfile,
  insertUserVotes,
} from "../../../setup/factories";
import { beforeStatements, aroundStatements } from "../../../setup/statements";
import {
  queueEnergy,
  queueMasteries,
  readEnergyQueue,
  readMasteryQueue,
} from "../../../setup/queues";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

import { makeEffect } from "../../../setup/combat";
import { deferred } from "../../../setup/deferred";

const HOME = 30;
const AWAY = getSectorNeighborIds(HOME).east;
const USER = "queued-traveler";
const entries = [
  { stat: "offence" as const, energy: 100 },
  { stat: "defence" as const, energy: 100 },
];
const read = async () =>
  (await getTestDatabase()).query.userData.findFirst({
    where: eq(userData.userId, USER),
  });
const patch = async (values: Partial<typeof userData.$inferInsert>) =>
  (await getTestDatabase())
    .update(userData)
    .set(values)
    .where(eq(userData.userId, USER));
const mapFor = (sector: number) => ({
  formatVersion: 1,
  sector,
  name: "Test map",
  width: 26,
  height: 26,
  tiles: Array.from({ length: 26 * 26 }, (_, index) => ({
    x: index % 26,
    y: Math.floor(index / 26),
    terrain: "grass",
    walkCost: 1,
    blocked: false,
    zone: "wilderness" as const,
    battleBiome: "default" as const,
  })),
  objects: [],
  anchors: [],
  exits: [],
  metadata: { importedAt: new Date().toISOString(), source: "tiled" as const },
});
const prepare = async (queue = entries) => {
  const db = await getTestDatabase();
  await db
    .insert(village)
    .values({ id: "home", name: "Home", sector: HOME, kageId: "kage" });
  await insertUsers([
    {
      userId: USER,
      username: USER,
      rank: "JONIN",
      status: "AWAKE",
      level: 1,
      villageId: "home",
      joinedVillageAt: new Date(Date.now() - 7 * 86_400_000),
      sector: HOME,
      longitude: 25,
      latitude: 10,
      isOutlaw: false,
      curEnergy: 0,
      regeneration: 100,
      stealthActive: true,
      stealthActivatedAt: new Date(),
      regenAt: new Date(),
    },
  ]);
  await queueEnergy(USER, queue);
  await insertUserVotes([{ userId: USER }]);
  await db.insert(sectorMap).values(
    [HOME, AWAY].map((sector) => ({
      id: `map-${sector}`,
      sector,
      name: "Map",
      width: 26,
      height: 26,
      status: "PUBLISHED" as const,
      normalizedJson: mapFor(sector),
    })),
  );
};
const walk = async (
  sector: number,
  curLongitude: number,
  longitude: number,
  villageId = "home",
) =>
  (await callerFor(travelRouter, USER)).moveInSector({
    sector,
    curLongitude,
    curLatitude: 10,
    longitude,
    latitude: 10,
    villageId,
    level: 1,
    username: USER,
    avatar: "https://example.com/avatar.png",
    avatarLight: "https://example.com/avatar.png",
  });

describeWithDatabase("Energy queue state transitions", () => {
  afterEach(async () => {
    await resetTables(gameSetting);
  });
  beforeEach(async () => {
    await resetTables(
      userRaidBuff,
      battle,
      battleHistory,
      userItem,
      item,
      aiProfile,
      gameSetting,
      questHistory,
      quest,
      trainingLog,
      userQueue,
      userJutsu,
      jutsu,
      sectorMap,
      userVote,
      userData,
      warCamp,
      war,
      village,
      villageStructure,
    );
    invalidatePublishedMapCache();
  });
  it("allows a partial cache patch when no automatic transition runs", async () => {
    await prepare([]);
    const client = await getTestDatabase();
    await fetchUpdatedUser({ client, userId: USER, forceRegen: true });
    const result = await fetchUpdatedUser({ client, userId: USER });
    expect(result.requiresUserRefresh).toBe(false);
  });
  it("requires cache reconciliation when passive pools are regenerated", async () => {
    await prepare([]);
    const client = await getTestDatabase();
    await fetchUpdatedUser({ client, userId: USER, forceRegen: true });
    await patch({
      updatedAt: new Date(Date.now() - 360_000),
      regenAt: new Date(Date.now() - 180_000),
    });
    const result = await fetchUpdatedUser({ client, userId: USER });
    expect(result.requiresUserRefresh).toBe(true);
    expect(result.user?.curEnergy).toBeGreaterThan(0);
  });
  it("requires cache reconciliation when a queued stat training advances", async () => {
    await prepare();
    const client = await getTestDatabase();
    await fetchUpdatedUser({ client, userId: USER, forceRegen: true });
    await patch({ regenAt: new Date(Date.now() - 65_000) });
    const result = await fetchUpdatedUser({ client, userId: USER });
    expect(result.requiresUserRefresh).toBe(true);
    expect(result.user?.offence).toBeGreaterThan(10);
    expect(getEnergyQueue(result.user!)).toEqual<
      Array<(typeof entries)[number] | undefined>
    >([entries[1]]);
  });
  it("does not credit away-sector ticks after walking home", async () => {
    await prepare();
    expect((await walk(HOME, 25, 26)).success).toBe(true);
    await patch({ regenAt: new Date(Date.now() - 195_000) });
    expect((await walk(AWAY, 0, -1)).success).toBe(true);
    await fetchUpdatedUser({
      client: await getTestDatabase(),
      userId: USER,
      forceRegen: true,
    });
    const user = (await read())!;
    expect(user.offence).toBe(18.5);
    expect(user.defence).toBe(10);
    expect(user.curEnergy).toBe(0);
    expect(await readEnergyQueue(USER)).toEqual<
      Array<(typeof entries)[number] | undefined>
    >([entries[1]]);
  });
  it("preserves all travel pools and unfinished ticks without training during travel", async () => {
    await prepare();
    const regenAt = new Date(Date.now() - 195_000);
    await patch({
      status: "TRAVEL",
      sector: HOME,
      regenAt,
      curHealth: 0,
      curChakra: 0,
      curStamina: 0,
      maxHealth: 1000,
      maxChakra: 1000,
      maxStamina: 1000,
    });
    expect(
      (await (await callerFor(travelRouter, USER)).finishGlobalMove()).success,
    ).toBe(true);
    const arrived = (await read())!;
    expect(arrived.curEnergy).toBe(100);
    expect(arrived.curHealth).toBe(315);
    expect(arrived.curChakra).toBe(315);
    expect(arrived.curStamina).toBe(315);
    expect(arrived.regenAt.getTime()).toBe(regenAt.getTime() + 180_000);
    expect(await readEnergyQueue(USER)).toEqual(entries);
    await fetchUpdatedUser({
      client: await getTestDatabase(),
      userId: USER,
      forceRegen: true,
    });
    expect((await read())!.defence).toBe(10);
  });
  it.each([true, false])(
    "cleaner preserves travel recovery policy with queued training=%s",
    async (queued) => {
      await prepare(queued ? entries : []);
      const db = await getTestDatabase();
      const regenAt = new Date(Date.now() - 195_000);
      await patch({
        status: "TRAVEL",
        travelFinishAt: new Date(Date.now() - 1000),
        regenAt,
        curHealth: 0,
        curChakra: 0,
        curStamina: 0,
        maxHealth: 1000,
        maxChakra: 1000,
        maxStamina: 1000,
      });
      await db.insert(gameSetting).values({
        id: "travel-regen",
        name: "regenGainMultiplier",
        value: 2,
        time: new Date(Date.now() + 86_400_000),
      });
      await completeExpiredGlobalTravel(db);
      const arrived = (await read())!;
      expect(arrived.status).toBe("AWAKE");
      expect(arrived.travelFinishAt).toBeNull();
      expect(arrived.curEnergy).toBe(queued ? 100 : 0);
      expect([arrived.curHealth, arrived.curChakra, arrived.curStamina]).toEqual(
        queued ? [630, 630, 630] : [0, 0, 0],
      );
      expect(arrived.regenAt.getTime()).toBe(
        regenAt.getTime() + (queued ? 180_000 : 0),
      );
      expect(arrived.offence).toBe(10);
      expect(arrived.defence).toBe(10);
      expect(await readEnergyQueue(USER)).toEqual(queued ? entries : []);
      await completeExpiredGlobalTravel(db);
      expect(await read()).toEqual(arrived);
      if (queued) {
        await fetchUpdatedUser({ client: db, userId: USER, forceRegen: true });
        // The stored arrival Energy can train one entry, but travel ticks cannot replay.
        expect((await read())!.offence).toBe(18.5);
        expect((await read())!.defence).toBe(10);
        expect(await readEnergyQueue(USER)).toEqual<
          Array<(typeof entries)[number] | undefined>
        >([entries[1]]);
      }
    },
  );

  it.each([
    ["endpoint", false],
    ["cleaner", false],
    ["endpoint", true],
    ["cleaner", true],
  ] as const)(
    "%s integrates timed travel recovery without stacking or training queued stats (meal still active=%s)",
    async (mode, live) => {
      await prepare();
      const db = await getTestDatabase();
      const regenAt = new Date(Date.now() - 195_000);
      await patch({
        status: "TRAVEL",
        travelFinishAt: new Date(Date.now() - 1000),
        regenAt,
        regeneration: 10,
        villageId: null,
        curHealth: 0,
        curChakra: 0,
        curStamina: 0,
        maxHealth: 1000,
        maxChakra: 1000,
        maxStamina: 1000,
      });
      await db.insert(userRaidBuff).values([
        {
          id: "travel-meal",
          userId: USER,
          createdAt: regenAt,
          expiresAt: new Date(regenAt.getTime() + (live ? 300_000 : 90_000)),
          effects: [IncreaseRegenerationTag.parse({ power: 50 })],
        },
        {
          id: "travel-raid",
          userId: USER,
          createdAt: regenAt,
          expiresAt: new Date(regenAt.getTime() + 150_000),
          effects: [IncreaseRegenerationTag.parse({ power: 20 })],
        },
      ]);
      const complete = async () => {
        if (mode === "cleaner") await completeExpiredGlobalTravel(db);
        else
          expect(
            (await (await callerFor(travelRouter, USER)).finishGlobalMove()).success,
          ).toBe(true);
      };
      await complete();
      const arrived = (await read())!;
      // After meal expiry: 15 from the meal, 12 from the raid, then 10 at the base rate.
      const recovery = live ? 45 : 37;
      expect([
        arrived.curHealth,
        arrived.curChakra,
        arrived.curStamina,
        arrived.curEnergy,
      ]).toEqual(Array(4).fill(recovery));
      expect(arrived.regenAt.getTime()).toBe(regenAt.getTime() + 180_000);
      expect([arrived.offence, arrived.defence]).toEqual([10, 10]);
      expect(await readEnergyQueue(USER)).toEqual(entries);
      await complete();
      expect(await read()).toEqual(
        expect.objectContaining({
          curHealth: recovery,
          curChakra: recovery,
          curStamina: recovery,
          curEnergy: recovery,
          regenAt: arrived.regenAt,
          offence: 10,
          defence: 10,
        }),
      );
      expect(await readEnergyQueue(USER)).toEqual(entries);
    },
  );

  it.each(["queued", "bulk"])(
    "cleaner retries a %s deadlock without replaying recovery",
    async (mode) => {
      await prepare(mode === "queued" ? entries : []);
      const db = await getTestDatabase();
      const regenAt = new Date(Date.now() - 195_000);
      await patch({
        status: "TRAVEL",
        travelFinishAt: new Date(Date.now() - 1000),
        regenAt,
      });
      let attempts = 0;
      const racingDb = aroundStatements(
        db,
        userData,
        async (run) => {
          attempts++;
          if (attempts === 1)
            throw new Error(
              "Deadlock found when trying to get lock; try restarting transaction",
            );
          return run();
        },
        { when: (set) => "regenAt" in set === (mode === "queued") },
      );
      await completeExpiredGlobalTravel(racingDb);
      expect(attempts).toBe(2);
      const arrived = (await read())!;
      expect(arrived).toMatchObject({
        status: "AWAKE",
        curEnergy: mode === "queued" ? 100 : 0,
        offence: 10,
        defence: 10,
      });
      expect(await readEnergyQueue(USER)).toEqual(mode === "queued" ? entries : []);
      expect(arrived.regenAt.getTime()).toBe(
        regenAt.getTime() + (mode === "queued" ? 180_000 : 0),
      );
      await completeExpiredGlobalTravel(db);
      expect(await read()).toEqual(arrived);
    },
  );

  it("cleaner applies the population PvP boost before consuming travel recovery ticks", async () => {
    await prepare();
    const db = await getTestDatabase();
    const regenAt = new Date(Date.now() - 195_000);
    await insertUsers([{ userId: "pvp-population", pvpExperience: 600 }]);
    await patch({
      status: "TRAVEL",
      travelFinishAt: new Date(Date.now() - 1000),
      regenAt,
      pvpExperience: 1400,
      joinedVillageAt: new Date(Date.now() - 100 * 86_400_000),
      curHealth: 0,
      curChakra: 0,
      curStamina: 0,
      maxHealth: 1000,
      maxChakra: 1000,
      maxStamina: 1000,
    });

    await completeExpiredGlobalTravel(db);
    const arrived = (await read())!;
    expect(arrived.status).toBe("AWAKE");
    expect([arrived.curHealth, arrived.curChakra, arrived.curStamina]).toEqual([
      397, 397, 397,
    ]);
    expect(arrived.regenAt.getTime()).toBe(regenAt.getTime() + 180_000);
    expect(await readEnergyQueue(USER)).toEqual(entries);
    await completeExpiredGlobalTravel(db);
    expect(await read()).toEqual(arrived);
  });

  it("cleaner leaves future travel untouched", async () => {
    await prepare();
    await patch({
      status: "TRAVEL",
      travelFinishAt: new Date(Date.now() + 60_000),
      regenAt: new Date(Date.now() - 195_000),
    });
    const before = (await read())!;
    await completeExpiredGlobalTravel(await getTestDatabase());
    expect(await read()).toEqual(before);
  });

  it("cleaner rejects a stale queued travel snapshot", async () => {
    await prepare();
    const db = await getTestDatabase();
    const regenAt = new Date(Date.now() - 195_000);
    await patch({
      status: "TRAVEL",
      travelFinishAt: new Date(Date.now() - 1000),
      regenAt,
    });
    const changedAt = new Date(Date.now() + 60_000);
    let raced = false;
    const racingDb = beforeStatements(
      db,
      userData,
      [
        async () => {
          raced = true;
          await patch({ updatedAt: changedAt, curEnergy: 1 });
        },
      ],
      { when: (set) => "regenAt" in set },
    );
    await completeExpiredGlobalTravel(racingDb);
    expect(raced).toBe(true);
    expect(await read()).toEqual(
      expect.objectContaining({
        status: "TRAVEL",
        regenAt,
        updatedAt: changedAt,
        curEnergy: 1,
        offence: 10,
        defence: 10,
      }),
    );
    expect(await readEnergyQueue(USER)).toEqual(entries);
  });

  it("does not regenerate an empty queue when walking", async () => {
    await prepare([]);
    await patch({ regenAt: new Date(Date.now() - 195_000) });
    const before = (await read())!;
    expect((await walk(HOME, 25, 26)).success).toBe(true);
    const after = (await read())!;
    expect(after.curEnergy).toBe(before.curEnergy);
    expect(after.regenAt).toEqual(before.regenAt);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });
  it.each([HOME, AWAY])(
    "defers queued Energy settlement while walking within sector %s",
    async (sector) => {
      await prepare();
      await patch({ sector, regenAt: new Date(Date.now() - 195_000) });
      const before = (await read())!;
      expect((await walk(sector, 25, 24)).success).toBe(true);
      const after = (await read())!;
      expect(after.longitude).toBe(24);
      expect(after.curEnergy).toBe(before.curEnergy);
      expect(after.offence).toBe(before.offence);
      expect(after.defence).toBe(before.defence);
      expect(after.regenAt).toEqual(before.regenAt);
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect(await readEnergyQueue(USER)).toEqual(entries);
    },
  );
  it("settles deferred home-sector ticks before walking away", async () => {
    await prepare();
    await patch({ longitude: 24, regenAt: new Date(Date.now() - 65_000) });
    expect((await walk(HOME, 24, 25)).success).toBe(true);
    expect((await walk(HOME, 25, 26)).success).toBe(true);
    const user = (await read())!;
    expect(user.sector).toBe(AWAY);
    expect(user.offence).toBe(18.5);
    expect(user.defence).toBe(10);
    expect(await readEnergyQueue(USER)).toEqual<
      Array<(typeof entries)[number] | undefined>
    >([entries[1]]);
  });
  it("rechecks war-camp access after settlement changes village membership", async () => {
    await prepare();
    const db = await getTestDatabase();
    await db.insert(village).values({
      id: "outlaws",
      name: "Outlaws",
      sector: 100,
      kageId: "outlaw-kage",
      type: "OUTLAW",
    });
    await db.insert(war).values({
      id: "home-war",
      attackerVillageId: "home",
      defenderVillageId: "enemy",
      type: "VILLAGE_WAR",
      status: "ACTIVE",
      rules: { ...defaultWarRules, enabled: true },
      combatStartedAt: new Date(Date.now() - 3600_000),
    });
    await db.insert(warCamp).values({
      id: "away-camp",
      warId: "home-war",
      sector: AWAY,
      guardianId: "guardian",
      startsAt: new Date(Date.now() - 3600_000),
      endsAt: new Date(Date.now() + 3600_000),
    });
    await patch({ villagePrestige: -1 });
    // A client-supplied new village must not reuse admission granted to the old one.
    const result = await walk(HOME, 25, 26, "outlaws");
    expect(result).toMatchObject({
      success: false,
      message: "This sector is reserved for participants in an active war camp.",
    });
    expect(await read()).toMatchObject({
      villageId: "outlaws",
      sector: HOME,
      longitude: 25,
    });
  });
  it("rejects a stale queued within-sector move without settling training", async () => {
    await prepare();
    await patch({ regenAt: new Date(Date.now() - 195_000) });
    const before = (await read())!;
    const changedAt = new Date(before.updatedAt.getTime() + 1);
    const racingDb = beforeStatements(await getTestDatabase(), userData, [
      () => patch({ updatedAt: changedAt, curEnergy: 1 }),
    ]);
    const result = await travelRouter
      .createCaller({ drizzle: racingDb, userId: USER } as never)
      .moveInSector({
        sector: HOME,
        curLongitude: 25,
        curLatitude: 10,
        longitude: 24,
        latitude: 10,
        villageId: "home",
        level: 1,
        username: USER,
        avatar: "https://example.com/avatar.png",
        avatarLight: "https://example.com/avatar.png",
      });
    expect(result.success).toBe(false);
    expect(await read()).toEqual(
      expect.objectContaining({
        longitude: 25,
        regenAt: before.regenAt,
        updatedAt: changedAt,
        curEnergy: 1,
        offence: before.offence,
        defence: before.defence,
      }),
    );
    expect(await readEnergyQueue(USER)).toEqual(entries);
  });
  it("finishes travel repeatedly without a queue or another snapshot write", async () => {
    await prepare([]);
    const snapshot = new Date(Date.now() + 60_000);
    await patch({ status: "TRAVEL", updatedAt: snapshot });
    const caller = await callerFor(travelRouter, USER);
    expect((await caller.finishGlobalMove()).success).toBe(true);
    const arrived = (await read())!;
    expect(arrived.status).toBe("AWAKE");
    expect(arrived.travelFinishAt).toBeNull();
    expect(arrived.updatedAt.getTime()).toBe(snapshot.getTime() + 1);
    expect((await caller.finishGlobalMove()).success).toBe(true);
    expect((await read())!.updatedAt).toEqual(arrived.updatedAt);
  });
  it("rejects a stale travel snapshot without applying recovery", async () => {
    await prepare();
    const regenAt = new Date(Date.now() - 195_000);
    await patch({ status: "TRAVEL", regenAt });
    const before = (await read())!;
    const changedAt = new Date(before.updatedAt.getTime() + 1);
    const db = await getTestDatabase();
    const racingDb = aroundStatements(
      db,
      userData,
      async (run) => {
        await patch({ updatedAt: changedAt, curHealth: 42 });
        return run();
      },
      { operations: ["update"] },
    );
    const result = await travelRouter
      .createCaller({ drizzle: racingDb, userId: USER } as never)
      .finishGlobalMove();
    expect(result).toMatchObject({
      success: false,
      message: "Your travel state changed. Please try again",
    });
    expect(await read()).toEqual(
      expect.objectContaining({
        status: "TRAVEL",
        regenAt,
        curEnergy: before.curEnergy,
        curHealth: 42,
        updatedAt: changedAt,
      }),
    );
    expect(await readEnergyQueue(USER)).toEqual(entries);
  });
  it("preloads real Energy capacity and boosted recovery before forced combat loadouts", async () => {
    await prepare([]);
    const db = await getTestDatabase();
    await patch({ isOutlaw: true, stealthActive: false, curEnergy: 250 });
    await insertUsers([
      {
        userId: "attacker",
        username: "Attacker",
        rank: "JONIN",
        level: 1,
        status: "AWAKE",
        isOutlaw: true,
        sector: HOME,
        longitude: 25,
        latitude: 10,
      },
    ]);
    await insertItems([
      {
        id: "energy-armor",
        itemType: "ARMOR",
        effects: [
          makeEffect("increasemaxpools", {
            power: 200,
            powerPerLevel: 0,
            calculation: "static",
            rounds: 1,
            poolsAffected: ["Energy"],
          }),
        ],
      },
    ]);
    await insertUserItems([
      { userId: USER, itemId: "energy-armor", equipped: "ITEM_1", durability: 100 },
    ]);
    await insertDefaultAiProfile();
    await db.insert(gameSetting).values({
      id: "regen-gain",
      name: "regenGainMultiplier",
      value: 2,
      time: new Date(Date.now() + 86_400_000),
    });
    const trigger = vi
      .spyOn(getServerPusher(), "trigger")
      .mockResolvedValue({} as never);
    try {
      const result = await initiateBattle(
        {
          client: db,
          userIds: ["attacker"],
          targetIds: [USER],
          sector: HOME,
          longitude: 25,
          latitude: 10,
          biome: "default",
          forceLoadouts: [
            {
              id: "empty",
              userId: USER,
              loadout: { weaponIds: [], consumableIds: [], jutsuIds: [] },
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        },
        "RANKED_SPARRING",
      );
      expect(result.success).toBe(true);
      const state = (await db.query.battle.findFirst({
        where: eq(battle.id, result.battleId!),
      }))!;
      expect(state.extraState.energyCapacity?.[USER]).toBe(300);
      expect(state.extraState.energyRegeneration?.[USER]).toBe(200);
      expect(state.usersState.find((user) => user.userId === USER)?.items).toEqual([]);
      expect((await read())!.curEnergy).toBe(250);
    } finally {
      trigger.mockRestore();
    }
  });

  it.each(["ninjutsuMastery", "Wind"] as const)(
    "collects an offline opponent's final %s session before combat without queue rows",
    async (stat) => {
      await prepare([]);
      const db = await getTestDatabase();
      await patch({
        isOutlaw: true,
        stealthActive: false,
        trainingSpeed: "15min",
        ...(stat === "Wind"
          ? {
              currentlyTrainingElement: stat,
              elementalTrainingSpeed: "15min" as const,
              elementalTrainingStartedAt: new Date(Date.now() - 20 * 60_000),
            }
          : {
              currentlyTrainingMastery: stat,
              masteryTrainingStartedAt: new Date(Date.now() - 20 * 60_000),
            }),
      });
      await insertUsers([
        {
          userId: "attacker",
          username: "Attacker",
          rank: "JONIN",
          level: 1,
          status: "AWAKE",
          isOutlaw: true,
          sector: HOME,
          longitude: 25,
          latitude: 10,
        },
      ]);
      await insertDefaultAiProfile();
      await insertItems([
        {
          id: "mastery-energy-armor",
          itemType: "ARMOR",
          requiredNinjutsuMastery: 100,
          effects: [
            makeEffect("increasemaxpools", {
              power: 200,
              powerPerLevel: 0,
              calculation: "static",
              rounds: 1,
              poolsAffected: ["Energy"],
            }),
          ],
        },
      ]);
      await insertUserItems([
        {
          userId: USER,
          itemId: "mastery-energy-armor",
          equipped: "ITEM_1",
          durability: 100,
        },
      ]);
      const trigger = vi
        .spyOn(getServerPusher(), "trigger")
        .mockResolvedValue({} as never);
      try {
        const result = await initiateBattle(
          {
            client: db,
            userIds: ["attacker"],
            targetIds: [USER],
            sector: HOME,
            longitude: 25,
            latitude: 10,
            biome: "default",
          },
          "SPARRING",
        );
        expect(result.success).toBe(true);
        const state = (await db.query.battle.findFirst({
          where: eq(battle.id, result.battleId!),
        }))!;
        expect(state.extraState.energyCapacity?.[USER]).toBe(
          stat === "Wind" ? 100 : 300,
        );
        const user = (await read())!;
        expect(
          stat === "Wind"
            ? user.currentlyTrainingElement
            : user.currentlyTrainingMastery,
        ).toBeNull();
        expect(
          stat === "Wind"
            ? user.elementalTrainingStartedAt
            : user.masteryTrainingStartedAt,
        ).toBeNull();
        expect(
          stat === "Wind" ? user.elementalMastery.Wind : user.ninjutsuMastery,
        ).toBeGreaterThan(0);
        expect(user.dailyTrainings).toBe(1);
        expect(await db.select().from(userQueue)).toEqual([]);
        expect((await db.select().from(trainingLog)).map((log) => log.stat)).toEqual([
          stat,
        ]);
      } finally {
        trigger.mockRestore();
      }
    },
  );

  it.each(["ninjutsuMastery", "Wind"] as const)(
    "settles an offline opponent's due jutsu level and %s queue before the fight",
    async (stat) => {
      const kind = stat === "Wind" ? "ELEMENT" : "MASTERY";
      await prepare([]);
      const db = await getTestDatabase();
      const finished = new Date(Date.now() - 30 * 60_000);
      await patch({
        isOutlaw: true,
        stealthActive: false,
        trainingSpeed: "15min",
        ...(stat === "Wind"
          ? {
              currentlyTrainingElement: stat,
              elementalTrainingSpeed: "15min" as const,
              elementalTrainingStartedAt: new Date(Date.now() - 20 * 60_000),
            }
          : {
              currentlyTrainingMastery: stat,
              masteryTrainingStartedAt: new Date(Date.now() - 20 * 60_000),
            }),
      });
      await insertUsers([
        {
          userId: "attacker",
          username: "Attacker",
          rank: "JONIN",
          level: 1,
          status: "AWAKE",
          isOutlaw: true,
          sector: HOME,
          longitude: 25,
          latitude: 10,
        },
      ]);
      await insertDefaultAiProfile();
      await insertJutsus([{ id: "queued-jutsu", name: "Queued" }]);
      await db.insert(userJutsu).values({
        id: "uj-queued",
        userId: USER,
        jutsuId: "queued-jutsu",
        level: 2,
        equipped: true,
        finishTraining: finished,
      });
      await db.insert(userQueue).values({
        id: "q-jutsu",
        userId: USER,
        kind: "JUTSU",
        position: 1,
        jutsuId: "queued-jutsu",
        reservedRyo: 0,
        durationSeconds: 60,
        startsAt: finished,
        finishesAt: new Date(finished.getTime() + 60_000),
      });
      await queueMasteries(
        USER,
        [{ stat: stat === "Wind" ? "Earth" : "genjutsuMastery", speed: "1hr" }],
        kind,
      );
      const trigger = vi
        .spyOn(getServerPusher(), "trigger")
        .mockResolvedValue({} as never);
      try {
        const result = await initiateBattle(
          {
            client: db,
            userIds: ["attacker"],
            targetIds: [USER],
            sector: HOME,
            longitude: 25,
            latitude: 10,
            biome: "default",
          },
          "SPARRING",
        );
        expect(result.success).toBe(true);
        // The queued level started when the previous one finished, before the fighters were read.
        const owned = (await db.query.userJutsu.findFirst({
          where: eq(userJutsu.id, "uj-queued"),
        }))!;
        expect(owned.level).toBe(3);
        expect(owned.finishTraining!.getTime()).toBeGreaterThan(finished.getTime());
        const state = (await db.query.battle.findFirst({
          where: eq(battle.id, result.battleId!),
        }))!;
        const fighter = state.usersState.find((user) => user.userId === USER)!;
        expect(fighter.jutsus.find((j) => j.jutsuId === "queued-jutsu")?.level).toBe(3);
        // The finished mastery session was collected and the queued one started at its end.
        const user = (await read())!;
        expect(
          stat === "Wind"
            ? user.currentlyTrainingElement
            : user.currentlyTrainingMastery,
        ).toBe(stat === "Wind" ? "Earth" : "genjutsuMastery");
        expect(stat === "Wind" ? user.elementalTrainingSpeed : user.trainingSpeed).toBe(
          "1hr",
        );
        expect(
          stat === "Wind" ? user.elementalMastery.Wind : user.ninjutsuMastery,
        ).toBeGreaterThan(stat === "Wind" ? 0 : 10);
        expect(stat === "Wind" ? user.elementalQueueHead : user.masteryQueueHead).toBe(
          1,
        );
        expect(await readMasteryQueue(USER, kind)).toEqual([]);
        // The started jutsu row is gone; the consumed mastery row waits for the next edit.
        expect((await db.select().from(userQueue)).map((row) => row.kind)).toEqual([
          kind,
        ]);
        expect((await db.select().from(trainingLog)).map((log) => log.stat)).toEqual([
          stat,
        ]);
      } finally {
        trigger.mockRestore();
      }
    },
  );

  it("preserves a concurrent discipline speed change when combat advances only the element queue", async () => {
    const now = new Date();
    setSystemTime(now);
    const { promise: ready, resolve: speedWriteReady } = deferred<void>();
    const { promise: release, resolve: releaseSpeedWrite } = deferred<void>();
    const trigger = vi
      .spyOn(getServerPusher(), "trigger")
      .mockResolvedValue({} as never);
    try {
      await prepare([]);
      const db = await getTestDatabase();
      await patch({
        isOutlaw: true,
        stealthActive: false,
        primaryElement: "Fire",
        secondaryElement: "Water",
        trainingSpeed: "15min",
        currentlyTrainingElement: "Wind",
        elementalTrainingSpeed: "15min",
        elementalTrainingStartedAt: new Date(now.getTime() - 14 * 60_000),
      });
      await queueMasteries(USER, [{ stat: "Earth", speed: "1hr" }], "ELEMENT");
      await insertUsers([
        {
          userId: "attacker",
          username: "Attacker",
          rank: "JONIN",
          level: 1,
          status: "AWAKE",
          isOutlaw: true,
          sector: HOME,
          longitude: 25,
          latitude: 10,
        },
      ]);
      await insertDefaultAiProfile();
      const speedDb = beforeStatements(db, userData, [
        async () => {
          speedWriteReady();
          await release;
        },
      ]);
      // The speed request reads before the element finishes, then waits to commit.
      const speedChange = trainRouter
        .createCaller({ drizzle: speedDb, userId: USER } as never)
        .updateTrainingSpeed({ speed: "4hrs" });
      await ready;
      setSystemTime(new Date(now.getTime() + 2 * 60_000));
      let raced = false;
      const racingDb = beforeStatements(db, userData, [
        async () => {
          // Commit the real speed mutation after preload and before the battle claim.
          releaseSpeedWrite();
          expect((await speedChange).success).toBe(true);
          expect((await read())!.trainingSpeed).toBe("4hrs");
          raced = true;
        },
      ]);
      const result = await initiateBattle(
        {
          client: racingDb,
          userIds: ["attacker"],
          targetIds: [USER],
          sector: HOME,
          longitude: 25,
          latitude: 10,
          biome: "default",
        },
        "SPARRING",
      );
      expect(result.success).toBe(true);
      expect(raced).toBe(true);
      const user = (await read())!;
      expect(user.trainingSpeed).toBe("4hrs");
      expect(user.currentlyTrainingMastery).toBeNull();
      expect(user.masteryTrainingStartedAt).toBeNull();
      expect(user.masteryQueueHead).toBe(0);
      expect(user.currentlyTrainingElement).toBe("Earth");
      expect(user.elementalTrainingSpeed).toBe("1hr");
      expect(user.elementalQueueHead).toBe(1);
      expect(user.elementalMastery.Wind).toBeGreaterThan(0);
      expect(user.dailyTrainings).toBe(1);
      expect((await db.select().from(trainingLog)).map((log) => log.stat)).toEqual([
        "Wind",
      ]);
    } finally {
      releaseSpeedWrite();
      setSystemTime();
      trigger.mockRestore();
    }
  });

  it.each(["success", "partial failure", "concurrent"] as const)(
    "settles pre-combat queues exactly once for %s",
    async (mode) => {
      await prepare();
      const db = await getTestDatabase();
      await patch({
        isOutlaw: true,
        regenAt: new Date(Date.now() - 195_000),
        stealthActive: false,
        curHealth: 0,
        curChakra: 0,
        curStamina: 0,
        maxHealth: 1000,
        maxChakra: 1000,
        maxStamina: 1000,
      });
      // The first two earned ticks include the meal; the third is after expiry.
      await db.insert(userRaidBuff).values({
        id: "expired-training-meal",
        userId: USER,
        effects: [IncreaseRegenerationTag.parse({ power: 50 })],
        createdAt: new Date(Date.now() - 200_000),
        expiresAt: new Date(Date.now() - 60_000),
      });
      await insertUsers([
        {
          userId: "attacker",
          username: "Attacker",
          rank: "JONIN",
          level: 1,
          status: "AWAKE",
          isOutlaw: true,
          sector: HOME,
          longitude: 25,
          latitude: 10,
        },
      ]);
      await insertDefaultAiProfile();
      await db.insert(gameSetting).values({
        id: "training-gain",
        name: "trainingGainMultiplier",
        value: 2,
        time: new Date(Date.now() + 86_400_000),
      });
      const trigger = vi
        .spyOn(getServerPusher(), "trigger")
        .mockResolvedValue({} as never);
      try {
        const hospitalize = () =>
          db
            .update(userData)
            .set({ status: "HOSPITALIZED" })
            .where(eq(userData.userId, "attacker"));
        const racingDb = beforeStatements(
          db,
          userData,
          mode === "partial failure" ? [hospitalize] : [],
          { operations: ["update"] },
        );
        const start = () =>
          initiateBattle(
            {
              client: racingDb,
              userIds: ["attacker"],
              targetIds: [USER],
              sector: HOME,
              longitude: 25,
              latitude: 10,
              biome: "default",
            },
            "SPARRING",
          );
        const results =
          mode === "concurrent"
            ? await Promise.all([start(), start()])
            : [await start()];
        expect(results.filter((result) => result.success)).toHaveLength(
          mode === "partial failure" ? 0 : 1,
        );
        const result = results.find((result) => result.success);
        const user = (await read())!;
        expect(await readEnergyQueue(USER)).toEqual([]);
        expect(user.curEnergy).toBe(100);
        expect(user.offence).toBe(27);
        expect(user.defence).toBe(27);
        expect(user.experience).toBe(34);
        expect(user.curHealth).toBe(400);
        expect(user.curChakra).toBe(400);
        expect(user.curStamina).toBe(400);
        if (result) {
          const state = await db.query.battle.findFirst({
            where: eq(battle.id, result.battleId!),
          });
          expect(state!.extraState.energyRegeneration?.[USER]).toBe(100);
          expect(
            state!.usersState.find((fighter) => fighter.userId === USER)!.offence,
          ).toBe(27);
        } else {
          expect(user.status).toBe("AWAKE");
          expect(await db.select().from(battle)).toHaveLength(0);
        }
        expect(await db.select().from(trainingLog)).toHaveLength(2);
      } finally {
        trigger.mockRestore();
      }
    },
  );
});
