import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  SHRINE_AI_UNLOCK_COST,
  SHRINE_BOOST_COST,
  SHRINE_UPGRADE_COST,
  SHRINE_WEEKLY_MAINTENANCE_COST,
  WAR_SHRINE_MAINTENANCE_DAYS,
} from "@/drizzle/constants";
import { sector, userData, village } from "@/drizzle/schema";
import { shrineRouter } from "@/server/api/routers/shrine";
import type { DrizzleClient } from "@/server/db";
import { insertUsers } from "../../../setup/factories";
import { resetServerModuleStubs, stubProfile } from "../../../setup/serverModules";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const userId = "shrine-cache-kage";
const villageId = "shrine-cache-village";
const aiId = "shrine-cache-ai";
const sectorId = 32001;
const initialTokens = 100000000;
const concurrentTokens = 7;
const concurrentBoost = "2040-01-01T00:00:00.000Z";
const maintenanceAt = new Date("2026-01-01T00:00:00.000Z");
const template = [{ boostType: "Training", dayOfWeek: 2, slotIndex: 3 }] as const;

type ShrineCaller = ReturnType<typeof shrineRouter.createCaller>;
type StoredVillage = typeof village.$inferSelect | undefined;

/** One shrine mutation: its setup, call, token cost, expected shrineSettings patch and stored effect. */
type ShrineEndpoint = {
  setup?: (db: DrizzleClient) => Promise<unknown>;
  call: (caller: ShrineCaller) => ReturnType<ShrineCaller[ShrineEndpointName]>;
  cost: number;
  patch: (stored: StoredVillage) => Record<string, unknown> | undefined;
  verify: (db: DrizzleClient, stored: StoredVillage) => Promise<void> | void;
};
type ShrineEndpointName =
  | "upgradeShrine"
  | "activateBoost"
  | "unlockAiDefender"
  | "toggleVillageAiDefender"
  | "payWeeklyMaintenance"
  | "setBoostTemplate";

const endpoints = {
  upgradeShrine: {
    setup: (db) =>
      db.update(sector).set({ shrineLevel: 2 }).where(eq(sector.id, sectorId)),
    call: (caller) => caller.upgradeShrine({ sectorNumber: sectorId }),
    cost: SHRINE_UPGRADE_COST,
    patch: () => undefined,
    verify: async (db) => {
      const updated = await db.query.sector.findFirst({
        where: eq(sector.id, sectorId),
      });
      expect(updated?.shrineLevel).toBe(3);
    },
  },
  activateBoost: {
    call: (caller) => caller.activateBoost({ boostType: "Training", villageId }),
    cost: SHRINE_BOOST_COST,
    patch: (stored) => ({
      activeBoosts: { Training: stored?.shrineSettings.activeBoosts.Training },
    }),
    verify: (_db, stored) => {
      expect(
        new Date(stored?.shrineSettings.activeBoosts.Training ?? "").getTime(),
      ).toBeGreaterThan(Date.now());
    },
  },
  unlockAiDefender: {
    call: (caller) => caller.unlockAiDefender({ aiId }),
    cost: SHRINE_AI_UNLOCK_COST,
    patch: (stored) => ({ unlockedAiIds: stored?.shrineSettings.unlockedAiIds }),
    verify: (_db, stored) => {
      expect(stored?.shrineSettings.unlockedAiIds).toEqual([aiId]);
    },
  },
  toggleVillageAiDefender: {
    setup: (db) =>
      db
        .update(village)
        .set({
          shrineSettings: {
            unlockedAiIds: [aiId],
            activeBoosts: { PVP: "2020-01-01T00:00:00.000Z" },
            activeAiIds: [],
          },
        })
        .where(eq(village.id, villageId)),
    call: (caller) => caller.toggleVillageAiDefender({ aiId }),
    cost: 0,
    patch: (stored) => ({ activeAiIds: stored?.shrineSettings.activeAiIds }),
    verify: (_db, stored) => {
      expect(stored?.shrineSettings.activeAiIds).toEqual([aiId]);
    },
  },
  payWeeklyMaintenance: {
    call: (caller) => caller.payWeeklyMaintenance({ sectorId }),
    cost: SHRINE_WEEKLY_MAINTENANCE_COST,
    patch: () => undefined,
    verify: async (db) => {
      const updated = await db.query.sector.findFirst({
        where: eq(sector.id, sectorId),
      });
      expect(updated?.nextMaintainanceDueDate?.getTime()).toBe(
        maintenanceAt.getTime() + WAR_SHRINE_MAINTENANCE_DAYS * 24 * 60 * 60 * 1000,
      );
    },
  },
  setBoostTemplate: {
    call: (caller) => caller.setBoostTemplate({ villageId, template: [...template] }),
    cost: 0,
    patch: (stored) => ({
      boostTemplate: stored?.shrineSettings.boostTemplate,
      boostTemplateUpdatedBy: stored?.shrineSettings.boostTemplateUpdatedBy,
      boostTemplateUpdatedAt: stored?.shrineSettings.boostTemplateUpdatedAt,
    }),
    verify: (_db, stored) => {
      expect(stored?.shrineSettings.boostTemplate).toEqual<typeof template>(template);
      expect(stored?.shrineSettings.boostTemplateUpdatedBy).toBe("CacheKage");
      expect(stored?.shrineSettings.boostTemplateUpdatedAt).toEqual(expect.any(String));
    },
  },
} satisfies Record<ShrineEndpointName, ShrineEndpoint>;

describeWithDatabase("committed shrine cache state", () => {
  let requiresUserRefresh = false;

  beforeEach(async () => {
    requiresUserRefresh = false;
    await resetTables(sector, village, userData);
    await insertUsers([
      { userId, username: "CacheKage", villageId, rank: "JONIN" },
      { userId: aiId, username: "CacheDefender", isAi: true, inShrines: true },
    ]);
    const db = await getTestDatabase();
    await db.insert(village).values({
      id: villageId,
      name: "Cache Shrine Village",
      sector: sectorId,
      kageId: userId,
      tokens: initialTokens,
      shrineSettings: {
        unlockedAiIds: [],
        activeBoosts: { PVP: "2020-01-01T00:00:00.000Z" },
        activeAiIds: [],
      },
    });
    await db.insert(sector).values({
      id: sectorId,
      sector: sectorId,
      villageId,
      shrineLevel: 3,
      nextMaintainanceDueDate: maintenanceAt,
    });
    stubProfile("fetchUpdatedUser", async () => {
      const [user, currentVillage] = await Promise.all([
        db.query.userData.findFirst({ where: eq(userData.userId, userId) }),
        db.query.village.findFirst({ where: eq(village.id, villageId) }),
      ]);
      // An independent debit/refund and boost-key write can occur after the mutation's snapshot.
      await db
        .update(village)
        .set({
          tokens: sql`${village.tokens} + ${concurrentTokens}`,
          shrineSettings: sql`JSON_SET(${village.shrineSettings}, '$.activeBoosts.PVP', ${concurrentBoost})`,
        })
        .where(eq(village.id, villageId));
      return { user: { ...user, village: currentVillage }, requiresUserRefresh };
    });
  });

  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });

  it("omits destroyed shrines from captured sectors", async () => {
    const db = await getTestDatabase();
    await db.insert(sector).values({ sector: sectorId + 1, villageId, shrineLevel: 0 });
    const caller = await callerFor(shrineRouter, userId);
    expect(await caller.getCapturedSectors({ villageId })).toEqual([
      expect.objectContaining({ sector: sectorId, shrineLevel: 3 }),
    ]);
  });

  for (const endpoint of ["upgradeShrine", "payWeeklyMaintenance"] as const) {
    it(`${endpoint} rejects destroyed shrines before charging tokens`, async () => {
      const db = await getTestDatabase();
      await db.update(sector).set({ shrineLevel: 0 }).where(eq(sector.id, sectorId));
      const caller = await callerFor(shrineRouter, userId);
      const result = await endpoints[endpoint].call(caller);
      expect(result).toMatchObject({
        success: false,
        message: "This shrine has been destroyed",
      });
      expect(
        (await db.query.village.findFirst({ where: eq(village.id, villageId) }))
          ?.tokens,
      ).toBe(initialTokens + concurrentTokens);
      expect(
        await db.query.sector.findFirst({ where: eq(sector.id, sectorId) }),
      ).toEqual(
        expect.objectContaining({
          shrineLevel: 0,
          nextMaintainanceDueDate: maintenanceAt,
        }),
      );
    });
  }

  for (const mustRefresh of [false, true]) {
    for (const [endpoint, shrine] of Object.entries(endpoints) as [
      ShrineEndpointName,
      ShrineEndpoint,
    ][]) {
      it(`${endpoint} returns the confirmed village update and refresh flag ${mustRefresh}`, async () => {
        const db = await getTestDatabase();
        requiresUserRefresh = mustRefresh;
        await shrine.setup?.(db);
        const villageReads = vi.spyOn(db.query.village, "findFirst");
        const caller = await callerFor(shrineRouter, userId);
        const result = await shrine.call(caller);
        expect(result.success).toBe(true);
        const cost = shrine.cost;
        expect(result.userDelta).toEqual(
          mustRefresh
            ? undefined
            : cost
              ? {
                  village: { id: villageId, tokens: -cost },
                }
              : {},
        );
        // Only the initial snapshot reads the village; confirmed writes need no readback.
        expect(villageReads).toHaveBeenCalledTimes(1);
        const stored = await db.query.village.findFirst({
          where: eq(village.id, villageId),
        });
        const shrineSettings = shrine.patch(stored);
        expect(result.userPatch?.village).toEqual<
          { id: string; shrineSettings: typeof shrineSettings } | undefined
        >(
          shrineSettings
            ? {
                id: villageId,
                shrineSettings,
              }
            : undefined,
        );
        expect(stored?.tokens).toBe(initialTokens + concurrentTokens - cost);
        expect(stored?.shrineSettings.activeBoosts.PVP).toBe(concurrentBoost);
        expect(
          result.userPatch?.village?.shrineSettings?.activeBoosts?.PVP,
        ).toBeUndefined();
        await shrine.verify(db, stored);
      });
    }
  }
});
