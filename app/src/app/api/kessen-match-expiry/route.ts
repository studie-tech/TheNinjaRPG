import { NextResponse } from "next/server";
import {
  KESSEN_CHALLENGE_EXPIRY_SECONDS,
  KESSEN_MATCH_IDLE_EXPIRY_HOURS,
  KESSEN_PVP_SETTLEMENT_SWEEP_HOURS,
  KESSEN_PVP_SWEEP_BATCH,
  KESSEN_PVP_SWEEP_GRACE_SECONDS,
  KESSEN_RANKED_QUEUE_HEARTBEAT_SECONDS,
} from "@/drizzle/constants";
import { handleEndpointError, lockWithGameTimer } from "@/libs/gamesettings";
import { updateIdleKessenMatchesForExpiry } from "@/queries/kessen";
import {
  deleteStaleKessenRankedQueue,
  listOverdueKessenPvpMatches,
  listUnsettledKessenPvpMatches,
  updateUserRequestForExpireKessenChallenges,
} from "@/queries/kessenPvp";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import {
  advanceKessenDuel,
  resumeKessenDuelSettlement,
  storedDuelOf,
} from "@/server/utils/kessenPvp";
import { HOUR_S } from "@/utils/time";

const ENDPOINT_NAME = "kessen-match-expiry";
// Keep the persisted timer key stable across interval changes.
const TIMER_NAME = `${ENDPOINT_NAME}-1h`;

/**
 * Ends NPC matches idle for a day as EXPIRED, without a reward; resolves the clocks of
 * duels both players abandoned (a forfeit settles like any other ending); resumes the
 * settlement of ranked duels whose ending request stopped before settling them; expires
 * unanswered challenges and drops queue rows whose player stopped polling.
 */
export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  const response = await lockWithGameTimer(drizzleDB, TIMER_NAME, 60 * 60_000);
  if (response) return response;

  try {
    const now = new Date();
    const before = new Date(
      now.getTime() - KESSEN_MATCH_IDLE_EXPIRY_HOURS * HOUR_S * 1000,
    );
    const graceEnd = new Date(now.getTime() - KESSEN_PVP_SWEEP_GRACE_SECONDS * 1000);
    const [result, overdue, unsettled, challenges] = await Promise.all([
      updateIdleKessenMatchesForExpiry(drizzleDB, before, now),
      listOverdueKessenPvpMatches(drizzleDB, graceEnd, KESSEN_PVP_SWEEP_BATCH),
      listUnsettledKessenPvpMatches(drizzleDB, {
        since: new Date(
          now.getTime() - KESSEN_PVP_SETTLEMENT_SWEEP_HOURS * HOUR_S * 1000,
        ),
        before: graceEnd,
        limit: KESSEN_PVP_SWEEP_BATCH,
      }),
      updateUserRequestForExpireKessenChallenges(
        drizzleDB,
        new Date(now.getTime() - KESSEN_CHALLENGE_EXPIRY_SECONDS * 1000),
      ),
      deleteStaleKessenRankedQueue(
        drizzleDB,
        new Date(now.getTime() - 10 * KESSEN_RANKED_QUEUE_HEARTBEAT_SECONDS * 1000),
      ),
    ]);
    // Each duel is its own version CAS (a player acting meanwhile simply wins it), and
    // one failing duel leaves the others to finish; a failed settlement stays pending
    // for the next sweep.
    const [advanced, settled] = await Promise.all([
      Promise.allSettled(
        overdue.map((row) => advanceKessenDuel(drizzleDB, row, { now })),
      ),
      Promise.allSettled(
        unsettled.map((row) => resumeKessenDuelSettlement(drizzleDB, row)),
      ),
    ]);
    const failures = await Promise.all(
      [...advanced, ...settled]
        .filter((outcome) => outcome.status === "rejected")
        .map(({ reason }) => handleEndpointError(reason, { endpoint: ENDPOINT_NAME })),
    );
    if (failures[0]) return failures[0];
    const expired = Number(result.rowsAffected ?? 0);
    const resolved = advanced.filter(
      (outcome) => outcome.status === "fulfilled" && !outcome.value.lost,
    ).length;
    const settlements = settled.filter(
      (outcome) =>
        outcome.status === "fulfilled" && !storedDuelOf(outcome.value.row).settlement,
    ).length;
    return NextResponse.json({
      success: true,
      message: `Expired ${expired} idle Kessen matches, resolved ${resolved} duel clocks, settled ${settlements} duels`,
      expired,
      resolved,
      settled: settlements,
      challengesExpired: Number(challenges.rowsAffected ?? 0),
    });
  } catch (error) {
    return await handleEndpointError(error, { endpoint: ENDPOINT_NAME });
  }
}
