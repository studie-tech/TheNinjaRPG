// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  SHRINE_AI_UNLOCK_COST,
  SHRINE_BOOST_COST,
  SHRINE_UPGRADE_COST,
  SHRINE_WEEKLY_MAINTENANCE_COST,
  WAR_SHRINE_MAINTENANCE_DAYS,
} from "@/drizzle/constants";
import { sector, userData, village } from "@/drizzle/schema";
import { shrineRouter } from "@/server/api/routers/shrine";
import { insertUsers } from "../../setup/factories";
import { resetServerModuleStubs, stubProfile } from "../../setup/serverModules";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const userId = "shrine-cache-kage";
const villageId = "shrine-cache-village";
const aiId = "shrine-cache-ai";
const sectorId = 32001;
const initialTokens = 100000000;
const maintenanceAt = new Date("2026-01-01T00:00:00.000Z");
const template = [{ boostType: "Training", dayOfWeek: 2, slotIndex: 3 }] as const;

describeWithDatabase("committed shrine cache state", () => {
  let requiresUserRefresh = false;

  beforeEach(async () => {
    requiresUserRefresh = false;
    await resetTables(sector, village, userData);
    await insertUsers([
      { userId, username: "CacheKage", villageId, rank: "JONIN" },
      { userId: aiId, username: "CacheDefender", isAi: true },
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
    stubProfile("fetchUser", async (_client: unknown, id: string) =>
      db.query.userData.findFirst({ where: eq(userData.userId, id) }),
    );
    stubProfile("fetchUpdatedUser", async () => {
      const [user, currentVillage] = await Promise.all([
        db.query.userData.findFirst({ where: eq(userData.userId, userId) }),
        db.query.village.findFirst({ where: eq(village.id, villageId) }),
      ]);
      return { user: { ...user, village: currentVillage }, requiresUserRefresh };
    });
  });

  afterEach(resetServerModuleStubs);

  for (const mustRefresh of [false, true]) {
    for (const endpoint of [
      "upgradeShrine",
      "activateBoost",
      "unlockAiDefender",
      "toggleVillageAiDefender",
      "payWeeklyMaintenance",
      "setBoostTemplate",
    ] as const) {
      it(`${endpoint} returns exact committed village state and refresh flag ${mustRefresh}`, async () => {
        const db = await getTestDatabase();
        requiresUserRefresh = mustRefresh;
        if (endpoint === "upgradeShrine") {
          await db
            .update(sector)
            .set({ shrineLevel: 2 })
            .where(eq(sector.id, sectorId));
        }
        if (endpoint === "toggleVillageAiDefender") {
          await db
            .update(village)
            .set({
              shrineSettings: {
                unlockedAiIds: [aiId],
                activeBoosts: { PVP: "2020-01-01T00:00:00.000Z" },
                activeAiIds: [],
              },
            })
            .where(eq(village.id, villageId));
        }
        const caller = await callerFor(shrineRouter, userId);
        const result = await (endpoint === "upgradeShrine"
          ? caller.upgradeShrine({ sectorNumber: sectorId })
          : endpoint === "activateBoost"
            ? caller.activateBoost({ boostType: "Training", villageId })
            : endpoint === "unlockAiDefender"
              ? caller.unlockAiDefender({ aiId })
              : endpoint === "toggleVillageAiDefender"
                ? caller.toggleVillageAiDefender({ aiId })
                : endpoint === "payWeeklyMaintenance"
                  ? caller.payWeeklyMaintenance({ sectorId })
                  : caller.setBoostTemplate({ villageId, template: [...template] }));
        expect(result.success).toBe(true);
        expect(result.requiresUserRefresh).toBe(mustRefresh);
        const stored = await db.query.village.findFirst({
          where: eq(village.id, villageId),
        });
        expect(result.villageUpdate).toEqual({
          id: stored?.id,
          tokens: stored?.tokens,
          shrineSettings: stored?.shrineSettings,
        });
        const cost =
          endpoint === "upgradeShrine"
            ? SHRINE_UPGRADE_COST
            : endpoint === "activateBoost"
              ? SHRINE_BOOST_COST
              : endpoint === "unlockAiDefender"
                ? SHRINE_AI_UNLOCK_COST
                : endpoint === "payWeeklyMaintenance"
                  ? SHRINE_WEEKLY_MAINTENANCE_COST
                  : 0;
        expect(stored?.tokens).toBe(initialTokens - cost);
        expect(stored?.shrineSettings.activeBoosts.PVP).toBe(
          "2020-01-01T00:00:00.000Z",
        );
        if (endpoint === "upgradeShrine") {
          const updated = await db.query.sector.findFirst({
            where: eq(sector.id, sectorId),
          });
          expect(updated?.shrineLevel).toBe(3);
        } else if (endpoint === "activateBoost") {
          expect(
            new Date(stored?.shrineSettings.activeBoosts.Training ?? "").getTime(),
          ).toBeGreaterThan(Date.now());
        } else if (endpoint === "unlockAiDefender") {
          expect(stored?.shrineSettings.unlockedAiIds).toEqual([aiId]);
        } else if (endpoint === "toggleVillageAiDefender") {
          expect(stored?.shrineSettings.activeAiIds).toEqual([aiId]);
        } else if (endpoint === "payWeeklyMaintenance") {
          const updated = await db.query.sector.findFirst({
            where: eq(sector.id, sectorId),
          });
          expect(updated?.nextMaintainanceDueDate?.getTime()).toBe(
            maintenanceAt.getTime() + WAR_SHRINE_MAINTENANCE_DAYS * 24 * 60 * 60 * 1000,
          );
        } else {
          expect(stored?.shrineSettings.boostTemplate).toEqual(template);
          expect(stored?.shrineSettings.boostTemplateUpdatedBy).toBe("CacheKage");
          expect(stored?.shrineSettings.boostTemplateUpdatedAt).toEqual(
            expect.any(String),
          );
        }
      });
    }
  }
});
