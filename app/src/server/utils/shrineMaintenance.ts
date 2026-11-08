import { SHRINE_BOOST_DURATION_HOURS } from "@/drizzle/constants";
import type { Village } from "@/drizzle/schema";
import {
  deleteMpvpBattleQueueForRunStaleShrineLobbyCleanup,
  deleteMpvpBattleUserForRunStaleShrineLobbyCleanup,
  selectMpvpBattleQueueForRunStaleShrineLobbyCleanup,
  selectMpvpBattleQueueForRunStaleShrineLobbyCleanup2,
  selectMpvpBattleUserForRunStaleShrineLobbyCleanup,
  updateUserDataForRunStaleShrineLobbyCleanup,
} from "@/queries/shrine";
import { drizzleDB } from "@/server/db";
import { shrineLobbyFreshAfter } from "@/server/utils/shrine";
import { getCurrentSlotBoundary, getSlotIndex, isNewSlotDue } from "@/utils/time";
import type { BoostTemplateEntry } from "@/validators/shrine";

/**
 * Returns the set of boost types to activate from the template for a village.
 * Skips boosts already active, skips if no Level 3 shrine in the village sector,
 * activates alphabetically until tokens run out.
 */
export function computeTemplateActivations(params: {
  now: Date;
  prevTime: Date;
  villageTokens: number;
  shrineSettings: Partial<Village["shrineSettings"]>;
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

  const template = shrineSettings.boostTemplate ?? [];
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

  const activeBoosts = shrineSettings.activeBoosts ?? {};
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
 * Deletes shrine battle lobbies that never progressed into a real battle and
 * resets users who are still marked as queued for those stale lobbies.
 */
export async function runStaleShrineLobbyCleanup(now: Date) {
  const cutoff = shrineLobbyFreshAfter(now);

  const staleLobbies = await selectMpvpBattleQueueForRunStaleShrineLobbyCleanup(
    drizzleDB,
    cutoff,
  );

  if (staleLobbies.length === 0) {
    return { lobbiesCleared: 0, usersReset: 0 };
  }

  const deletedQueueIds = staleLobbies.map((row) => row.id);

  // Re-check isNull(battleId) at execution time via a subquery so any lobby
  // claimed between the SELECT above and these statements is excluded from both
  // child cleanup and parent delete (claimed rows have battleId set).
  const unclaimedSubquery = selectMpvpBattleQueueForRunStaleShrineLobbyCleanup2(
    drizzleDB,
    deletedQueueIds,
    cutoff,
  );

  const unclaimedUsersSubquery = selectMpvpBattleUserForRunStaleShrineLobbyCleanup(
    drizzleDB,
    unclaimedSubquery,
  );

  // Step 1a: reset user statuses while mpvpBattleUser rows still exist —
  // the subquery reads from mpvpBattleUser, so the UPDATE must precede the DELETE.
  const resetResult = await updateUserDataForRunStaleShrineLobbyCleanup(
    drizzleDB,
    unclaimedUsersSubquery,
  );

  // Step 1b: now safe to drop the child rows
  await deleteMpvpBattleUserForRunStaleShrineLobbyCleanup(drizzleDB, unclaimedSubquery);

  // Step 2: parent delete with the same guard
  const deleteResult = await deleteMpvpBattleQueueForRunStaleShrineLobbyCleanup(
    drizzleDB,
    deletedQueueIds,
    cutoff,
  );

  return {
    lobbiesCleared: deleteResult.rowsAffected ?? 0,
    usersReset: resetResult.rowsAffected ?? 0,
  };
}
