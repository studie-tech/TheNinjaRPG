import { and, eq, gt, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import {
  SHRINE_BOOST_COST,
  SHRINE_BOOST_DURATION_HOURS,
  shrineLobbyFreshAfter,
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
import { getSlotIndex, isNewSlotDue, secondsFromDate } from "@/utils/time";

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
      runShrineBoostTick(now, minuteCheck.prevTime),
      runStaleShrineLobbyCleanup(now),
    ]);

    // Check daily timer for shrine downgrade maintenance
    dailyCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME_DAILY);
    const maintenanceResult = dailyCheck.isNewDay
      ? await runShrineMaintenance(now)
      : null;

    const message = maintenanceResult
      ? `Shrine maintenance completed: boost tick (${boostResult.activeUpdated} activated, ${boostResult.expiredDeleted} expired), stale lobbies cleared ${staleLobbyResult.lobbiesCleared} (${staleLobbyResult.usersReset} users reset), daily maintenance (${maintenanceResult.sectorsChecked} sectors checked, ${maintenanceResult.shrinesDowngraded} downgraded, ${maintenanceResult.shrinesDestroyed} destroyed)`
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

type BoostTemplateEntry = {
  boostType: string;
  dayOfWeek: number;
  slotIndex: number;
};

type ShrineSettings = {
  unlockedAiIds?: string[];
  activeBoosts?: Record<string, string>;
  activeAiIds?: string[];
  boostTemplate?: BoostTemplateEntry[];
  boostTemplateUpdatedBy?: string;
  boostTemplateUpdatedAt?: string;
};

/**
 * Returns the set of boost types to activate from the template for a village.
 * Skips boosts already active, skips if no Level 3 shrine in the village sector,
 * activates alphabetically until tokens run out.
 */
export function computeTemplateActivations(params: {
  now: Date;
  prevTime: Date;
  villageId: string;
  villageTokens: number;
  shrineSettings: ShrineSettings | null;
  villagesWithLevel3Shrine: Set<string>;
  boostCost: number;
}): { boostType: string; newEndAt: string }[] {
  const {
    now,
    prevTime,
    villageId,
    villageTokens,
    shrineSettings,
    villagesWithLevel3Shrine,
    boostCost,
  } = params;

  // Only fire at slot boundaries
  if (!isNewSlotDue(now, prevTime)) return [];

  // Village must control at least one Level 3 shrine
  if (!villagesWithLevel3Shrine.has(villageId)) return [];

  const template = shrineSettings?.boostTemplate ?? [];
  if (template.length === 0) return [];

  const currentDayOfWeek = now.getUTCDay();
  const currentSlotIndex = getSlotIndex(now.getUTCHours());

  // Find matching template entries for current slot
  const matchingEntries = template
    .filter((e) => e.dayOfWeek === currentDayOfWeek && e.slotIndex === currentSlotIndex)
    .map((e) => e.boostType)
    .sort(); // alphabetical for deterministic partial activation

  const activeBoosts = shrineSettings?.activeBoosts ?? {};
  const boostDurationMs = SHRINE_BOOST_DURATION_HOURS * 60 * 60 * 1000;
  const results: { boostType: string; newEndAt: string }[] = [];
  let remainingTokens = villageTokens;

  for (const boostType of matchingEntries) {
    // Skip if already active with future expiry
    const existingExpiry = activeBoosts[boostType];
    if (existingExpiry) {
      const expiryMs = Date.parse(existingExpiry);
      if (Number.isFinite(expiryMs) && expiryMs > now.getTime()) continue;
    }

    // Skip if insufficient tokens
    if (remainingTokens < boostCost) break;

    remainingTokens -= boostCost;
    results.push({
      boostType,
      newEndAt: new Date(now.getTime() + boostDurationMs).toISOString(),
    });
  }

  return results;
}

/**
 * Processes shrine boost schedules:
 * 1. Activates scheduled boosts that have started
 * 2. Removes expired boosts from villages
 * 3. Deletes expired schedule records
 */
async function runShrineBoostTick(
  now: Date = new Date(),
  prevTime: Date = new Date(0),
) {
  const isSlotBoundary = isNewSlotDue(now, prevTime);

  // Fetch all schedules, villages, and (conditionally) level-3 sectors in parallel
  const [activeSchedules, expiredSchedules, allVillages, level3Sectors] =
    await Promise.all([
      drizzleDB
        .select()
        .from(shrineBoostSchedule)
        .where(
          and(
            lte(shrineBoostSchedule.startAt, now),
            gt(shrineBoostSchedule.endAt, now),
          ),
        ),
      drizzleDB
        .select()
        .from(shrineBoostSchedule)
        .where(lte(shrineBoostSchedule.endAt, now)),
      drizzleDB.query.village.findMany({
        columns: { id: true, shrineSettings: true, tokens: true, sector: true },
      }),
      isSlotBoundary
        ? drizzleDB
            .select({ villageId: sector.villageId })
            .from(sector)
            .where(eq(sector.shrineLevel, 3))
        : Promise.resolve([]),
    ]);

  const villagesWithLevel3Shrine = new Set(level3Sectors.map((s) => s.villageId));

  const villageMap = new Map(allVillages.map((v) => [v.id, v]));

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
    const villageData = villageMap.get(schedule.villageId);
    const storedEndAt = (villageData?.shrineSettings as ShrineSettings | null)
      ?.activeBoosts?.[schedule.boostType];
    if (!storedEndAt) continue;

    const storedEndAtMs = Date.parse(storedEndAt);
    if (!Number.isFinite(storedEndAtMs) || storedEndAtMs > now.getTime()) continue;

    if (!expiredByVillage.has(schedule.villageId)) {
      expiredByVillage.set(schedule.villageId, new Set());
    }
    expiredByVillage.get(schedule.villageId)?.add(schedule.boostType);
  }

  // Batch per-village updates: base (expiry + scheduled, always) and template (CAS, separate)
  const allAffectedVillageIds = new Set([
    ...[...latestActiveByKey.values()].map((v) => v.villageId),
    ...expiredByVillage.keys(),
    ...(isSlotBoundary ? allVillages.map((v) => v.id) : []),
  ]);

  let activeUpdated = 0;
  const baseUpdates: Promise<unknown>[] = [];
  const templateUpdates: Promise<unknown>[] = [];

  for (const villageId of allAffectedVillageIds) {
    const villageData = villageMap.get(villageId);
    const settings = villageData?.shrineSettings as ShrineSettings | null;
    const currentBoostsBase = { ...(settings?.activeBoosts ?? {}) };
    let hasBaseChanges = false;

    // Remove expired boosts
    const expired = expiredByVillage.get(villageId);
    if (expired) {
      for (const boostType of expired) {
        if (boostType in currentBoostsBase) {
          delete currentBoostsBase[boostType];
          hasBaseChanges = true;
        }
      }
    }

    // Add/update active boosts from schedule
    for (const { villageId: vid, boostType, endAt } of latestActiveByKey.values()) {
      if (vid !== villageId) continue;
      const newEndAt = endAt.toISOString();
      if (currentBoostsBase[boostType] !== newEndAt) {
        currentBoostsBase[boostType] = newEndAt;
        hasBaseChanges = true;
        activeUpdated++;
      }
    }

    // Base update (always succeeds, no CAS): expiry cleanup + scheduled boosts
    if (hasBaseChanges) {
      baseUpdates.push(
        drizzleDB
          .update(village)
          .set({
            shrineSettings: withUpdatedBoosts(settings ?? null, currentBoostsBase),
          })
          .where(eq(village.id, villageId)),
      );
    }

    // Template activations — separate CAS update so expiry cleanup is never blocked by tokens
    const templateActivations = computeTemplateActivations({
      now,
      prevTime,
      villageId,
      villageTokens: villageData?.tokens ?? 0,
      shrineSettings: settings,
      villagesWithLevel3Shrine,
      boostCost: SHRINE_BOOST_COST,
    });
    activeUpdated += templateActivations.length;

    if (templateActivations.length > 0) {
      const tokenCost = templateActivations.length * SHRINE_BOOST_COST;
      // Use nested JSON_SET to add only the new boost keys — avoids overwriting base changes
      let jsonExpr: ReturnType<typeof sql> = sql`${village.shrineSettings}`;
      for (const { boostType, newEndAt } of templateActivations) {
        jsonExpr = sql`JSON_SET(${jsonExpr}, ${`$.activeBoosts.${boostType}`}, ${newEndAt})`;
      }
      templateUpdates.push(
        drizzleDB
          .update(village)
          .set({
            shrineSettings: jsonExpr,
            tokens: sql`${village.tokens} - ${tokenCost}`,
          })
          .where(and(eq(village.id, villageId), gte(village.tokens, tokenCost))),
      );
    }
  }

  // Round 1: base updates always succeed (no CAS guard) — ensures expiry cleanup is committed
  await Promise.all(baseUpdates);

  // Round 2: template CAS updates + delete expired schedule records
  // Expired schedule deletion runs after base cleanup is committed
  type ScheduleType = (typeof expiredSchedules)[number];
  const expiredScheduleIds = expiredSchedules.map((s: ScheduleType) => s.id);
  const deleteExpired =
    expiredScheduleIds.length > 0
      ? drizzleDB
          .delete(shrineBoostSchedule)
          .where(inArray(shrineBoostSchedule.id, expiredScheduleIds))
      : Promise.resolve();

  await Promise.all([...templateUpdates, deleteExpired]);

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
  const cutoff = shrineLobbyFreshAfter(now);

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

  const deletedQueueIds = staleLobbies.map((row) => row.id);

  // Re-check isNull(battleId) at execution time via a subquery so any lobby
  // claimed between the SELECT above and these statements is excluded from both
  // child cleanup and parent delete (claimed rows have battleId set).
  const unclaimedSubquery = db
    .select({ id: mpvpBattleQueue.id })
    .from(mpvpBattleQueue)
    .where(
      and(
        inArray(mpvpBattleQueue.id, deletedQueueIds),
        isNull(mpvpBattleQueue.battleId),
        lt(mpvpBattleQueue.createdAt, cutoff),
      ),
    );

  const unclaimedUsersSubquery = db
    .select({ userId: mpvpBattleUser.userId })
    .from(mpvpBattleUser)
    .where(inArray(mpvpBattleUser.clanBattleId, unclaimedSubquery));

  // Step 1a: reset user statuses while mpvpBattleUser rows still exist —
  // the subquery reads from mpvpBattleUser, so the UPDATE must precede the DELETE.
  const resetResult = await db
    .update(userData)
    .set({ status: "AWAKE" })
    .where(
      and(
        inArray(userData.userId, unclaimedUsersSubquery),
        eq(userData.status, "QUEUED"),
      ),
    );

  // Step 1b: now safe to drop the child rows
  await db
    .delete(mpvpBattleUser)
    .where(inArray(mpvpBattleUser.clanBattleId, unclaimedSubquery));

  // Step 2: parent delete with the same guard
  const deleteResult = await db
    .delete(mpvpBattleQueue)
    .where(
      and(
        inArray(mpvpBattleQueue.id, deletedQueueIds),
        eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
        isNull(mpvpBattleQueue.battleId),
        lt(mpvpBattleQueue.createdAt, cutoff),
      ),
    );

  return {
    lobbiesCleared: deleteResult.rowsAffected ?? 0,
    usersReset: resetResult.rowsAffected ?? 0,
  };
}

/** Builds a JSON_SET expression that updates only activeBoosts/unlockedAiIds/activeAiIds,
 *  leaving boostTemplate and related fields untouched to prevent concurrent-write races. */
function withUpdatedBoosts(
  settings: ShrineSettings | null,
  activeBoosts: Record<string, string>,
): ReturnType<typeof sql> {
  return sql`JSON_SET(
    COALESCE(${village.shrineSettings}, JSON_OBJECT()),
    '$.activeBoosts', CAST(${JSON.stringify(activeBoosts)} AS JSON),
    '$.unlockedAiIds', CAST(${JSON.stringify(settings?.unlockedAiIds ?? [])} AS JSON),
    '$.activeAiIds', CAST(${JSON.stringify(settings?.activeAiIds ?? [])} AS JSON)
  )`;
}
