import { and, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
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
import {
  boostInactivePredicate,
  mergeActiveBoostsExpression,
} from "@/server/utils/shrine";
import {
  getCurrentSlotBoundary,
  getSlotIndex,
  isNewSlotDue,
  secondsFromDate,
} from "@/utils/time";
import type { BoostTemplateEntry } from "@/validators/shrine";

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
      ? `Shrine maintenance completed: boost tick (${boostResult.activeUpdated} activated), stale lobbies cleared ${staleLobbyResult.lobbiesCleared} (${staleLobbyResult.usersReset} users reset), daily maintenance (${maintenanceResult.sectorsChecked} sectors checked, ${maintenanceResult.shrinesDowngraded} downgraded, ${maintenanceResult.shrinesDestroyed} destroyed)`
      : `Shrine boost tick completed: ${boostResult.activeUpdated} activated; stale lobbies cleared ${staleLobbyResult.lobbiesCleared} (${staleLobbyResult.usersReset} users reset)`;

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
  villageTokens: number;
  shrineSettings: ShrineSettings | null;
  hasLevel3Shrine: boolean;
  boostCost: number;
}): { boostType: BoostTemplateEntry["boostType"]; newEndAt: string }[] {
  const { now, prevTime, villageTokens, shrineSettings, hasLevel3Shrine, boostCost } =
    params;

  // Defensive guard: callers already gate on slot boundaries, but keeping the
  // check here makes direct callers safe as well.
  if (!isNewSlotDue(now, prevTime)) return [];

  // Village must control at least one Level 3 shrine
  if (!hasLevel3Shrine) return [];

  const template = shrineSettings?.boostTemplate ?? [];
  if (template.length === 0) return [];

  const currentDayOfWeek = now.getUTCDay();
  // Only the slot containing `now` is activated; earlier slots whose boundaries
  // were crossed during a >2h cron outage are intentionally NOT backfilled.
  // A boost lasts SHRINE_BOOST_DURATION_HOURS (2h) — exactly one slot — so any
  // earlier missed slot's window (slotStart + 2h <= the current slot start <= now)
  // has already fully elapsed; activating it would spend SHRINE_BOOST_COST tokens
  // on an immediately-expired boost. This holds only while the boost duration
  // equals the slot length: if SHRINE_BOOST_DURATION_HOURS ever exceeds it,
  // earlier missed slots could still have live windows and this would need to
  // walk every boundary in (prevTime, now] and emit per-slot, slot-anchored expiries.
  const currentSlotIndex = getSlotIndex(now.getUTCHours());

  // Find matching template entries for current slot. Dedupe by boost type: the
  // setBoostTemplate validator rejects duplicate (boostType, day, slot) rows, but a
  // direct/legacy DB write could still contain them — without this a repeated type
  // would be charged once per occurrence while JSON_SET writes the key only once.
  const matchingEntries = [
    ...new Set(
      template
        .filter(
          (e) => e.dayOfWeek === currentDayOfWeek && e.slotIndex === currentSlotIndex,
        )
        .map((e) => e.boostType as BoostTemplateEntry["boostType"]),
    ),
  ].sort(); // alphabetical for deterministic partial activation

  const activeBoosts = shrineSettings?.activeBoosts ?? {};
  const boostDurationMs = SHRINE_BOOST_DURATION_HOURS * 60 * 60 * 1000;
  // Anchor expiry to the slot start, not the (possibly-jittered) cron firing time,
  // so the expiry lands exactly on the next slot boundary. Otherwise a late tick
  // pushes the expiry past the next boundary and the following slot gets skipped.
  const slotStartMs = getCurrentSlotBoundary(now).getTime();
  const results: { boostType: BoostTemplateEntry["boostType"]; newEndAt: string }[] =
    [];
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
      newEndAt: new Date(slotStartMs + boostDurationMs).toISOString(),
    });
  }

  return results;
}

/**
 * Activates template-driven shrine boosts on UTC 2-hour slot boundaries.
 *
 * Templates are the only producer of village boosts the cron handles — there is
 * no schedule table — so outside a slot boundary there is nothing to do and the
 * full village scan is skipped. Expired boosts are not actively cleared: every
 * consumer (`getShrineBoost`, the UI) treats a past-expiry key as inactive, the
 * per-type keys are bounded and overwritten on re-activation, and
 * `boostInactivePredicate` lets a lapsed type re-activate on its next slot.
 */
async function runShrineBoostTick(now: Date, prevTime: Date) {
  // Template boosts only fire on slot boundaries; nothing to process otherwise.
  if (!isNewSlotDue(now, prevTime)) return { activeUpdated: 0 };

  // Only needed on slot boundaries: villages (to read templates) and the set of
  // villages controlling a Level 3 shrine (a prerequisite for activation).
  const [allVillages, level3Sectors] = await Promise.all([
    drizzleDB.query.village.findMany({
      columns: { id: true, shrineSettings: true, tokens: true },
    }),
    drizzleDB
      .select({ villageId: sector.villageId })
      .from(sector)
      .where(eq(sector.shrineLevel, 3)),
  ]);

  const villagesWithLevel3Shrine = new Set(level3Sectors.map((s) => s.villageId));

  // Scale the work with template users, not total villages.
  const villagesWithTemplate = allVillages.filter(
    (v) =>
      ((v.shrineSettings as ShrineSettings | null)?.boostTemplate?.length ?? 0) > 0,
  );

  const pendingTemplateActivations: {
    villageId: string;
    boostType: BoostTemplateEntry["boostType"];
    newEndAt: string;
  }[] = [];

  for (const villageData of villagesWithTemplate) {
    const settings = villageData.shrineSettings as ShrineSettings | null;
    const templateActivations = computeTemplateActivations({
      now,
      prevTime,
      villageTokens: villageData.tokens ?? 0,
      shrineSettings: settings,
      hasLevel3Shrine: villagesWithLevel3Shrine.has(villageData.id),
      boostCost: SHRINE_BOOST_COST,
    });
    for (const activation of templateActivations) {
      pendingTemplateActivations.push({ villageId: villageData.id, ...activation });
    }
  }

  // Group activations by village so each row takes a single UPDATE instead of
  // one round-trip per boost type. MySQL serializes writes to the same row, so a
  // village whose template activates several types in one slot would otherwise
  // pay N sequential round-trips. mergeActiveBoostsExpression upserts all of a
  // village's keys in one JSON_SET, and the token + per-type
  // boostInactivePredicate guards keep the write idempotent: a retried tick can
  // never double-deduct tokens or overwrite a still-live boost.
  //
  // Trade-off: the all-CAS WHERE makes the whole batched update no-op if ANY one
  // of the village's types was concurrently activated (e.g. by Kage activateBoost
  // between this tick's read and write), rather than the unaffected types
  // succeeding independently. That race on the exact slot boundary is rare and
  // only costs a one-slot activation delay — never tokens or a clobbered boost.
  const nowIso = now.toISOString();
  const activationsByVillage = new Map<
    string,
    { boostType: BoostTemplateEntry["boostType"]; endAt: string }[]
  >();
  for (const { villageId, boostType, newEndAt } of pendingTemplateActivations) {
    const upserts = activationsByVillage.get(villageId) ?? [];
    upserts.push({ boostType, endAt: newEndAt });
    activationsByVillage.set(villageId, upserts);
  }

  const templateUpdateResults = await Promise.all(
    [...activationsByVillage.entries()].map(async ([villageId, upserts]) => {
      const totalCost = SHRINE_BOOST_COST * upserts.length;
      const res = await drizzleDB
        .update(village)
        .set({
          shrineSettings: mergeActiveBoostsExpression({ removeKeys: [], upserts }),
          tokens: sql`${village.tokens} - ${totalCost}`,
        })
        .where(
          and(
            eq(village.id, villageId),
            gte(village.tokens, totalCost),
            ...upserts.map((u) => boostInactivePredicate(u.boostType, nowIso)),
          ),
        );
      return { res, count: upserts.length };
    }),
  );

  // One affected row applied all of that village's upserts, so count activated
  // boosts (rowsAffected * upserts) rather than rows for an accurate log total.
  const activeUpdated = templateUpdateResults.reduce(
    (total, { res, count }) => total + (res.rowsAffected ?? 0) * count,
    0,
  );

  return { activeUpdated };
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
