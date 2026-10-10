import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
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
  village,
} from "@/drizzle/schema";
import { getServerPusher } from "@/libs/pusher";
import { getEnergyQueue } from "@/libs/queue";
import { initiateBattle } from "@/server/api/routers/combat";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { completeExpiredGlobalTravel, travelRouter } from "@/server/api/routers/travel";
import {
  invalidatePublishedMapCache,
  getSectorNeighborIds,
} from "@/server/utils/sectorMap";
import { insertItems, insertUserItems, insertUsers } from "../../setup/factories";
import {
  queueEnergy,
  queueMasteries,
  readEnergyQueue,
  readMasteryQueue,
} from "../../setup/queues";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

import { makeEffect } from "../../libs/combat/helpers/battleScenario";

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
  await db
    .insert(userVote)
    .values({
      id: "vote-queued",
      userId: USER,
      secret: "secret01",
      lastVoteAt: new Date(),
    });
  await db
    .insert(sectorMap)
    .values(
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
const walk = async (sector: number, curLongitude: number, longitude: number) =>
  (await callerFor(travelRouter, USER)).moveInSector({
    sector,
    curLongitude,
    curLatitude: 10,
    longitude,
    latitude: 10,
    villageId: "home",
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
      village,
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
    expect(getEnergyQueue(result.user!)).toEqual<Array<(typeof entries)[number] | undefined>>([entries[1]]);
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
    expect(user.offence).toBe(140);
    expect(user.defence).toBe(10);
    expect(user.curEnergy).toBe(0);
    expect(await readEnergyQueue(USER)).toEqual<Array<(typeof entries)[number] | undefined>>([entries[1]]);
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
    expect(arrived.curHealth).toBe(300);
    expect(arrived.curChakra).toBe(300);
    expect(arrived.curStamina).toBe(300);
    expect(arrived.regenAt.getTime()).toBe(regenAt.getTime() + 180_000);
    expect(await readEnergyQueue(USER)).toEqual(entries);
    await fetchUpdatedUser({
      client: await getTestDatabase(),
      userId: USER,
      forceRegen: true,
    });
    expect((await read())!.defence).toBe(10);
  });
  it.each([true, false])("cleaner preserves travel recovery policy with queued training=%s", async queued => {
    await prepare(queued ? entries : []);
    const db = await getTestDatabase();
    const regenAt = new Date(Date.now() - 195_000);
    await patch({ status: "TRAVEL", travelFinishAt: new Date(Date.now() - 1000), regenAt,
      curHealth: 0, curChakra: 0, curStamina: 0, maxHealth: 1000, maxChakra: 1000, maxStamina: 1000 });
    await db.insert(gameSetting).values({ id: "travel-regen", name: "regenGainMultiplier", value: 2, time: new Date(Date.now() + 86_400_000) });
    await completeExpiredGlobalTravel(db);
    const arrived = (await read())!;
    expect(arrived.status).toBe("AWAKE");
    expect(arrived.travelFinishAt).toBeNull();
    expect(arrived.curEnergy).toBe(queued ? 100 : 0);
    expect([arrived.curHealth, arrived.curChakra, arrived.curStamina]).toEqual(queued ? [600, 600, 600] : [0, 0, 0]);
    expect(arrived.regenAt.getTime()).toBe(regenAt.getTime() + (queued ? 180_000 : 0));
    expect(arrived.offence).toBe(10);
    expect(arrived.defence).toBe(10);
    expect(await readEnergyQueue(USER)).toEqual(queued ? entries : []);
    await completeExpiredGlobalTravel(db);
    expect(await read()).toEqual(arrived);
    if (queued) {
      await fetchUpdatedUser({ client: db, userId: USER, forceRegen: true });
      // The stored arrival Energy can train one entry, but travel ticks cannot replay.
      expect((await read())!.offence).toBe(140);
      expect((await read())!.defence).toBe(10);
      expect(await readEnergyQueue(USER)).toEqual<Array<(typeof entries)[number] | undefined>>([entries[1]]);
    }
  });

  it.each(["queued", "bulk"])("cleaner retries a %s deadlock without replaying recovery", async mode => {
    await prepare(mode === "queued" ? entries : []);
    const db = await getTestDatabase();
    const regenAt = new Date(Date.now() - 195_000);
    await patch({ status: "TRAVEL", travelFinishAt: new Date(Date.now() - 1000), regenAt });
    let attempts = 0;
    const racingDb = new Proxy(db, {
      get(target, key, receiver) {
        if (key !== "update") return Reflect.get(target, key, receiver);
        return (table: Parameters<typeof db.update>[0]) => {
          const builder = db.update(table);
          return { set(values: Parameters<typeof builder.set>[0]) {
            const update = builder.set(values);
            return { async where(condition: Parameters<typeof update.where>[0]) {
              if (table === userData && ("regenAt" in values) === (mode === "queued")) {
                attempts++;
                if (attempts === 1) throw new Error("Deadlock found when trying to get lock; try restarting transaction");
              }
              return update.where(condition);
            } };
          } };
        };
      },
    });
    await completeExpiredGlobalTravel(racingDb);
    expect(attempts).toBe(2);
    const arrived = (await read())!;
    expect(arrived).toMatchObject({ status: "AWAKE", curEnergy: mode === "queued" ? 100 : 0, offence: 10, defence: 10 });
    expect(await readEnergyQueue(USER)).toEqual(mode === "queued" ? entries : []);
    expect(arrived.regenAt.getTime()).toBe(regenAt.getTime() + (mode === "queued" ? 180_000 : 0));
    await completeExpiredGlobalTravel(db);
    expect(await read()).toEqual(arrived);
  });

  it("cleaner leaves future travel untouched", async () => {
    await prepare();
    await patch({ status: "TRAVEL", travelFinishAt: new Date(Date.now() + 60_000), regenAt: new Date(Date.now() - 195_000) });
    const before = (await read())!;
    await completeExpiredGlobalTravel(await getTestDatabase());
    expect(await read()).toEqual(before);
  });

  it("cleaner rejects a stale queued travel snapshot", async () => {
    await prepare();
    const db = await getTestDatabase();
    const regenAt = new Date(Date.now() - 195_000);
    await patch({ status: "TRAVEL", travelFinishAt: new Date(Date.now() - 1000), regenAt });
    const changedAt = new Date(Date.now() + 60_000);
    let raced = false;
    const racingDb = new Proxy(db, {
      get(target, key, receiver) {
        if (key !== "update") return Reflect.get(target, key, receiver);
        return (table: Parameters<typeof db.update>[0]) => {
          const builder = db.update(table);
          return { set(values: Parameters<typeof builder.set>[0]) {
            const update = builder.set(values);
            return { async where(condition: Parameters<typeof update.where>[0]) {
              if (table === userData && "regenAt" in values && !raced) {
                raced = true;
                await patch({ updatedAt: changedAt, curEnergy: 1 });
              }
              return update.where(condition);
            } };
          } };
        };
      },
    });
    await completeExpiredGlobalTravel(racingDb);
    expect(raced).toBe(true);
    expect(await read()).toMatchObject({ status: "TRAVEL", regenAt, updatedAt: changedAt, curEnergy: 1, offence: 10, defence: 10 });
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
    const racingDb = new Proxy(db, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property !== "update") return value;
        return (table: typeof userData) => {
          const update = value.call(target, table);
          if (table !== userData) return update;
          return {
            set: (values: Record<string, unknown>) => {
              const builder = update.set(values);
              return {
                where: async (...conditions: unknown[]) => {
                  await patch({ updatedAt: changedAt, curHealth: 42 });
                  return builder.where(...conditions);
                },
              };
            },
          };
        };
      },
    });
    const result = await travelRouter
      .createCaller({ drizzle: racingDb, userId: USER } as never)
      .finishGlobalMove();
    expect(result).toMatchObject({
      success: false,
      message: "Your travel state changed. Please try again",
    });
    expect(await read()).toMatchObject({
      status: "TRAVEL",
      regenAt,
      curEnergy: before.curEnergy,
      curHealth: 42,
      updatedAt: changedAt,
    });
    expect(await readEnergyQueue(USER)).toEqual(entries);
  });
  it("preloads real Energy capacity and boosted recovery before forced combat loadouts", async () => {
    await prepare([]);
    const db = await getTestDatabase();
    await patch({ isOutlaw: true, stealthActive: false, curEnergy: 250 });
    await insertUsers([{ userId: "attacker", username: "Attacker", rank: "JONIN", level: 1, status: "AWAKE", isOutlaw: true, sector: HOME, longitude: 25, latitude: 10 }]);
    await insertItems([{ id: "energy-armor", itemType: "ARMOR", effects: [makeEffect("increasemaxpools", { power: 200, powerPerLevel: 0, calculation: "static", rounds: 1, poolsAffected: ["Energy"] })] }]);
    await insertUserItems([{ userId: USER, itemId: "energy-armor", equipped: "ITEM_1", durability: 100 }]);
    await db.insert(aiProfile).values({ id: "Default", userId: "default-ai", rules: [] });
    await db.insert(gameSetting).values({ id: "regen-gain", name: "regenGainMultiplier", value: 2, time: new Date(Date.now() + 86_400_000) });
    const trigger = vi.spyOn(getServerPusher(), "trigger").mockResolvedValue({} as never);
    try {
      const result = await initiateBattle({
        client: db, userIds: ["attacker"], targetIds: [USER], sector: HOME,
        longitude: 25, latitude: 10, biome: "default",
        forceLoadouts: [{ id: "empty", userId: USER, loadout: { weaponIds: [], consumableIds: [], jutsuIds: [] }, createdAt: new Date(), updatedAt: new Date() }],
      }, "RANKED_SPARRING");
      expect(result.success).toBe(true);
      const state = (await db.query.battle.findFirst({ where: eq(battle.id, result.battleId!) }))!;
      expect(state.extraState.energyCapacity?.[USER]).toBe(300);
      expect(state.extraState.energyRegeneration?.[USER]).toBe(200);
      expect(state.usersState.find(user => user.userId === USER)?.items).toEqual([]);
      expect((await read())!.curEnergy).toBe(250);
    } finally {
      trigger.mockRestore();
    }
  });

  it("settles an offline opponent's due jutsu level and mastery queue before the fight", async () => {
    await prepare([]);
    const db = await getTestDatabase();
    const finished = new Date(Date.now() - 30 * 60_000);
    await patch({
      isOutlaw: true,
      stealthActive: false,
      trainingSpeed: "15min",
      currentlyTrainingMastery: "ninjutsuMastery",
      masteryTrainingStartedAt: new Date(Date.now() - 20 * 60_000),
    });
    await insertUsers([{ userId: "attacker", username: "Attacker", rank: "JONIN", level: 1, status: "AWAKE", isOutlaw: true, sector: HOME, longitude: 25, latitude: 10 }]);
    await db.insert(aiProfile).values({ id: "Default", userId: "default-ai", rules: [] });
    await db.insert(jutsu).values({
      id: "queued-jutsu", name: "Queued", description: "q", battleDescription: "q", effects: [],
      target: "SELF", range: 0, requiredRank: "STUDENT", jutsuRank: "D", jutsuType: "NORMAL", image: "/q.png",
    });
    await db.insert(userJutsu).values({ id: "uj-queued", userId: USER, jutsuId: "queued-jutsu", level: 2, equipped: true, finishTraining: finished });
    await db.insert(userQueue).values({
      id: "q-jutsu", userId: USER, kind: "JUTSU", position: 1, jutsuId: "queued-jutsu", reservedRyo: 0,
      durationSeconds: 60, startsAt: finished, finishesAt: new Date(finished.getTime() + 60_000),
    });
    await queueMasteries(USER, [{ stat: "genjutsuMastery", speed: "1hr" }]);
    const trigger = vi.spyOn(getServerPusher(), "trigger").mockResolvedValue({} as never);
    try {
      const result = await initiateBattle({
        client: db, userIds: ["attacker"], targetIds: [USER], sector: HOME,
        longitude: 25, latitude: 10, biome: "default",
      }, "SPARRING");
      expect(result.success).toBe(true);
      // The queued level started when the previous one finished, before the fighters were read.
      const owned = (await db.query.userJutsu.findFirst({ where: eq(userJutsu.id, "uj-queued") }))!;
      expect(owned.level).toBe(3);
      expect(owned.finishTraining!.getTime()).toBeGreaterThan(finished.getTime());
      const state = (await db.query.battle.findFirst({ where: eq(battle.id, result.battleId!) }))!;
      const fighter = state.usersState.find((user) => user.userId === USER)!;
      expect(fighter.jutsus.find((j) => j.jutsuId === "queued-jutsu")?.level).toBe(3);
      // The finished mastery session was collected and the queued one started at its end.
      const user = (await read())!;
      expect(user.currentlyTrainingMastery).toBe("genjutsuMastery");
      expect(user.trainingSpeed).toBe("1hr");
      expect(user.ninjutsuMastery).toBeGreaterThan(0);
      expect(user.masteryQueueHead).toBe(1);
      expect(await readMasteryQueue(USER)).toEqual([]);
      // The started jutsu row is gone; the consumed mastery row waits for the next edit.
      expect((await db.select().from(userQueue)).map((row) => row.kind)).toEqual(["MASTERY"]);
      expect((await db.select().from(trainingLog)).map((log) => log.stat)).toEqual(["ninjutsuMastery"]);
    } finally {
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
      await db
        .insert(aiProfile)
        .values({ id: "Default", userId: "default-ai", rules: [] });
      await db
        .insert(gameSetting)
        .values({
          id: "training-gain",
          name: "trainingGainMultiplier",
          value: 2,
          time: new Date(Date.now() + 86_400_000),
        });
      const trigger = vi
        .spyOn(getServerPusher(), "trigger")
        .mockResolvedValue({} as never);
      try {
        let injectFailure = mode === "partial failure";
        const racingDb = new Proxy(db, {
          get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (property !== "update") return value;
            return (table: typeof userData) => {
              const update = value.call(target, table);
              if (table !== userData || !injectFailure) return update;
              injectFailure = false;
              return {
                set: (values: Record<string, unknown>) => {
                  const builder = update.set(values);
                  return {
                    where: async (...conditions: unknown[]) => {
                      await db
                        .update(userData)
                        .set({ status: "HOSPITALIZED" })
                        .where(eq(userData.userId, "attacker"));
                      return builder.where(...conditions);
                    },
                  };
                },
              };
            };
          },
        });
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
        expect(user.offence).toBe(270);
        expect(user.defence).toBe(270);
        expect(user.experience).toBe(520);
        expect(user.curHealth).toBe(300);
        expect(user.curChakra).toBe(300);
        expect(user.curStamina).toBe(300);
        if (result) {
          const state = await db.query.battle.findFirst({
            where: eq(battle.id, result.battleId!),
          });
          expect(state!.extraState.energyRegeneration?.[USER]).toBe(100);
          expect(
            state!.usersState.find((fighter) => fighter.userId === USER)!.offence,
          ).toBe(270);
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
