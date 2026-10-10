import { CombatStatNames, MasteryNames, REGEN_SECONDS } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import {
  effectiveMasteries,
  MASTERY_REQUIREMENT_FIELDS,
  type MasteryBuffUser,
  type MasteryGear,
  type MasterySources,
} from "@/libs/mastery";
import { calcMaxEnergy } from "@/libs/profile";
import type { UserWithRelations } from "@/server/api/routers/profile";
import type { UserDelta } from "@/validators/userCache";
import type { BattleUserItem, CombatResult, CompleteBattle } from "./types";

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
] as const;
type BaselineField = (typeof baselineFields)[number];
export type CombatCacheBaseline = Pick<UserData, BaselineField> & {
  regenAt: string;
  hadTrainingQueue: boolean;
  items: Pick<
    BattleUserItem,
    "id" | "quantity" | "durability" | "level" | "experience" | "equipped"
  >[];
};
export type CombatCacheSnapshot = CombatCacheBaseline & {
  masterySources: MasterySources & Pick<MasteryBuffUser, "bloodlineId">;
};
export type CombatProfileUpdate = {
  userId: string;
  battleId: string;
  baseline: CombatCacheBaseline;
  userDelta: UserDelta;
  userPatch: {
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

/** Capture persisted progression before combat scaling and effect application. */
export const captureCombatCacheSnapshot = (
  user: UserData &
    Omit<MasteryBuffUser, "items"> & {
      items: (CombatCacheBaseline["items"][number] & MasteryGear)[];
    },
): CombatCacheSnapshot => ({
  ...(Object.fromEntries(baselineFields.map((field) => [field, user[field]])) as Pick<
    UserData,
    BaselineField
  >),
  masterySources: structuredClone({
    bloodlineId: user.bloodlineId,
    bloodline: user.bloodline ? { effects: user.bloodline.effects } : null,
    userSkills: user.userSkills?.map(({ skill }) => ({
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
  hadTrainingQueue: !!user.energyTrainingQueue?.length,
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
  if (current.energyTrainingQueue?.length || update.baseline.hadTrainingQueue) return;
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
    items,
    battleId: null,
    status: "AWAKE" as const,
    stealthActive: false,
    stealthActivatedAt: null,
    maxEnergy: update.userPatch.maxEnergy,
    effectiveMasteries: update.userPatch.effectiveMasteries,
  };
};

/** Match the bound settlement timestamp used by combatEnergyRecoverySql. */
export const combatCacheEnergy = (
  snapshot: CombatCacheBaseline,
  capacity: number,
  regeneration: number,
  at: Date,
  reward: number,
) =>
  Math.min(
    capacity,
    snapshot.curEnergy +
      reward +
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
