import { drizzleDB } from "@/server/db";
import { sector, shrineBoostSchedule, village } from "@/drizzle/schema";
import { eq, lte, gt, inArray, and } from "drizzle-orm";
import {
  lockWithMinuteTimer,
  lockWithDailyTimer,
  handleEndpointError,
  updateGameSetting,
} from "@/libs/gamesettings";
import { fetchVillages } from "@/server/api/routers/village";
import { cookies } from "next/headers";

const ENDPOINT_NAME = "shrine-maintenance";
const ENDPOINT_NAME_DAILY = "shrine-maintenance-daily";

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check timer - run once per minute
  const minuteCheck = await lockWithMinuteTimer(drizzleDB, ENDPOINT_NAME);
  if (!minuteCheck.isNewMinute && minuteCheck.response) return minuteCheck.response;

  try {
    const now = new Date();

    // Run shrine boost tick (every minute)
    const boostResult = await runShrineBoostTick(now);

    // Check daily timer for shrine downgrade maintenance
    const dailyCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME_DAILY);
    const maintenanceResult = dailyCheck.isNewDay
      ? await runShrineMaintenance(now)
      : null;

    const message = maintenanceResult
      ? `Shrine maintenance completed: boost tick (${boostResult.activeUpdated} activated, ${boostResult.expiredDeleted} expired), daily maintenance (${maintenanceResult.sectorsChecked} sectors checked, ${maintenanceResult.shrinesDowngraded} downgraded, ${maintenanceResult.shrinesDestroyed} destroyed)`
      : `Shrine boost tick completed: ${boostResult.activeUpdated} activated, ${boostResult.expiredDeleted} expired`;

    return new Response(message, { status: 200 });
  } catch (cause) {
    // Rollback minute timer
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, minuteCheck.prevTime);
    return handleEndpointError(cause);
  }
}

/**
 * Daily maintenance: Downgrade or destroy shrines that haven't been maintained.
 * Only affects shrines in sectors without a village.
 */
async function runShrineMaintenance(now: Date) {
  const [overdueSectors, villages] = await Promise.all([
    drizzleDB.query.sector.findMany({
      where: lte(sector.nextMaintainanceDueDate, now),
    }),
    fetchVillages(drizzleDB),
  ]);

  const villageSectors = new Set(villages?.map((v) => v.sector) ?? []);

  let shrinesDowngraded = 0;
  let shrinesDestroyed = 0;

  const mutations = overdueSectors
    .filter((s) => !villageSectors.has(s.sector))
    .map((s) => {
      const newLevel = s.shrineLevel - 1;
      if (newLevel < 1) {
        shrinesDestroyed++;
        return drizzleDB.delete(sector).where(eq(sector.id, s.id));
      }
      shrinesDowngraded++;
      return drizzleDB
        .update(sector)
        .set({ shrineLevel: newLevel })
        .where(eq(sector.id, s.id));
    });

  await Promise.all(mutations);

  return {
    sectorsChecked: overdueSectors.length,
    shrinesDowngraded,
    shrinesDestroyed,
  };
}

type ShrineSettings = {
  unlockedAiIds?: string[];
  activeBoosts?: Record<string, string>;
  activeAiIds?: string[];
};

type RequiredShrineSettings = {
  unlockedAiIds: string[];
  activeBoosts: Record<string, string>;
  activeAiIds: string[];
};

/**
 * Processes shrine boost schedules:
 * 1. Activates scheduled boosts that have started
 * 2. Removes expired boosts from villages
 * 3. Deletes expired schedule records
 */
async function runShrineBoostTick(now: Date = new Date()) {
  // Fetch all schedules and all villages in parallel
  const [activeSchedules, expiredSchedules, allVillages] = await Promise.all([
    drizzleDB
      .select()
      .from(shrineBoostSchedule)
      .where(
        and(lte(shrineBoostSchedule.startAt, now), gt(shrineBoostSchedule.endAt, now)),
      ),
    drizzleDB
      .select()
      .from(shrineBoostSchedule)
      .where(lte(shrineBoostSchedule.endAt, now)),
    drizzleDB.query.village.findMany({
      columns: { id: true, shrineSettings: true },
    }),
  ]);

  const villageMap = new Map(
    allVillages.map((v) => [v.id, v.shrineSettings as ShrineSettings | null]),
  );

  // Find the latest endAt for each village+boostType among active schedules
  const latestActiveByKey = new Map<
    string,
    { villageId: string; boostType: string; endAt: Date }
  >();
  for (const schedule of activeSchedules) {
    const key = `${schedule.villageId}:${schedule.boostType}`;
    const existing = latestActiveByKey.get(key);
    if (!existing || schedule.endAt > existing.endAt) {
      latestActiveByKey.set(key, {
        villageId: schedule.villageId,
        boostType: schedule.boostType,
        endAt: schedule.endAt,
      });
    }
  }

  // Collect expired boost types per village (only if stored endAt has passed)
  const expiredByVillage = new Map<string, Set<string>>();
  for (const schedule of expiredSchedules) {
    const settings = villageMap.get(schedule.villageId);
    const storedEndAt = settings?.activeBoosts?.[schedule.boostType];
    if (!storedEndAt) continue;

    const storedEndAtMs = Date.parse(storedEndAt);
    if (!Number.isFinite(storedEndAtMs) || storedEndAtMs > now.getTime()) continue;

    if (!expiredByVillage.has(schedule.villageId)) {
      expiredByVillage.set(schedule.villageId, new Set());
    }
    expiredByVillage.get(schedule.villageId)!.add(schedule.boostType);
  }

  // Merge active and expired updates per village to avoid race conditions
  const allAffectedVillageIds = new Set([
    ...[...latestActiveByKey.values()].map((v) => v.villageId),
    ...expiredByVillage.keys(),
  ]);

  let activeUpdated = 0;
  const villageUpdates: Promise<unknown>[] = [];

  for (const villageId of allAffectedVillageIds) {
    const settings = villageMap.get(villageId);
    const currentBoosts = { ...(settings?.activeBoosts ?? {}) };
    let hasChanges = false;

    // Remove expired boosts
    const expired = expiredByVillage.get(villageId);
    if (expired) {
      for (const boostType of expired) {
        if (boostType in currentBoosts) {
          delete currentBoosts[boostType];
          hasChanges = true;
        }
      }
    }

    // Add/update active boosts
    for (const { villageId: vid, boostType, endAt } of latestActiveByKey.values()) {
      if (vid !== villageId) continue;
      const newEndAt = endAt.toISOString();
      if (currentBoosts[boostType] !== newEndAt) {
        currentBoosts[boostType] = newEndAt;
        hasChanges = true;
        activeUpdated++;
      }
    }

    if (hasChanges) {
      villageUpdates.push(
        drizzleDB
          .update(village)
          .set({ shrineSettings: withUpdatedBoosts(settings ?? null, currentBoosts) })
          .where(eq(village.id, villageId)),
      );
    }
  }

  // Delete expired schedule records
  const expiredScheduleIds = expiredSchedules.map((s) => s.id);
  const deleteExpired =
    expiredScheduleIds.length > 0
      ? drizzleDB
          .delete(shrineBoostSchedule)
          .where(inArray(shrineBoostSchedule.id, expiredScheduleIds))
      : Promise.resolve();

  // Execute all mutations in parallel
  await Promise.all([...villageUpdates, deleteExpired]);

  return { activeUpdated, expiredDeleted: expiredScheduleIds.length };
}

/** Creates an updated shrineSettings object with new activeBoosts */
function withUpdatedBoosts(
  settings: ShrineSettings | null,
  activeBoosts: Record<string, string>,
): RequiredShrineSettings {
  return {
    unlockedAiIds: settings?.unlockedAiIds ?? [],
    activeBoosts,
    activeAiIds: settings?.activeAiIds ?? [],
  };
}
