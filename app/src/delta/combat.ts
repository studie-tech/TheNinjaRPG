import { CombatStatNames, MasteryNames, REGEN_SECONDS } from "@/drizzle/constants";
import type { UserData, UserTitle } from "@/drizzle/schema";
import type { BattleUserItem, CombatResult, CompleteBattle } from "@/libs/combat/types";
import {
  effectiveMasteries,
  MASTERY_REQUIREMENT_FIELDS,
  type MasteryBuffUser,
  type MasteryGear,
  type MasterySources,
} from "@/libs/mastery";
import { calcMaxEnergy } from "@/libs/profile";
import { getMasteryQueue, hasEnergyQueue } from "@/libs/queue";
import { getRegenerationPeriodGain, type RegenerationPeriod } from "@/libs/timedBuffs";
import type { UserWithRelations } from "@/server/api/routers/profile";
import type { UserDelta } from "@/validators/userCache";

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
export type CombatCacheSnapshot = CombatCacheBaseline & {
  masterySources: MasterySources &
    Pick<MasteryBuffUser, "bloodlineId"> & {
      /** Preserve acquisition snapshots for lobby reconstruction without another database read. */
      titles?: UserTitle[];
    };
};
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
  hadTrainingQueue:
    hasEnergyQueue(user) ||
    getMasteryQueue(user).length > 0 ||
    getMasteryQueue(user, "ELEMENT").length > 0 ||
    !!user.currentlyTrainingElement,
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

/** Only the session player's confirmed settlement may reconcile their profile. */
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
  if (
    hasEnergyQueue(current) ||
    getMasteryQueue(current).length > 0 ||
    getMasteryQueue(current, "ELEMENT").length > 0 ||
    // Arena initiation may finish an elemental session before capturing its baseline.
    current.currentlyTrainingElement ||
    update.baseline.hadTrainingQueue
  )
    return;
  if (current.items.length !== update.baseline.items.length) return;
  const itemFields = [
    "quantity",
    "durability",
    "level",
    "experience",
    "equipped",
  ] as const;
  for (const item of current.items) {
    const original = update.baseline.items.find((row) => row.id === item.id);
    if (!original || itemFields.some((field) => original[field] !== item[field]))
      return;
  }
  const items = current.items.flatMap((item) => {
    const changed = update.items.find((row) => row.id === item.id);
    return changed && changed.quantity > 0 ? [{ ...item, ...changed }] : [];
  });
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
    maxEnergy: update.userPatch.maxEnergy,
    effectiveMasteries: update.userPatch.effectiveMasteries,
  };
};

/** Match the bound settlement timestamp used by combatEnergyRecoverySql. */
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

/** Battle gates do not change persisted equipment slots or item progression. */
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
