import type {
  MasteryName,
  MasteryType,
  SkillTreeTarget,
  UserRank,
} from "@/drizzle/constants";
import {
  DURABILITY_USABILITY_THR,
  MAX_MASTERY_CAP,
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
 * Masteries as the pre-battle gates see them: stored values capped at MAX_MASTERY_CAP
 * when a character rank is present, plus the increasemastery and decreasemastery tags
 * processUsersForBattle applies from the bloodline, skills and worn
 * gear, sized as the combat tags size them. Positive gear buffs can unlock more gear,
 * starting from non-gear sources, so self-unlocks and unsupported cycles cannot count.
 * Gear with mastery penalties stays anchored in non-gear sources: admitting a penalty
 * later could invalidate the gear supporting it.
 * @param user - stored masteries and the sources of their tags
 * @param excludeUserItemId - the gear being gated, so it cannot unlock itself
 */
export const effectiveMasteries = (
  user: MasteryBuffUser,
  excludeUserItemId?: string,
): MasteryStatSource => resolveMasteryGear(user, excludeUserItemId).masteries;

const resolveMasteryGear = (user: MasteryBuffUser, excludeUserItemId?: string) => {
  const cap = user.rank ? MAX_MASTERY_CAP : Number.POSITIVE_INFINITY;
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
  const candidates = (user.items ?? [])
    .filter((ui) => isActiveWornGear(ui, user.bloodlineId))
    .map((ui) => ({ ui, delta: gearMasteryDelta(ui, user, stored) }));
  const penalties = candidates.filter(
    ({ ui, delta }) =>
      MasteryNames.some((name) => delta[name] < 0) &&
      hasMasteryRequirements(withoutGear, ui.item),
  );
  // Penalties cannot borrow gear buffs; count other independently eligible penalties
  // conservatively so disabling a supporting piece never leaves an enabled cycle.
  const penaltyGate = (id: string) => {
    const result = { ...withoutGear };
    for (const { ui, delta } of penalties) {
      if (ui.id === id) continue;
      for (const name of MasteryNames) result[name] += Math.min(delta[name], 0);
    }
    return result;
  };
  const masteries = { ...withoutGear };
  for (const { ui, delta } of penalties) {
    if (
      ui.id !== excludeUserItemId &&
      hasMasteryRequirements(penaltyGate(ui.id), ui.item)
    ) {
      addMasteryDelta(masteries, delta);
    }
  }
  let pending = candidates.filter(
    ({ ui, delta }) =>
      ui.id !== excludeUserItemId && MasteryNames.every((name) => delta[name] >= 0),
  );
  while (pending.length > 0) {
    // Admit a whole layer before adding its buffs, independent of inventory order.
    const enabled = pending.filter(({ ui }) =>
      hasMasteryRequirements(masteries, ui.item),
    );
    if (enabled.length === 0) break;
    for (const { delta } of enabled) addMasteryDelta(masteries, delta);
    pending = pending.filter((candidate) => !enabled.includes(candidate));
  }
  return { masteries, stored, penaltyGate };
};

const addMasteryDelta = (target: MasteryStatSource, delta: MasteryStatSource) => {
  for (const name of MasteryNames) target[name] += delta[name];
};

const gearMasteryDelta = (
  ui: MasteryGear,
  user: MasteryBuffUser,
  stored: MasteryStatSource,
) => {
  const delta = Object.fromEntries(
    MasteryNames.map((name) => [name, 0]),
  ) as MasteryStatSource;
  // AI gear never earns item levels, so it scales with the wearer as in battle.
  addMasteryTags(delta, stored, wornGearTags(ui), user.isAi ? user.level : ui.level);
  return delta;
};

/**
 * The first mastery gate equipped gear misses, or null. Positive gear counts other
 * enabled sources; penalty gear uses the conservative non-gear gate above.
 * @param ui - the equipped gear
 * @param wearer - its owner with the sources of their mastery tags
 */
export const gearMissingMastery = (ui: MasteryGear, wearer: MasteryBuffUser) => {
  const resolved = resolveMasteryGear(wearer, ui.id);
  const delta = gearMasteryDelta(ui, wearer, resolved.stored);
  const gate =
    isWornGear(ui.item) && MasteryNames.some((name) => delta[name] < 0)
      ? resolved.penaltyGate(ui.id)
      : resolved.masteries;
  return missingMasteryRequirement(gate, ui.item);
};

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
export const isActiveWornGear = (ui: MasteryGear, bloodlineId: string | null) =>
  ui.equipped !== "NONE" &&
  isWornGear(ui.item) &&
  hasUsableDurability(ui) &&
  (!ui.item.bloodlineId || ui.item.bloodlineId === bloodlineId);

const hasUsableDurability = (ui: Pick<MasteryGear, "durability" | "item">) =>
  Math.min(ui.durability, ui.item.maxDurability) > DURABILITY_USABILITY_THR;

/** The gear's effects plus its finished imbuements, merged as processUsersForBattle does. */
export const wornGearTags = (ui: MasteryGear) => {
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
