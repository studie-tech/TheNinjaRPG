import type {
  MasteryName,
  MasteryType,
  SkillTreeTarget,
  UserRank,
} from "@/drizzle/constants";
import {
  DURABILITY_USABILITY_THR,
  getUserCaps,
  MasteryNames,
} from "@/drizzle/constants";
import type { ZodAllTags } from "@/validators/combat";

export const MASTERY_TYPE_TO_STAT: Record<MasteryType, MasteryName> = {
  Ninjutsu: "ninjutsuMastery",
  Genjutsu: "genjutsuMastery",
  Taijutsu: "taijutsuMastery",
  Bukijutsu: "bukijutsuMastery",
  Bloodline: "bloodlineMastery",
  Sage: "sageMastery",
};

/**
 * Requirement column on Jutsu/Item, the user stat it gates against, and its display name.
 * Single source of truth: the gating check, the content editors and every requirement list
 * in the UI derive from this, so adding a mastery is a one-line change.
 */
export const MASTERY_REQUIREMENT_FIELDS = [
  ["requiredNinjutsuMastery", "ninjutsuMastery", "Ninjutsu Mastery"],
  ["requiredGenjutsuMastery", "genjutsuMastery", "Genjutsu Mastery"],
  ["requiredTaijutsuMastery", "taijutsuMastery", "Taijutsu Mastery"],
  ["requiredBukijutsuMastery", "bukijutsuMastery", "Bukijutsu Mastery"],
  ["requiredBloodlineMastery", "bloodlineMastery", "Bloodline Mastery"],
  ["requiredSageMastery", "sageMastery", "Sage Mastery"],
] as const;

export type MasteryRequirementField = (typeof MASTERY_REQUIREMENT_FIELDS)[number][0];

export type MasteryRequirementFields = {
  [K in MasteryRequirementField]?: number | null;
};

export type MasteryStatSource = Record<MasteryName, number>;

/** Worn gear as the mastery helpers read it; a UserItem row joined with its Item fits. */
export type MasteryGear = {
  id: string;
  equipped: string;
  durability: number;
  level: number;
  item: MasteryRequirementFields & {
    itemType: string;
    maxDurability: number;
    bloodlineId: string | null;
    canBeImbued: boolean;
    effects: ZodAllTags[];
  };
  imbuements?: { craftingFinishedAt: Date | null; item: { effects: ZodAllTags[] } }[];
};

/**
 * Stored masteries plus the out-of-battle sources of mastery tags: the equipped bloodline,
 * activated skills and gear. A source left out contributes nothing.
 */
export type MasteryBuffUser = MasteryStatSource & {
  level: number;
  rank?: UserRank;
  bloodlineId: string | null;
  isAi?: boolean;
  bloodline?: { effects: ZodAllTags[] } | null;
  userSkills?: { skill: { target: SkillTreeTarget; effects: ZodAllTags[] } }[];
  items?: MasteryGear[];
};

export type MasterySources = Pick<
  MasteryBuffUser,
  "bloodline" | "userSkills" | "items"
>;

/**
 * Whether a user meets every mastery requirement on a jutsu or item.
 * @param user - masteries of the user, may be partial for masked battle state
 * @param requirements - the jutsu/item being gated
 */
export const hasMasteryRequirements = (
  user: Partial<MasteryStatSource>,
  requirements?: MasteryRequirementFields | null,
): boolean => !missingMasteryRequirement(user, requirements);

/**
 * The first unmet mastery requirement, or null when the user meets all of them. Drives both
 * the boolean gate and the "why can't I equip this" messages, so they cannot disagree.
 * @param user - masteries of the user, may be partial for masked battle state
 * @param requirements - the jutsu/item being gated
 */
export const missingMasteryRequirement = (
  user: Partial<MasteryStatSource>,
  requirements?: MasteryRequirementFields | null,
): { label: string; required: number; current: number } | null => {
  if (!requirements) return null;
  for (const [reqKey, statKey, label] of MASTERY_REQUIREMENT_FIELDS) {
    const required = requirements[reqKey];
    if (required == null) continue;
    const current = user[statKey];
    // Masked / unknown masteries are treated as met so client-side action lists
    // for opponents (privateState stripped) do not hide gated jutsu and items.
    if (current == null) continue;
    if (current < required) return { label, required, current };
  }
  return null;
};

/**
 * Masteries as the pre-battle gates see them: the stored values, capped at the user's rank
 * as battle caps them, plus the increasemastery
 * and decreasemastery tags processUsersForBattle applies from the bloodline, skills and worn
 * gear, sized as the combat tags size them. Gear counts only when it clears its own gates
 * without any gear, so two pieces cannot unlock each other.
 * @param user - stored masteries and the sources of their tags
 * @param excludeUserItemId - the gear being gated, so it cannot unlock itself
 */
export const effectiveMasteries = (
  user: MasteryBuffUser,
  excludeUserItemId?: string,
): MasteryStatSource => {
  const cap = user.rank ? getUserCaps(user.rank).mastery_cap : Number.POSITIVE_INFINITY;
  const stored = Object.fromEntries(
    MasteryNames.map((name) => [name, Math.min(user[name], cap)]),
  ) as MasteryStatSource;
  const withoutGear = { ...stored };
  addMasteryTags(withoutGear, stored, user.bloodline?.effects ?? [], user.level);
  for (const { skill } of user.userSkills ?? []) {
    // ALLIES/ENEMIES skills reach every combatant their friendly fire allows, owner included
    const ownTags = skill.effects.filter(
      (tag) => skill.target === "SELF" || tag.friendlyFire !== "ENEMIES",
    );
    addMasteryTags(withoutGear, stored, ownTags, user.level);
  }
  const result = { ...withoutGear };
  for (const ui of user.items ?? []) {
    if (ui.id === excludeUserItemId) continue;
    if (!isActiveWornGear(ui, user.bloodlineId)) continue;
    if (!hasMasteryRequirements(withoutGear, ui.item)) continue;
    // AI gear never earns item levels, so it scales with the wearer as in battle
    addMasteryTags(result, stored, wornGearTags(ui), user.isAi ? user.level : ui.level);
  }
  return result;
};

/**
 * The first mastery gate equipped gear misses once every other source is counted, or null.
 * @param ui - the equipped gear
 * @param wearer - its owner with the sources of their mastery tags
 */
export const gearMissingMastery = (ui: MasteryGear, wearer: MasteryBuffUser) =>
  missingMasteryRequirement(effectiveMasteries(wearer, ui.id), ui.item);

/**
 * Whether worn gear stops working for a battle: durability at the floor, or a mastery gate
 * its wearer misses. AI and ranked battles are exempt from mastery gates, as in availableUserActions.
 * @param ui - equipped armor, accessory or keystone
 * @param wearer - its owner with the sources of their mastery tags
 */
export const isWornGearDisabled = (
  ui: MasteryGear,
  wearer: MasteryBuffUser & { isAi: boolean },
  isRankedBattle = false,
) =>
  !hasUsableDurability(ui) ||
  (!wearer.isAi && !isRankedBattle && !!gearMissingMastery(ui, wearer));

/** Armor, accessories and keystones: the gear whose effects apply for the whole battle. */
export const isWornGear = (item: { itemType: string }) =>
  item.itemType === "ARMOR" ||
  item.itemType === "ACCESSORY" ||
  item.itemType === "KEYSTONE";

type MasteryTag = Extract<ZodAllTags, { type: "increasemastery" | "decreasemastery" }>;

const isMasteryTag = (tag: ZodAllTags): tag is MasteryTag =>
  tag.type === "increasemastery" || tag.type === "decreasemastery";

/** Worn gear whose effects processUsersForBattle applies to its wearer. */
const isActiveWornGear = (ui: MasteryGear, bloodlineId: string | null) =>
  ui.equipped !== "NONE" &&
  isWornGear(ui.item) &&
  hasUsableDurability(ui) &&
  (!ui.item.bloodlineId || ui.item.bloodlineId === bloodlineId);

const hasUsableDurability = (ui: Pick<MasteryGear, "durability" | "item">) =>
  Math.min(ui.durability, ui.item.maxDurability) > DURABILITY_USABILITY_THR;

/** The gear's effects plus its finished imbuements, merged as processUsersForBattle does. */
const wornGearTags = (ui: MasteryGear) => {
  if (!ui.item.canBeImbued) return ui.item.effects;
  const now = new Date();
  const imbued = (ui.imbuements ?? []).filter(
    (im) => im.craftingFinishedAt !== null && im.craftingFinishedAt < now,
  );
  return [...ui.item.effects, ...imbued.flatMap((im) => im.item.effects)];
};

/**
 * Add each mastery tag to `target` the way adjustMasteries does: statics add their power,
 * percentages scale the stored value, and power is getPower's for a tag realized at `level`.
 */
const addMasteryTags = (
  target: MasteryStatSource,
  stored: MasteryStatSource,
  tags: ZodAllTags[],
  level: number,
) => {
  for (const tag of tags) {
    if (!isMasteryTag(tag) || tag.rounds === 0) continue;
    // decreasemastery negates power and powerPerLevel before getPower caps percentages
    const magnitude = Math.abs(tag.power) + level * Math.abs(tag.powerPerLevel);
    const signed = tag.type === "decreasemastery" ? -magnitude : magnitude;
    const power = tag.calculation === "percentage" ? Math.min(signed, 100) : signed;
    for (const mastery of tag.masteryTypes) {
      const stat = MASTERY_TYPE_TO_STAT[mastery];
      target[stat] +=
        tag.calculation === "static" ? power : (power / 100) * stored[stat];
    }
  }
};
