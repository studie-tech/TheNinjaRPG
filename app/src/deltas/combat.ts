import superjson from "superjson";
import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import type { BattleType } from "@/drizzle/constants";
import {
  CombatStatNames,
  ManualStartBattleTypes,
  MasteryNames,
  REGEN_SECONDS,
} from "@/drizzle/constants";
import type { BattleAction, UserData, UserTitle } from "@/drizzle/schema";
import type {
  BattleState,
  BattleUserItem,
  CombatResult,
  CompleteBattle,
  ReturnedBattle,
} from "@/libs/combat/types";
import { maskBattle } from "@/libs/combat/util";
import {
  effectiveMasteries,
  MASTERY_REQUIREMENT_FIELDS,
  type MasteryBuffUser,
  type MasteryGear,
  type MasterySources,
} from "@/libs/mastery";
import { calcMaxEnergy } from "@/libs/profile";
import { hasTrainingInProgress } from "@/libs/queue";
import { getRegenerationPeriodGain, type RegenerationPeriod } from "@/libs/timedBuffs";
import type { UserWithRelations } from "@/server/api/routers/profile";
import type { UserCachePatch, UserDelta } from "@/validators/userCache";

const baselineFields = [
  ...CombatStatNames,
  ...MasteryNames,
  "level",
  "rank",
  "curEnergy",
  "earnedExperience",
  "experience",
  "money",
  "seichiSilver",
  "pveFights",
  "activePetId",
  "petExperience",
] as const;
type BaselineField = (typeof baselineFields)[number];

/**
 * Persisted profile values captured at battle admission and checked before applying a
 * settlement.
 */
export type CombatCacheBaseline = Pick<UserData, BaselineField> & {
  regenAt: string;
  hadTrainingQueue: boolean;
  /** Ownership at initiation; changes require an authoritative profile refresh at completion. */
  titleIds: string[];
  items: Pick<
    BattleUserItem,
    "id" | "quantity" | "durability" | "level" | "experience" | "equipped"
  >[];
};

/**
 * Battle admission baseline with unscaled mastery sources for reconstructing derived profile
 * values.
 */
export type CombatCacheSnapshot = CombatCacheBaseline & {
  masterySources: MasterySources &
    Pick<MasteryBuffUser, "bloodlineId"> & {
      /** Preserve acquisition snapshots for lobby reconstruction without another database read. */
      titles?: UserTitle[];
    };
};

/**
 * Confirmed combat settlement tied to one user, battle and admission baseline, including
 * sparse tracker and gear changes.
 */
export type CombatProfileUpdate = {
  userId: string;
  battleId: string;
  baseline: CombatCacheBaseline;
  userDelta: UserDelta;
  /** Removed loaded trackers; presence marks a sparse patch, older responses are complete. */
  removedQuestIds?: string[];
  userPatch: {
    status: "AWAKE" | "BATTLE";
    curHealth: number;
    curStamina: number;
    curChakra: number;
    curEnergy: number;
    regenAt: Date;
    stealthCooldownAt: Date;
    pvpStreak: number;
    pveFights: number;
    maxEnergy: number;
    effectiveMasteries: ReturnType<typeof effectiveMasteries>;
    questData: NonNullable<UserWithRelations>["questData"];
  };
  items: CombatCacheSnapshot["items"];
};

/** Capture unscaled progression and passive sources for lobby reconstruction and settlement. */
export const captureCombatCacheSnapshot = (
  user: UserData &
    Omit<MasteryBuffUser, "items" | "titles"> & {
      items: (CombatCacheBaseline["items"][number] & MasteryGear)[];
      titles?: UserTitle[];
    },
): CombatCacheSnapshot => ({
  ...(Object.fromEntries(baselineFields.map((field) => [field, user[field]])) as Pick<
    UserData,
    BaselineField
  >),
  masterySources: structuredClone({
    titles: user.titles,
    bloodlineId: user.bloodlineId,
    bloodline: user.bloodline ? { effects: user.bloodline.effects } : null,
    userSkills: user.userSkills?.map(({ skillId, activated, skill }) => ({
      skillId,
      activated,
      skill: { target: skill.target, effects: skill.effects },
    })),
    items: user.items.map((row) => ({
      id: row.id,
      equipped: row.equipped,
      durability: row.durability,
      level: row.level,
      item: {
        itemType: row.item.itemType,
        maxDurability: row.item.maxDurability,
        bloodlineId: row.item.bloodlineId,
        requiredSkillId: row.item.requiredSkillId,
        canBeImbued: row.item.canBeImbued,
        effects: row.item.effects,
        ...Object.fromEntries(
          MASTERY_REQUIREMENT_FIELDS.map(([field]) => [field, row.item[field]]),
        ),
      },
      imbuements: row.imbuements?.map((entry) => ({
        craftingFinishedAt: entry.craftingFinishedAt,
        item: { effects: entry.item.effects },
      })),
    })),
  }),
  regenAt: user.regenAt.toISOString(),
  titleIds: user.titles?.map(({ titleId }) => titleId) ?? [],
  // Training may settle while profile refreshes are paused during combat.
  hadTrainingQueue: hasTrainingInProgress(user),
  items: user.items.map(
    ({ id, quantity, durability, level, experience, equipped }) => ({
      id,
      quantity,
      durability,
      level,
      experience,
      equipped,
    }),
  ),
});

/**
 * Project the session player's confirmed settlement only while identity, battle, baseline
 * values, title ownership and equipment still match. Return undefined when queued training or
 * changed sources require a canonical profile read.
 */
export const combatProfilePatch = (
  current: NonNullable<UserWithRelations>,
  update: CombatProfileUpdate,
) => {
  if (
    current.userId !== update.userId ||
    current.battleId !== update.battleId ||
    current.status !== "BATTLE"
  )
    return;
  if (
    baselineFields.some((field) => current[field] !== update.baseline[field]) ||
    current.regenAt.getTime() !== new Date(update.baseline.regenAt).getTime()
  )
    return;
  // Collected effects are immutable; selecting a label does not change ownership.
  const titleIds = current.titles?.map(({ titleId }) => titleId) ?? [];
  if (
    titleIds.length !== update.baseline.titleIds?.length ||
    titleIds.some((id) => !update.baseline.titleIds.includes(id))
  )
    return;
  // Arena initiation may finish an elemental session before capturing its baseline.
  if (hasTrainingInProgress(current) || update.baseline.hadTrainingQueue) return;
  const items = getCombatInventoryUpdate(current.items, update);
  if (!items) return;
  return {
    ...update.userPatch,
    // Retain omitted public trackers, but respect removals from loaded quests.
    questData: update.removedQuestIds
      ? [
          ...new Map(
            [
              ...(current.questData ?? []).filter(
                (tracker) => !update.removedQuestIds?.includes(tracker.id),
              ),
              ...(update.userPatch.questData ?? []),
            ].map((tracker) => [tracker.id, tracker]),
          ).values(),
        ]
      : update.userPatch.questData,
    items,
    battleId: null,
    stealthActive: false,
    stealthActivatedAt: null,
  };
};

/** Apply confirmed combat item changes only to the admission baseline, preserving view extensions. */
export const getCombatInventoryUpdate = <
  T extends CombatCacheBaseline["items"][number],
>(
  current: T[],
  update: CombatProfileUpdate | undefined,
): T[] | undefined => {
  if (!update || current.length !== update.baseline.items.length) return;
  const itemFields = [
    "quantity",
    "durability",
    "level",
    "experience",
    "equipped",
  ] as const;
  for (const item of current) {
    const original = update.baseline.items.find((row) => row.id === item.id);
    if (!original || itemFields.some((field) => original[field] !== item[field]))
      return;
  }
  return current.flatMap((item) => {
    const changed = update.items.find((row) => row.id === item.id);
    return changed && changed.quantity > 0 ? [{ ...item, ...changed }] : [];
  });
};

/**
 * Calculate capped energy at the bound settlement timestamp, including rewards, passive
 * regeneration and timed periods, to match combatEnergyRecoverySql.
 */
export const combatCacheEnergy = (
  snapshot: Pick<CombatCacheBaseline, "curEnergy" | "regenAt">,
  capacity: number,
  regeneration: number,
  at: Date,
  reward: number,
  periods: readonly RegenerationPeriod[] = [],
) =>
  Math.min(
    capacity,
    snapshot.curEnergy +
      reward +
      getRegenerationPeriodGain(
        periods,
        new Date(snapshot.regenAt),
        at,
        REGEN_SECONDS,
      ) +
      (Math.max(0, regeneration) *
        Math.max(0, at.getTime() - new Date(snapshot.regenAt).getTime())) /
        (REGEN_SECONDS * 1000),
  );

/**
 * Allow local settlement only for a surviving solo PvE actor with a valid baseline, stable
 * active pet, no queued training and no shared reward effects.
 */
export const canCacheCombatCompletion = (
  battle: CompleteBattle,
  result: CombatResult,
  userId: string,
) => {
  const baseline = battle.extraState.profileCacheSnapshots?.[userId];
  return (
    !!baseline &&
    // A confirmed settlement can add to the original companion's cached bank.
    (!battle.extraState.petIdsByOwner?.[userId] ||
      (baseline.activePetId === battle.extraState.petIdsByOwner[userId] &&
        Number.isFinite(baseline.petExperience))) &&
    ["money", "seichiSilver", "experience", "earnedExperience", "pveFights"].every(
      (field) => Number.isFinite(baseline[field as "money"]),
    ) &&
    !baseline.hadTrainingQueue &&
    result.curHealth > 0 &&
    ["ARENA", "QUEST", "RANDOM_ENCOUNTER", "TRAINING", "OVERWORLD"].includes(
      battle.battleType,
    ) &&
    result.villagePrestige === 0 &&
    result.bountiesClaimed.length === 0 &&
    result.villageTokens === 0 &&
    result.anbuPoints === 0 &&
    result.clanPoints === 0 &&
    !battle.usersState.some(
      (user) => !user.isAi && !user.isSummon && user.userId !== userId,
    )
  );
};

/** Recompute derived gates from persisted values and the original, unscaled effect sources. */
export const combatCacheDerived = (
  snapshot: CombatCacheSnapshot,
  items: CombatCacheBaseline["items"],
  delta: UserDelta,
) => {
  const user = {
    ...snapshot,
    ...snapshot.masterySources,
    items: snapshot.masterySources.items?.flatMap((item) => {
      const changed = items.find((row) => row.id === item.id);
      return changed && changed.quantity > 0
        ? [
            {
              ...item,
              ...changed,
              // Battle JSON serializes the dates used by the shared gear-effect helpers.
              imbuements: item.imbuements?.map((imbuement) => ({
                ...imbuement,
                craftingFinishedAt:
                  imbuement.craftingFinishedAt === null
                    ? null
                    : new Date(imbuement.craftingFinishedAt),
              })),
            },
          ]
        : [];
    }),
  };
  for (const mastery of MasteryNames) user[mastery] += delta[mastery] ?? 0;
  return {
    maxEnergy: calcMaxEnergy(user),
    effectiveMasteries: effectiveMasteries(user),
  };
};

/**
 * Apply battle quantity and durability changes while retaining persisted equipment slots,
 * levels and experience.
 */
export const combatCacheItems = (
  baseline: CombatCacheBaseline,
  items: BattleUserItem[],
) =>
  baseline.items.map((original) => {
    const changed = items.find((item) => item.id === original.id);
    return changed
      ? { ...original, quantity: changed.quantity, durability: changed.durability }
      : original;
  });

/** Integer-column deltas use the rounded final balance, including fractional debits. */
export const combatCacheIntegerDelta = (
  snapshot: Pick<
    CombatCacheBaseline,
    "money" | "experience" | "earnedExperience" | "seichiSilver"
  >,
  result: Pick<
    CombatResult,
    "money" | "experience" | "earnedExperience" | "seichiSilver"
  >,
) =>
  Object.fromEntries(
    (["money", "experience", "earnedExperience", "seichiSilver"] as const).map(
      (field) => {
        const final = snapshot[field] + result[field];
        return [
          field,
          Math.sign(final) * Math.round(Math.abs(final)) - snapshot[field],
        ];
      },
    ),
  ) as Pick<UserDelta, "money" | "experience" | "earnedExperience" | "seichiSilver">;

/**
 * Project battle admission, stealth breaks and the non-tournament PvE counter for a settled
 * actor. Withhold both fields when queues, PvP or immunity changes require a profile refresh.
 */
export const getCombatAdmissionUserUpdate = ({
  cacheActor,
  requiresUserRefresh,
  allParticipantIds,
  queuedParticipants,
  battleType,
  warAggressorIds,
  bracketImmunityAggressorIds,
  now,
  battleId,
  stealthBreakUserIds,
  isTournament,
}: {
  cacheActor: Pick<UserData, "userId" | "bracketImmunityLiftedUntil"> | undefined;
  requiresUserRefresh: boolean;
  allParticipantIds: string[];
  queuedParticipants: { user: { userId: string } }[];
  battleType: BattleType;
  warAggressorIds: string[];
  bracketImmunityAggressorIds: string[];
  now: Date;
  battleId: string;
  stealthBreakUserIds: string[];
  isTournament: boolean;
}): { userPatch: UserCachePatch | undefined; userDelta: UserDelta | undefined } => {
  const canProject =
    !!cacheActor &&
    !requiresUserRefresh &&
    allParticipantIds.includes(cacheActor.userId) &&
    !queuedParticipants.some((entry) => entry.user.userId === cacheActor.userId) &&
    !["SPARRING", "COMBAT", "SHRINE_WAR"].includes(battleType) &&
    !warAggressorIds.includes(cacheActor.userId) &&
    !bracketImmunityAggressorIds.includes(cacheActor.userId) &&
    cacheActor.bracketImmunityLiftedUntil <= now;
  const userPatch: UserCachePatch | undefined = canProject
    ? {
        status: "BATTLE",
        battleId,
        bracketImmunityPausedAt: null,
        ...(stealthBreakUserIds.includes(cacheActor.userId)
          ? { stealthActive: false, stealthActivatedAt: null }
          : {}),
      }
    : undefined;
  return {
    userPatch,
    userDelta: userPatch ? (isTournament ? {} : { pveFights: 1 }) : undefined,
  };
};

/** Project the auto-combat preference only for battle types that support automatic starts. */
export const getAutoCombatPreferencePatch = (
  battleType: BattleType,
  enabled: boolean,
) =>
  ManualStartBattleTypes.includes(battleType) ? {} : { defaultAutoCombat: enabled };

/**
 * Merge committed rows into complete, unfiltered first pages without regressing newer logs.
 * Return undefined when completeness cannot be proved so callers refetch.
 */
export const mergeBattleEntries = (
  previous: BattleAction[] | undefined,
  incoming: BattleAction[],
  input: RouterInputs["combat"]["getBattleEntries"],
  nextVersion: number,
): BattleAction[] | undefined => {
  const version = input.refreshKey;
  const limit = input.limit ?? 30;
  const targetVersion = (previous ?? []).reduce(
    (latest, row) => Math.max(latest, row.battleVersion + 1),
    Math.max(version ?? 0, nextVersion),
  );
  if (
    !previous ||
    targetVersion < 1 ||
    (input.userFilter !== undefined && input.userFilter !== "all") ||
    input.showBasicActions === false ||
    input.offset ||
    !incoming.length ||
    incoming.some((entry) => entry.battleId !== input.battleId) ||
    previous.some((entry) => entry.battleId !== input.battleId)
  )
    return undefined;

  // The DB's unique key includes round: duplicate delivery must not duplicate rows.
  const entries = [
    ...new Map(
      [...previous, ...incoming].map((entry) => [
        `${entry.battleVersion}:${entry.battleRound}`,
        entry,
      ]),
    ).values(),
  ]
    .sort((a, b) => b.battleRound - a.battleRound || b.battleVersion - a.battleVersion)
    .slice(0, limit);
  // A claimed version alone cannot prove its log insert finished. Only a full,
  // contiguous page is safe to reuse; filtered pages and genuine gaps still read.
  if (
    entries.length !== Math.min(targetVersion - 1, limit) ||
    entries.some((entry, i) => entry.battleVersion !== targetVersion - 1 - i)
  )
    return undefined;
  return entries;
};

/**
 * Apply a matching battle's confirmed response while preserving a newer cached version.
 * Return undefined for mismatched identities so the captured query is reconciled.
 */
export const getCombatStateUpdate = (
  current: RouterOutputs["combat"]["getBattle"],
  response: Pick<BattleState, "battle" | "result">,
  battleId: string,
): RouterOutputs["combat"]["getBattle"] | undefined => {
  if (current.battle?.id !== battleId || response.battle?.id !== battleId) return;
  return current.battle.version > response.battle.version
    ? current
    : { battle: response.battle, result: response.result ?? null };
};

type PublicBattleFields = Omit<
  ReturnedBattle,
  "usersState" | "usersEffects" | "groundEffects" | "extraState"
>;
type PublicRows<T, Key extends keyof T> = (Partial<T> & Pick<T, Key>)[];

/** Public changes that reconstruct canonical viewer state without disclosing private values. */
export type CombatStateUpdate = {
  previousVersion: number;
  fields: Partial<PublicBattleFields> & Pick<ReturnedBattle, "id" | "version">;
  usersState: PublicRows<ReturnedBattle["usersState"][number], "userId">;
  usersEffects: PublicRows<ReturnedBattle["usersEffects"][number], "id">;
  groundEffects: PublicRows<ReturnedBattle["groundEffects"][number], "id">;
  userIds: string[];
};

/** Capture immutable masked baselines only for battles with other human viewers. */
export const captureCombatStateUpdate = (battle: CompleteBattle) => {
  const viewers = battle.usersState.filter((user) => !user.isAi && !user.isSummon);
  if (viewers.length < 2) return;
  return structuredClone({
    publicBattle: maskBattle(battle, ""),
    viewers: viewers.map(({ userId }) => ({
      userId,
      battle: maskBattle(battle, userId),
    })),
  });
};

/**
 * Build public field changes and admit only living viewers whose complete masked state is
 * reproduced exactly. Catalog changes and private changes retain canonical read recovery.
 */
export const buildCombatStateUpdate = (
  baseline: ReturnType<typeof captureCombatStateUpdate>,
  battle: CompleteBattle,
): CombatStateUpdate | undefined => {
  if (!baseline || battle.version <= baseline.publicBattle.version) return;
  const publicBattle = maskBattle(battle, "");
  const {
    usersState,
    usersEffects,
    groundEffects,
    extraState: _extra,
    ...fields
  } = publicBattle;
  const update: CombatStateUpdate = {
    previousVersion: baseline.publicBattle.version,
    fields: {
      ...changedPublicFields(baseline.publicBattle, fields),
      id: battle.id,
      version: battle.version,
    },
    usersState: usersState.map((user) => ({
      ...changedPublicFields(
        baseline.publicBattle.usersState.find((row) => row.userId === user.userId),
        user,
      ),
      userId: user.userId,
    })),
    usersEffects: usersEffects.map((effect) => ({
      ...changedPublicFields(
        baseline.publicBattle.usersEffects.find((row) => row.id === effect.id),
        effect,
      ),
      id: effect.id,
    })),
    groundEffects: groundEffects.map((effect) => ({
      ...changedPublicFields(
        baseline.publicBattle.groundEffects.find((row) => row.id === effect.id),
        effect,
      ),
      id: effect.id,
    })),
    userIds: [],
  };
  update.userIds = baseline.viewers.flatMap(({ userId, battle: previous }) => {
    const viewer = battle.usersState.find((user) => user.userId === userId);
    return viewer &&
      viewer.curHealth > 0 &&
      !viewer.fledBattle &&
      !viewer.leftBattle &&
      superjson.stringify(applyCombatStateUpdate(previous, update)) ===
        superjson.stringify(maskBattle(battle, userId))
      ? [userId]
      : [];
  });
  return update.userIds.length ? update : undefined;
};

/** Apply a public event only to its exact baseline and an explicitly validated participant. */
export const getCombatEventUpdate = (
  current: RouterOutputs["combat"]["getBattle"],
  update: CombatStateUpdate,
  userId: string | undefined,
): RouterOutputs["combat"]["getBattle"] | undefined => {
  if (!current.battle || current.battle.id !== update.fields.id) return;
  if (current.result || current.battle.version >= update.fields.version) return current;
  if (
    current.battle.version !== update.previousVersion ||
    update.fields.version <= update.previousVersion ||
    !userId ||
    !update.userIds.includes(userId)
  )
    return;
  return { battle: applyCombatStateUpdate(current.battle, update), result: null };
};

/** Preserve viewer-only fields while replacing public roster membership and changed fields. */
const applyCombatStateUpdate = (
  battle: ReturnedBattle,
  update: CombatStateUpdate,
): ReturnedBattle => ({
  ...battle,
  ...update.fields,
  usersState: update.usersState.map((user) => ({
    ...battle.usersState.find((row) => row.userId === user.userId),
    ...user,
  })) as ReturnedBattle["usersState"],
  usersEffects: update.usersEffects.map((effect) => ({
    ...battle.usersEffects.find((row) => row.id === effect.id),
    ...effect,
  })) as ReturnedBattle["usersEffects"],
  groundEffects: update.groundEffects.map((effect) => ({
    ...battle.groundEffects.find((row) => row.id === effect.id),
    ...effect,
  })) as ReturnedBattle["groundEffects"],
});

/** Compare shallow public fields; absent fields require canonical recovery rather than deletion. */
const changedPublicFields = <T extends object>(
  previous: T | undefined,
  next: T,
): Partial<T> =>
  Object.fromEntries(
    Object.entries(next).filter(
      ([key, value]) =>
        superjson.stringify(value) !== superjson.stringify(previous?.[key as keyof T]),
    ),
  ) as Partial<T>;
