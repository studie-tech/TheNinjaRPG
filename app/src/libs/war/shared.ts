import { getUnique } from "@/utils/grouping";
import type { BattleWar } from "@/libs/combat/types";

export const findWarsWithUser = (
  targetWars: BattleWar[],
  userWars: BattleWar[],
  targetVillageId: string | null | undefined,
  userVillageId: string | null | undefined,
) => {
  return getUnique([...targetWars, ...userWars], "id").filter((w) => {
    const attackerVillageIds = [
      w.attackerVillageId,
      ...w.warAllies
        .filter((wa) => wa.supportVillageId === w.attackerVillageId)
        .map((wa) => wa.villageId),
    ];
    const defenderVillageIds = [
      w.defenderVillageId,
      ...w.warAllies
        .filter((wa) => wa.supportVillageId === w.defenderVillageId)
        .map((wa) => wa.villageId),
    ];
    const check1 =
      attackerVillageIds.includes(targetVillageId ?? "") &&
      defenderVillageIds.includes(userVillageId ?? "");
    const check2 =
      defenderVillageIds.includes(targetVillageId ?? "") &&
      attackerVillageIds.includes(userVillageId ?? "");
    return check1 || check2;
  });
};

export const findWarAllies = (
  targetWars: BattleWar[],
  userWars: BattleWar[],
  targetVillageId: string | null | undefined,
  userVillageId: string | null | undefined,
) => {
  return getUnique([...targetWars, ...userWars], "id").filter((w) => {
    const attackerVillageIds = [
      w.attackerVillageId,
      ...w.warAllies
        .filter((wa) => wa.supportVillageId === w.attackerVillageId)
        .map((wa) => wa.villageId),
    ];
    const defenderVillageIds = [
      w.defenderVillageId,
      ...w.warAllies
        .filter((wa) => wa.supportVillageId === w.defenderVillageId)
        .map((wa) => wa.villageId),
    ];
    const check1 =
      attackerVillageIds.includes(targetVillageId ?? "") &&
      attackerVillageIds.includes(userVillageId ?? "");
    const check2 =
      defenderVillageIds.includes(targetVillageId ?? "") &&
      defenderVillageIds.includes(userVillageId ?? "");
    return check1 || check2;
  });
};

export const isWarAllies = (
  wars: BattleWar[] | null | undefined,
  targetVillageId: string | null | undefined,
  userVillageId: string | null | undefined,
) => {
  if (!wars) return false;
  return findWarAllies(wars, wars, targetVillageId, userVillageId).length > 0;
};
