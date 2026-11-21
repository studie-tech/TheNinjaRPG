import {
  BANDIT_OPERATION_EXP,
  CARAVAN_AMBUSH_LOSS_BP,
  CARAVAN_ENEMY_ATTACK_LOSS_BP,
  CARAVAN_ENEMY_VICTORY_RYO,
  TRADE_ROUTE_MARKER_ASSAULT_DAMAGE,
} from "@/drizzle/constants";
import { getAllowedLoss, splitLoot } from "@/libs/caravan";
import { stillInBattle } from "@/libs/combat/inBattle";
import type { CompleteBattle } from "@/libs/combat/types";
import {
  applyCaravanLoss,
  awardLoot,
  creditGuardObjectives,
  grantCaravanRewards,
  releaseParticipants,
  resolveFoughtEncounter,
} from "@/queries/caravan";
import { damageMarker } from "@/queries/tradeRoute";
import type { DrizzleClient } from "@/server/db";

/**
 * Apply a caravan or marker fight's outcome inside the battle's terminal version claim.
 * The encounter's FIGHTING-to-RESOLVED transition admits one settlement per battle; every
 * effect reads only the snapshot frozen into battle state at initiation.
 */
export const settleCaravanCombat = async (
  database: DrizzleClient,
  battle: CompleteBattle,
) => {
  const state = battle.extraState.caravan;
  if (!state) return;
  const now = new Date();
  const defenderDirection = state.attackerDirection === "left" ? "right" : "left";
  const attackersWon =
    isSideStanding(battle, state.attackerDirection) &&
    !isSideStanding(battle, defenderDirection);
  const claimed = await resolveFoughtEncounter(
    database,
    state.encounterId,
    state.battleId,
    attackersWon,
    now,
  );
  if (claimed.rowsAffected !== 1) return;
  const caravanId = state.caravanId;
  if (state.type === "MARKER_ASSAULT") {
    if (attackersWon && state.markerId)
      await damageMarker(
        database,
        state.markerId,
        TRADE_ROUTE_MARKER_ASSAULT_DAMAGE,
        state.captureVillageId,
        now,
      );
    return;
  }
  if (!caravanId) return;
  if (!attackersWon) {
    await creditGuardObjectives(database, caravanId, state.guardIds);
  } else if (state.type === "AMBUSH") {
    await applyCaravanLoss(database, caravanId, CARAVAN_AMBUSH_LOSS_BP);
  } else if (state.type === "INTERCEPTION") {
    // Raiders are paid only for cargo they actually took; a plundered caravan pays nothing.
    const isBandit = state.attackerRole === "BANDIT";
    const takenBp = getAllowedLoss(
      state.lossBp,
      isBandit ? state.stealBp : CARAVAN_ENEMY_ATTACK_LOSS_BP,
    );
    if (takenBp > 0) {
      await applyCaravanLoss(database, caravanId, takenBp);
      if (isBandit)
        await awardLoot(
          database,
          caravanId,
          splitLoot(state.cargo, takenBp, state.attackerIds),
        );
      await grantCaravanRewards(
        database,
        state.attackerIds.map((userId) =>
          isBandit
            ? { userId, banditExperience: BANDIT_OPERATION_EXP }
            : { userId, money: CARAVAN_ENEMY_VICTORY_RYO },
        ),
      );
    }
  }
  // An interception group disbands after its attack, whatever the result.
  if (state.type === "INTERCEPTION" && state.attackerRole)
    await releaseParticipants(database, caravanId, {
      userIds: state.attackerIds,
      roles: [state.attackerRole],
    });
};

/** Whether anyone on a battle side is still fighting. */
const isSideStanding = (battle: CompleteBattle, direction: "left" | "right") =>
  battle.usersState.some(
    (user) => !user.isSummon && user.direction === direction && stillInBattle(user),
  );
