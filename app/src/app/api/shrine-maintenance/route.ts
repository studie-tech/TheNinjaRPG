import { and, eq, gt, inArray, isNull, lt, lte } from "drizzle-orm";
import { cookies } from "next/headers";
import {
  SHRINE_BATTLE_LOBBY_SECONDS,
  SHRINE_BATTLE_STALE_LOBBY_SECONDS,
  WAR_SHRINE_MAINTENANCE_DAYS,
} from "@/drizzle/constants";
import {
  mpvpBattleQueue,
  mpvpBattleUser,
  sector,
  shrineBoostSchedule,
  userData,
  village,
} from "@/drizzle/schema";
import {
  handleEndpointError,
  lockWithDailyTimer,
  lockWithMinuteTimer,
  updateGameSetting,
} from "@/libs/gamesettings";
import { fetchVillages } from "@/server/api/routers/village";
import { type DrizzleClient, drizzleDB } from "@/server/db";
import { secondsFromDate } from "@/utils/time";

const ENDPOINT_NAME = "shrine-maintenance";
const ENDPOINT_NAME_DAILY = "shrine-maintenance-daily";
type ShrineMaintenanceDb = Pick<DrizzleClient, "select" | "update" | "delete">;

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check timer - run once per minute
  const minuteCheck = await lockWithMinuteTimer(drizzleDB, ENDPOINT_NAME);
  if (!minuteCheck.isNewMinute && minuteCheck.response) return minuteCheck.response;

  let dailyCheck: Awaited<ReturnType<typeof lockWithDailyTimer>> | undefined;

  try {
    const now = new Date();

    // Run shrine boost tick (every minute)
    const [boostResult, staleLobbyResult] = await Promise.all([
      runShrineBoostTick(now),
      runStaleShrineLobbyCleanup(now),
    ]);

    // Check daily timer for shrine downgrade maintenance
    dailyCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME_DAILY);
    const maintenanceResult = dailyCheck.isNewDay
      ? await runShrineMaintenance(now)
      : null;

    const message = maintenanceResult
      ? `Shrine maintenance completed: boost tick (${boostResult.activeUpdated} activated, ${boostResult.expiredDeleted} expired), stale lobbies cleared (${staleLobbyResult.lobbiesCleared}, ${staleLobbyResult.usersReset} users reset), daily maintenance (${maintenanceResult.sectorsChecked} sectors checked, ${maintenanceResult.shrinesDowngraded} downgraded, ${maintenanceResult.shrinesDestroyed} destroyed)`
      : `Shrine boost tick completed: ${boostResult.activeUpdated} activated, ${boostResult.expiredDeleted} expired; stale lobbies cleared ${staleLobbyResult.lobbiesCleared} (${staleLobbyResult.usersReset} users reset)`;

    return new Response(message, { status: 200 });
  } catch (cause) {
    // Rollback minute timer
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, minuteCheck.prevTime);
    // Rollback daily timer if it was acquired
    if (dailyCheck) {
      await updateGameSetting(drizzleDB, ENDPOINT_NAME_DAILY, 0, dailyCheck.prevTime);
    }
    return await handleEndpointError(cause);
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

  type VillageType = NonNullable<typeof villages>[number];
  const villageSectors = new Set(villages?.map((v: VillageType) => v.sector) ?? []);

  let shrinesDowngraded = 0;
  let shrinesDestroyed = 0;

  type SectorType = (typeof overdueSectors)[number];
  const mutations = overdueSectors
    .filter((s: SectorType) => !villageSectors.has(s.sector))
    .map((s: SectorType) => {
      const newLevel = s.shrineLevel - 1;
      if (newLevel < 1) {
        shrinesDestroyed++;
        return drizzleDB.delete(sector).where(eq(sector.id, s.id));
      }
      shrinesDowngraded++;
      const nextMaintainanceDueDate = secondsFromDate(
        WAR_SHRINE_MAINTENANCE_DAYS * 24 * 60 * 60,
        now,
      );
      return drizzleDB
        .update(sector)
        .set({ shrineLevel: newLevel, nextMaintainanceDueDate })
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
    expiredByVillage.get(schedule.villageId)?.add(schedule.boostType);
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
          .set({
            shrineSettings: withUpdatedBoosts(settings ?? null, currentBoosts),
          })
          .where(eq(village.id, villageId)),
      );
    }
  }

  // Delete expired schedule records
  type ScheduleType = (typeof expiredSchedules)[number];
  const expiredScheduleIds = expiredSchedules.map((s: ScheduleType) => s.id);
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

/**
 * Deletes shrine battle lobbies that never progressed into a real battle and
 * resets users who are still marked as queued for those stale lobbies.
 */
export async function runStaleShrineLobbyCleanup(
  now: Date,
  db: ShrineMaintenanceDb = drizzleDB,
) {
  const cutoffSeconds = SHRINE_BATTLE_LOBBY_SECONDS + SHRINE_BATTLE_STALE_LOBBY_SECONDS;
  const cutoff = new Date(now.getTime() - cutoffSeconds * 1000);

  const staleLobbies = await db
    .select({ id: mpvpBattleQueue.id })
    .from(mpvpBattleQueue)
    .where(
      and(
        eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
        isNull(mpvpBattleQueue.battleId),
        lt(mpvpBattleQueue.createdAt, cutoff),
      ),
    );

  if (staleLobbies.length === 0) {
    return { lobbiesCleared: 0, usersReset: 0 };
  }

  const staleIds = staleLobbies.map((row) => row.id);
  const queuedUsers = await db
    .select({ userId: mpvpBattleUser.userId })
    .from(mpvpBattleUser)
    .where(inArray(mpvpBattleUser.clanBattleId, staleIds));
  const userIds = [...new Set(queuedUsers.map((row) => row.userId))];

  let usersReset = 0;
  if (userIds.length > 0) {
    const resetResult = await db
      .update(userData)
      .set({ status: "AWAKE" })
      .where(and(inArray(userData.userId, userIds), eq(userData.status, "QUEUED")));
    usersReset = resetResult.rowsAffected ?? 0;
  }

  await db.delete(mpvpBattleUser).where(inArray(mpvpBattleUser.clanBattleId, staleIds));

  const deleteResult = await db
    .delete(mpvpBattleQueue)
    .where(
      and(
        inArray(mpvpBattleQueue.id, staleIds),
        eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
        isNull(mpvpBattleQueue.battleId),
        lt(mpvpBattleQueue.createdAt, cutoff),
      ),
    );

  return { lobbiesCleared: deleteResult.rowsAffected ?? 0, usersReset };
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
