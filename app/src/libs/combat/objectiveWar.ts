import { nanoid } from "nanoid";
import { WAR_PVP_ESPIONAGE_POINTS } from "@/drizzle/constants";
import { areBattleAllies } from "@/libs/combat/participants";
import { getBattleTeamWars, getOpposingBattleWars } from "@/libs/combat/settlement";
import type {
  BattleUserState,
  CombatResult,
  CompleteBattle,
} from "@/libs/combat/types";
import {
  getWarSide,
  isObjectiveWarActive,
  isObjectiveWarOpen,
} from "@/libs/objectiveWar";
import type { DrizzleClient } from "@/server/db";
import { applyObjectiveWarAction } from "@/server/utils/objectiveWar";
import { checkAssassin, checkCoLeader } from "@/validators/clan";
import type { WarRules } from "@/validators/war";

/**
 * Use battle-initiation snapshots; an open mercenary appointment grants ANBU role
 * precedence over the player's village and clan roles.
 */
export const getObjectiveWarRole = (
  battle: CompleteBattle,
  user: BattleUserState,
): "leader" | "elder" | "coleader" | "anbu" | "assassin" | "regular" => {
  if (
    Object.values(battle.extraState.wars).some(
      (w) =>
        isObjectiveWarOpen(w) &&
        w.warMercenaries?.some((m) => m.userId === user.userId),
    )
  )
    return "anbu";
  const village = user.villageId
    ? battle.extraState.villages[user.villageId]
    : undefined;
  const clan = user.clanId ? battle.extraState.clans[user.clanId] : undefined;
  if (village?.kageId === user.userId) return "leader";
  if (user.rank === "ELDER") return "elder";
  if (user.isOutlaw && checkCoLeader(user.userId, clan)) return "coleader";
  if (user.anbuId) return "anbu";
  if (user.isOutlaw && checkAssassin(user.userId, clan)) return "assassin";
  return "regular";
};

/**
 * Queue strategic writes in combat's final mutation phase, using preloaded state only.
 * A receipt per battle, winner and war prevents duplicate settlement credit.
 */
export const settleObjectiveWarCombat = async (
  client: DrizzleClient,
  battle: CompleteBattle,
  result: CombatResult,
  user: BattleUserState,
) => {
  if (!result.didWin || user.isAi || user.isSummon || user.fledBattle) return;
  const opponents = battle.usersState.filter(
    (target) =>
      !target.isSummon &&
      !target.fledBattle &&
      target.curHealth <= 0 &&
      !areBattleAllies(user, target),
  );
  const participatingWars = getBattleTeamWars(battle, user)
    .map(({ war }) => war)
    .filter((w) => w.rules && isObjectiveWarActive(w));
  if (!participatingWars.length) return;
  const role = getObjectiveWarRole(battle, user);
  await Promise.all(
    participatingWars
      .filter((w) => w.rules && isObjectiveWarActive(w))
      .map(async (w) => {
        const sideVillageId = getWarSide(w, user.villageId, user.userId);
        // Shared combat teams cannot grant a non-participant village strategic credit.
        if (!sideVillageId) return;
        const rules = w.rules as WarRules;
        const hasMercenarySnapshot = !!w.warMercenaries?.some(
          (m) => m.userId === user.userId && m.sideVillageId === sideVillageId,
        );
        const camp = battle.extraState.warCamp;
        if (
          camp &&
          camp.warId === w.id &&
          opponents.some(
            (target) =>
              target.controllerId === camp.guardianId ||
              target.userId === camp.guardianId,
          )
        ) {
          await applyObjectiveWarAction(client, w, {
            id: `${battle.id}:${user.userId}:${w.id}`,
            userId: user.userId,
            sideVillageId,
            hasMercenarySnapshot,
            camp,
          });
          return;
        }
        const objectiveIndex =
          w.objectiveState?.objectives.findIndex(
            (o) =>
              o.sector === user.sector && o.villageId !== sideVillageId && !o.destroyed,
          ) ?? -1;
        if (battle.battleType === "SHRINE_WAR" && objectiveIndex >= 0) {
          await applyObjectiveWarAction(client, w, {
            id: `${battle.id}:${user.userId}:${w.id}`,
            userId: user.userId,
            sideVillageId,
            hasMercenarySnapshot,
            objectiveIndex,
            shrineDamage: rules.guardianDamage,
          });
          return;
        }
        if (battle.battleType !== "COMBAT") return;
        const defeated = opponents.filter(
          (target) =>
            !target.isAi &&
            getOpposingBattleWars(battle, user, target).some(
              (entry) => entry.war.id === w.id,
            ),
        );
        if (!defeated.length) return;
        // Defeating defenders at a revealed objective damages its shrine, per eligible winner.
        await applyObjectiveWarAction(client, w, {
          id: `${battle.id}:${user.userId}:${w.id}`,
          userId: user.userId,
          sideVillageId,
          hasMercenarySnapshot,
          damage: rules[`${role}Damage`] * defeated.length,
          recovery: rules[`${role}Recovery`] * defeated.length,
          espionage: WAR_PVP_ESPIONAGE_POINTS * defeated.length,
          kills: defeated.map((target) => ({
            id: nanoid(),
            warId: w.id,
            killerId: user.userId,
            victimId: target.userId,
            killerVillageId: sideVillageId,
            victimVillageId:
              getWarSide(w, target.villageId, target.userId) ??
              target.villageId ??
              "unknown",
            sector: user.sector,
            shrineHpChange: 0,
            townhallHpChange: 0,
          })),
          ...(objectiveIndex >= 0
            ? { objectiveIndex, shrineDamage: rules.guardianDamage }
            : {}),
        });
      }),
  );
};
