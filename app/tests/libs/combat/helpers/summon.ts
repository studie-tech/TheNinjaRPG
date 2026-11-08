import type { BattleUserState } from "@/libs/combat/types";
import { makeBattleUser } from "../../../setup/combat";

export const DEMON = "ai-demon";
export const TIGER = "ai-tiger";
export const SUMMON_OWNER = "p1";

/** Summon template: carries its DB id in controllerId and is parked at curHealth 0. */
export const makeSummonTemplate = (aiId: string, username: string) =>
  makeBattleUser(`tmpl-${aiId}`, {
    controllerId: aiId,
    username,
    isAi: true,
    isSummon: true,
    isSummonTemplate: true,
    curHealth: 0,
  });

/** Live summon of `aiId` owned by `SUMMON_OWNER`. */
export const makeSpawnedSummon = (
  id: string,
  aiId: string,
  over: Partial<BattleUserState> = {},
) =>
  makeBattleUser(id, {
    controllerId: SUMMON_OWNER,
    username: "Demon",
    isAi: true,
    isSummon: true,
    isOriginal: true,
    summonSourceId: aiId,
    curHealth: 500,
    ...over,
  });
