import { nanoid } from "nanoid";
import { CARAVAN_MAX_LOSS_BP } from "@/drizzle/constants";
import type { CaravanBattleState } from "@/libs/caravan";
import {
  claimPendingEncounter,
  deleteStartingEncounter,
  insertEncounter,
  listCaravansByIds,
  markEncounterFighting,
  reopenEncounter,
} from "@/queries/caravan";
import { initiateBattle } from "@/routers/combat";
import { errorResponse } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { isMysqlDuplicateKeyError } from "@/server/utils/mysqlErrors";
import { secureRandomInt } from "@/utils/math";

/**
 * Start a caravan or marker fight. The encounter is reserved for the new battle first, so
 * only one fight per caravan and marker can begin; a battle that fails to start releases it.
 * Escorts and attackers start with auto combat when they keep it on by default, since
 * escorts may be away when their caravan is attacked.
 */
export const launchCaravanBattle = async (
  client: DrizzleClient,
  input: {
    /** An open ambush is answered; any other fight opens a new encounter. */
    pendingEncounterId?: string;
    encounter: Omit<
      Parameters<typeof insertEncounter>[1],
      "id" | "status" | "battleId" | "now"
    >;
    state: Omit<CaravanBattleState, "encounterId" | "battleId">;
    userIds: string[];
    targetIds: string[];
    scaleTarget?: boolean;
    cacheUserId: string;
  },
) => {
  const now = new Date();
  const battleId = nanoid();
  const encounterId = input.pendingEncounterId ?? nanoid();
  if (input.pendingEncounterId) {
    const claimed = await claimPendingEncounter(client, encounterId, battleId, now);
    if (claimed.rowsAffected !== 1)
      return errorResponse("The ambush is over or already being fought");
  } else {
    try {
      await insertEncounter(client, {
        ...input.encounter,
        id: encounterId,
        status: "STARTING",
        battleId,
        now,
      });
    } catch (error) {
      if (isMysqlDuplicateKeyError(error))
        return errorResponse("Another fight over it is already underway");
      throw error;
    }
  }
  let started = false;
  try {
    // The reserved encounter holds off every other fight over the caravan, so the loss read
    // now stays current until this battle settles and caps what its raiders can take.
    const [current] = input.state.caravanId
      ? await listCaravansByIds(client, [input.state.caravanId])
      : [];
    if (input.state.caravanId && current?.status !== "TRAVELLING")
      return errorResponse("The caravan is not on the road");
    // An arrived caravan stays on the road only until maintenance delivers it.
    if (
      input.state.type === "INTERCEPTION" &&
      current?.arrivesAt &&
      current.arrivesAt <= now
    )
      return errorResponse("The caravan has already arrived");
    if (
      input.state.type === "INTERCEPTION" &&
      current &&
      current.lossBp >= CARAVAN_MAX_LOSS_BP
    )
      return errorResponse("This caravan has nothing left worth taking");
    const result = await initiateBattle(
      {
        client,
        userIds: input.userIds,
        targetIds: input.targetIds,
        scaleTarget: input.scaleTarget,
        cacheUserId: input.cacheUserId,
        autoCombatFromDefaults: true,
        caravan: {
          ...input.state,
          lossBp: current?.lossBp ?? input.state.lossBp,
          encounterId,
          battleId,
        },
      },
      "CARAVAN",
    );
    started = result.success;
    // The battle is live either way: settlement also claims a STARTING encounter, and
    // maintenance keeps it while the battle runs, so a failed promotion still enters combat.
    if (started)
      await markEncounterFighting(client, encounterId, battleId).catch(() => undefined);
    return result;
  } finally {
    if (!started) {
      if (input.pendingEncounterId)
        await reopenEncounter(client, encounterId, battleId);
      else await deleteStartingEncounter(client, encounterId, battleId);
    }
  }
};

/**
 * Draw Caravan AI opponents near a level from the configured templates: a random pick among
 * the closest, each drawn independently so repeated templates become separate combatants.
 */
export const pickCaravanAi = (
  pool: { userId: string; level: number }[],
  count: number,
  level: number,
) => {
  if (count <= 0) return [];
  const nearest = [...pool]
    .sort((a, b) => Math.abs(a.level - level) - Math.abs(b.level - level))
    .slice(0, Math.max(3, count));
  return Array.from(
    { length: count },
    () => nearest[secureRandomInt(Math.max(1, nearest.length))]?.userId,
  ).filter((id): id is string => !!id);
};

/**
 * Escorts waiting in their caravan's queue, the ones a fight over it can draw in. Escorts
 * who left to heal or fight elsewhere are backfilled by NPC guards.
 */
export const selectQueuedGuards = <
  T extends {
    role: string;
    activeUserId: string | null;
    status: string;
    isBanned: boolean;
  },
>(
  participants: T[],
) =>
  participants.filter(
    (p) =>
      p.role === "GUARD" && !!p.activeUserId && p.status === "QUEUED" && !p.isBanned,
  );
