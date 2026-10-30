import { DUNGEON_FLOORS_PER_TIER, DUNGEON_INACTIVE_ROUNDS } from "@/drizzle/constants";
import { stillInBattle } from "@/libs/combat/actions";
import type { CombatResult, CompleteBattle } from "@/libs/combat/types";
import { attemptCapReached } from "@/libs/quest";
import { periodStart } from "@/utils/time";
import type { DungeonContent, DungeonRunState } from "@/validators/dungeon";
import { dungeonRequirementsSchema } from "@/validators/dungeon";

/** Run snapshot and preloaded waves carried by combat; actions never fetch dungeon content. */
export type DungeonBattleState = {
  runId: string;
  runVersion: number;
  runState: DungeonRunState;
  totalFloors: number;
  roomKind: "floor" | "mini-boss" | "boss";
  expiresAt: number;
  /** Last explicit player action; timed-out turns and summoned allies do not count. */
  lastActionRound: Record<string, number>;
  failedReason?: string;
};

/** Resolve a zero-based run floor into its authored tier, or undefined after the final floor. */
export const dungeonFloorAt = (content: DungeonContent, floor: number) =>
  content.tiers[Math.floor(floor / DUNGEON_FLOORS_PER_TIER)]?.[
    floor % DUNGEON_FLOORS_PER_TIER
  ];

/** Resolve a party outcome in memory, recording deadline or inactivity failures on battle state. */
export const dungeonBattleOutcome = (battle: CompleteBattle, now = Date.now()) => {
  const state = battle.extraState.dungeon;
  if (!state) return null;
  if (now >= state.expiresAt)
    state.failedReason = "The one-hour dungeon deadline expired.";
  const humans = battle.usersState.filter((u) => !u.isAi && !u.isSummon);
  const alive = humans.filter((u) => stillInBattle(u, battle.usersEffects));
  // The current round is still playable; only completed rounds can count as missed.
  const inactive = alive.find(
    (u) =>
      battle.round - (state.lastActionRound[u.userId] ?? 0) > DUNGEON_INACTIVE_ROUNDS,
  );
  if (inactive)
    state.failedReason = `${inactive.username} took no actions for ${DUNGEON_INACTIVE_ROUNDS} rounds. The dungeon ended.`;
  if (state.failedReason) return "ended";
  if (alive.length === 0) return "wipe";
  if (
    !battle.extraState.encounter?.pendingWaves.length &&
    !battle.usersState.some(
      (u) => u.direction === "right" && stillInBattle(u, battle.usersEffects),
    )
  )
    return "won";
  return null;
};

/** Advance a win or choose the tier/mini-boss retry floor without mutating the prior run snapshot. */
export const dungeonNextState = (
  state: DungeonRunState,
  outcome: "won" | "wipe" | "ended",
  roomKind: DungeonBattleState["roomKind"],
) => ({
  ...state,
  readyIds: [],
  floor:
    outcome === "won"
      ? state.floor + 1
      : outcome === "wipe" && roomKind !== "mini-boss"
        ? Math.floor(state.floor / DUNGEON_FLOORS_PER_TIER) * DUNGEON_FLOORS_PER_TIER
        : state.floor,
  clearedFloors:
    outcome === "won"
      ? [...new Set([...state.clearedFloors, state.floor])]
      : state.clearedFloors,
  message:
    outcome === "won"
      ? "Floor cleared. Everyone has been fully restored."
      : outcome === "wipe"
        ? "The party was defeated. Everyone has been revived; ready up to retry."
        : state.message,
});

/** Dungeon floors settle together and never award ordinary combat rewards. */
export const dungeonCombatResult = (
  battle: CompleteBattle,
  userId: string,
): CombatResult | null => {
  const outcome = dungeonBattleOutcome(battle);
  const user = battle.usersState.find(
    (u) => u.userId === userId && !u.isAi && !u.isSummon,
  );
  if (!outcome || !user) return null;
  return {
    outcome: outcome === "won" ? "Won" : "Lost",
    didWin: outcome === "won" ? 1 : 0,
    eloDiff: 0,
    lpDiff: 0,
    experience: 0,
    earnedExperience: 0,
    pvpStreak: user.pvpStreak,
    curHealth: user.maxHealth,
    curChakra: user.maxChakra,
    curStamina: user.maxStamina,
    strength: 0,
    intelligence: 0,
    willpower: 0,
    speed: 0,
    money: 0,
    seichiSilver: 0,
    offence: 0,
    defence: 0,
    villagePrestige: 0,
    villageTokens: 0,
    anbuPoints: 0,
    warHealthChange: 0,
    shrineChangeHp: 0,
    clanPoints: 0,
    friendsLeft: 0,
    targetsLeft: 0,
    warHealthInfo: {},
    shrineInfo: {},
    villageWarShrineInfo: {},
    villageWarShrineDisplay: {},
    notifications: [
      battle.extraState.dungeon?.failedReason ??
        (outcome === "won"
          ? "Dungeon floor cleared. Return to your party."
          : "Party wiped. Return to your party to retry."),
    ],
    bountiesClaimed: [],
    droppedItems: [],
  };
};

/** Persisted definitions without entry gates retain unlimited access. */
export const dungeonRequirements = (content: Pick<DungeonContent, "requirements">) =>
  dungeonRequirementsSchema.parse(content.requirements ?? {});

/** Pure admission checks shared by discovery, readiness and battle initiation. */
export const dungeonEntryError = (
  info: {
    requirements: ReturnType<typeof dungeonRequirements>;
    level: number;
    questCompleted: boolean;
    itemQuantity: number;
    attempts: number[];
    completions: number[];
  },
  now = new Date(),
) => {
  const { requirements: r } = info;
  if (info.level < r.requiredLevel) return `Requires level ${r.requiredLevel}.`;
  if (r.prerequisiteQuestId && !info.questCompleted)
    return "Complete the prerequisite quest first.";
  if (r.maxAttempts !== null && info.attempts.length >= r.maxAttempts)
    return "The maximum dungeon attempts have been used.";
  const lastAttempt = info.attempts.length ? Math.max(...info.attempts) : null;
  if (
    attemptCapReached(
      {
        attemptDelay: r.attemptDelay,
        lastAttemptAt: lastAttempt === null ? null : new Date(lastAttempt),
      },
      now,
    )
  )
    return `This dungeon has already been attempted this ${r.attemptDelay} period.`;
  const completes =
    r.retryDelay === "none"
      ? info.completions
      : info.completions.filter(
          (at) =>
            at >=
            periodStart(
              r.retryDelay as Exclude<typeof r.retryDelay, "none">,
              now,
            ).getTime(),
        );
  if (r.maxCompletes !== null && completes.length >= r.maxCompletes)
    return "The maximum dungeon completions have been collected for this period.";
  if (r.requiredItemId && info.itemQuantity < r.requiredItemQuantity)
    return `Requires ${r.requiredItemQuantity} entry item(s) in your carried inventory.`;
  return null;
};
