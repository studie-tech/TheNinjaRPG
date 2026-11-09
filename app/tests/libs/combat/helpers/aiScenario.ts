import type { BattleUserState, CompleteBattle } from "@/libs/combat/types";
import {
  flatCombatStats,
  makeBattleUser,
  makeCompleteBattle,
} from "../../../setup/combat";

/** Shared AI actor defaults; each suite supplies its own opponents, rules and catalog. */
export const makeAiUser = (over: Partial<BattleUserState>): BattleUserState =>
  makeBattleUser(over.userId ?? "x", {
    username: "x",
    controllerId: "x",
    isAi: true,
    isSummon: false,
    isPiloted: false,
    longitude: 1,
    latitude: 1,
    effects: [],
    round: 0,
    direction: "right",
    isAggressor: false,
    highestGenerals: [],
    level: 10,
    originalLevel: 10,
    originalLongitude: 1,
    originalLatitude: 1,
    ...flatCombatStats(100),
    ...over,
  });

/** Shared AI-turn battle metadata; each suite supplies its battle type, board, roster and catalogs. */
export const makeAiBattle = (
  overrides: Parameters<typeof makeCompleteBattle>[0],
): CompleteBattle =>
  makeCompleteBattle({
    version: 1,
    rewardScaling: 1,
    forceKeepPools: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    roundStartAt: new Date(0),
    ...overrides,
  });
