import type { BattleType, ElementName } from "@/drizzle/constants";
import {
  FED_JUTSU_SLOTS,
  JUTSU_TRAIN_TO_LEARN_RESTRICTED_TYPES,
  MAX_EXTRA_JUTSU_SLOTS,
  RankedBattleTypes,
  VILLAGE_SYNDICATE_ID,
} from "@/drizzle/constants";
import type {
  Jutsu,
  JutsuRank,
  UserData,
  UserItemWithItem,
  UserRank,
} from "@/drizzle/schema";
import type { CombatQueryUser } from "@/libs/combat/types";
import { getUserElements } from "@/libs/elementalMastery";
import { isEvolution } from "@/libs/evolution";
import type { MasterySources, MasteryStatSource } from "@/libs/mastery";
import {
  effectiveMasteries,
  hasMasteryRequirements,
  hasUsableDurability,
  missingMasteryRequirement,
} from "@/libs/mastery";
import {
  availableJutsuLetterRanks,
  hasRequiredLevel,
  hasRequiredRank,
} from "@/libs/rank";
import { hasRequiredSkill } from "@/libs/skillRequirements";
import type { UserWithRelations } from "@/routers/profile";
import { getUserFederalStatus } from "@/utils/paypal";

/** Check the jutsu letter rank against the player's shinobi-rank allowance; missing ranks are unavailable. */
export const checkJutsuRank = (rank: JutsuRank | undefined, userrank: UserRank) => {
  if (!rank) return false;
  return availableJutsuLetterRanks(userrank).includes(rank);
};

/** Enforce village ownership, allowing Syndicate jutsu for outlaws. */
export const checkJutsuVillage = (jutsu: Jutsu | undefined, userdata: UserData) => {
  if (!jutsu) return false;
  return (
    !jutsu.villageId ||
    jutsu.villageId === userdata.villageId ||
    (jutsu.villageId === VILLAGE_SYNDICATE_ID && userdata.isOutlaw)
  );
};

/**
 * Match any specified bloodline and reskin against the player's current selection.
 * A matching reskin never bypasses the parent bloodline requirement.
 */
export const checkJutsuBloodline = (jutsu: Jutsu | undefined, userdata: UserData) => {
  if (!jutsu) return false;
  return (
    (!jutsu.bloodlineId || jutsu.bloodlineId === userdata.bloodlineId) &&
    (!jutsu.bloodlineReskinId || jutsu.bloodlineReskinId === userdata.bloodlineReskinId)
  );
};

/** Return a matching effect element after enforcing any explicit classification, or undefined when unavailable. */
export const checkJutsuElements = (jutsu: Jutsu, userElements: Set<ElementName>) => {
  // A classification is an additional requirement; tag elements still gate legacy jutsu.
  if (
    jutsu.elementClassification &&
    jutsu.elementClassification !== "None" &&
    !userElements.has(jutsu.elementClassification)
  )
    return undefined;
  const jutsuElements: ElementName[] = [];
  jutsu.effects.forEach((effect) => {
    if ("elements" in effect && effect.elements) {
      jutsuElements.push(...effect.elements);
    }
  });
  if (jutsuElements.length === 0) jutsuElements.push("None");
  return jutsuElements.find((e) => userElements.has(e));
};

/** Require an equipped weapon of the jutsu's type when a weapon is specified. */
export const checkJutsuItems = (
  jutsu: Jutsu,
  userItems: UserItemWithItem[] | undefined,
) => {
  if (jutsu.jutsuWeapon !== "NONE") {
    const equippedItem = userItems?.find(
      (useritem) =>
        useritem.item.weaponType === jutsu.jutsuWeapon && useritem.equipped !== "NONE",
    );
    if (!equippedItem) return false;
  }
  return true;
};

/** Require the specified equipped bloodline item, applying combat durability rules to defensive gear. */
export const checkJutsuBloodlineItem = (
  jutsu: Jutsu,
  userItems: JutsuBloodlineItemUserItems | undefined,
): boolean => {
  if (!jutsu.requiredBloodlineItemId) return true;
  return !!userItems?.some((ui) => {
    if (ui.itemId !== jutsu.requiredBloodlineItemId || ui.equipped === "NONE") {
      return false;
    }
    // Mirror combat's durability handling: ARMOR/ACCESSORY/KEYSTONE stop counting once
    // they hit the usability floor (processUsersForBattle forces them to "NONE"), but
    // weapons and other types stay equipped at low durability, so don't gate on it here.
    if (
      ui.item.itemType === "ARMOR" ||
      ui.item.itemType === "ACCESSORY" ||
      ui.item.itemType === "KEYSTONE"
    ) {
      return hasUsableDurability(ui, ui.item);
    }
    return true;
  });
};

/** Allow training acquisition for usable base jutsu while leaving activated-skill and bloodline-item gates to use. */
export const canTrainJutsu = (
  jutsu: Jutsu,
  userdata: NonNullable<UserWithRelations>,
  masteries?: MasteryStatSource,
): boolean => {
  if (isEvolution(jutsu.parentJutsuId)) return false;
  // Bloodline items and activated skills gate use, while learning remains available.
  return canUseJutsu(jutsu, userdata, true, masteries, true);
};

/** True for jutsu types that cannot be initially learned via training (owned ones can still be leveled). */
export const isJutsuTrainToLearnRestricted = (jutsuType: Jutsu["jutsuType"]) =>
  (JUTSU_TRAIN_TO_LEARN_RESTRICTED_TYPES as readonly Jutsu["jutsuType"][]).includes(
    jutsuType,
  );

/**
 * Every requirement for using a jutsu, paired with the message shown when it fails. Single
 * source of truth for `canUseJutsu` and for the requirement labels and section grouping on
 * /jutsus, so a new requirement is one row here rather than three lists that can drift.
 */
const jutsuRequirementChecks = (
  jutsu: Jutsu,
  userdata: NonNullable<UserWithRelations>,
  opts?: {
    /**
     * Full user items. Required to evaluate the weapon requirement, because
     * `userdata.items` carries a narrowed `item` without `weaponType`. When omitted the
     * weapon check is skipped rather than silently failing.
     */
    userItems?: UserItemWithItem[];
    ignoreBloodlineItem?: boolean;
    ignoreSkill?: boolean;
    /** Activated skills, counted toward masteries as the server gates count them. */
    userSkills?: MasterySources["userSkills"];
    /** Masteries to gate on; defaults to effectiveMasteries over the bloodline, `userItems` and `userSkills`. */
    masteries?: MasteryStatSource;
  },
): { ok: boolean; warning: string }[] => {
  const bloodlineItems = opts?.userItems ?? userdata.items;
  const userElements = new Set(getUserElements(userdata));
  const masteries =
    opts?.masteries ??
    effectiveMasteries({
      ...userdata,
      items: opts?.userItems ?? [],
      userSkills: opts?.userSkills,
    });
  return [
    {
      ok: jutsu.jutsuType !== "PETS",
      warning: "Only companions can use this jutsu.",
    },
    {
      ok:
        !!opts?.ignoreSkill ||
        hasRequiredSkill(jutsu, {
          userSkills: opts?.userSkills ?? userdata.userSkills,
        }),
      warning: "Activate the required skill to use this jutsu.",
    },
    {
      ok: hasRequiredRank(userdata.rank, jutsu.requiredRank),
      warning: "You do not have the required rank to use this jutsu.",
    },
    {
      ok: hasRequiredLevel(userdata.level, jutsu.requiredLevel),
      warning: "You do not have the required level to use this jutsu.",
    },
    {
      ok: checkJutsuRank(jutsu.jutsuRank, userdata.rank),
      warning: "You do not have the required rank to use this jutsu.",
    },
    {
      ok: checkJutsuVillage(jutsu, userdata),
      warning: "You do not have the required village to use this jutsu.",
    },
    {
      ok: checkJutsuBloodline(jutsu, userdata),
      // A parent mismatch takes precedence over the more specific reskin warning.
      warning:
        jutsu.bloodlineId && jutsu.bloodlineId !== userdata.bloodlineId
          ? "You do not have the required bloodline to use this jutsu."
          : "Select the required bloodline reskin to use this jutsu.",
    },
    {
      ok: hasMasteryRequirements(masteries, jutsu),
      warning: "You do not have the required mastery to use this jutsu.",
    },
    {
      ok: !!checkJutsuElements(jutsu, userElements),
      warning: "You do not have the required elements to use this jutsu.",
    },
    {
      ok: !opts?.userItems || checkJutsuItems(jutsu, opts.userItems),
      warning: `No ${jutsu.jutsuWeapon.toLowerCase()} weapon equipped.`,
    },
    {
      ok: !!opts?.ignoreBloodlineItem || checkJutsuBloodlineItem(jutsu, bloodlineItems),
      warning: "You do not have the required bloodline item equipped.",
    },
  ];
};

/**
 * Check the shared use requirements; AI bypasses these gates and weapon checks stay with the caller.
 * @param masteries - effectiveMasteries over every source the caller loaded; without it only
 *   the bloodline counts
 */
export const canUseJutsu = (
  jutsu: Jutsu,
  userdata: NonNullable<UserWithRelations>,
  ignoreBloodlineItem = false,
  masteries?: MasteryStatSource,
  ignoreSkill = false,
): boolean => {
  if (userdata.isAi) return true;
  // No userItems passed, so the weapon requirement is not checked: toggleEquip allows
  // equipping without the weapon, and non-ranked battles drop such jutsu via
  // checkJutsuItems.
  return jutsuRequirementChecks(jutsu, userdata, {
    ignoreBloodlineItem,
    ignoreSkill,
    masteries,
  }).every(({ ok }) => ok);
};

/**
 * Why battle initiation drops an owned jutsu, as "<name>: <reason>", or undefined when
 * it enters combat. The combat lobby applies the same gates when switching loadouts, so
 * jutsu combat would strip never fill equip slots. Battle usage (PvE/PvP) stays with the
 * caller because it depends on the encounter, not the player's build.
 * @param user - the combatant with `userSkills` and `items` as combat applies them
 * @param masteries - effectiveMasteries over the sources this battle applies
 */
export const battleJutsuGateFailure = (
  jutsu: Jutsu,
  user: Omit<CombatQueryUser, "jutsus">,
  battleType: BattleType,
  masteries: MasteryStatSource,
): string | undefined => {
  // Companion actions are installed separately; even AI loadouts must not inherit them.
  if (jutsu.jutsuType === "PETS")
    return `${jutsu.name}: only companions can use this jutsu`;
  if (user.isAi) return undefined;
  if (!hasRequiredSkill(jutsu, { userSkills: user.userSkills })) {
    return `${jutsu.name}: activate the required skill`;
  }
  // Ranked battles waive weapon and usability requirements, but not bloodline gates.
  if (!RankedBattleTypes.includes(battleType)) {
    if (!checkJutsuItems(jutsu, user.items)) {
      return `${jutsu.name}: no ${jutsu.jutsuWeapon.toLowerCase()} weapon equipped`;
    }
    const missing = missingMasteryRequirement(masteries, jutsu);
    if (missing) return `${jutsu.name}: requires ${missing.required} ${missing.label}`;
    // Provide defaults for optional fields required by the usability checks; the
    // bloodline item is enforced below for every battle type.
    const userForCheck = {
      ...user,
      userQuests: user.userQuests ?? [],
      completedQuests: user.completedQuests ?? [],
    };
    const failed = jutsuRequirementChecks(jutsu, userForCheck, {
      ignoreBloodlineItem: true,
      masteries,
    }).find(({ ok }) => !ok);
    if (failed) return `${jutsu.name}: ${failed.warning}`;
  }
  if (!checkJutsuBloodlineItem(jutsu, user.items)) {
    return `${jutsu.name}: required bloodline item is not equipped`;
  }
  // Only bloodline-bound jutsu are restricted; null and empty IDs are general jutsu.
  if (jutsu.bloodlineId && user.bloodlineId !== jutsu.bloodlineId) {
    return `${jutsu.name}: requires a different bloodline`;
  }
  return undefined;
};

/**
 * The first unmet requirement as a user-facing message, or "" when the jutsu is usable.
 * Passing `userItems` also evaluates the weapon requirement, which toggleEquip does not,
 * and counts worn gear toward masteries. Evolution acquisition ignores the skill use gate.
 */
export const jutsuRequirementWarning = (
  jutsu: Jutsu,
  userdata: NonNullable<UserWithRelations>,
  userItems?: UserItemWithItem[],
  userSkills?: MasterySources["userSkills"],
  ignoreSkill = false,
): string =>
  jutsuRequirementChecks(jutsu, userdata, { userItems, userSkills, ignoreSkill }).find(
    ({ ok }) => !ok,
  )?.warning ?? "";

/** Combine rank, federal and extra-slot allowances; Elite grants one more rank slot than Jonin. */
export const calcJutsuEquipLimit = (userdata: JutsuEquipLimitUser) => {
  const rankContrib = (rank: UserRank) => {
    switch (rank) {
      case "GENIN":
        return 5 + 2;
      case "CHUNIN":
        return 6 + 2;
      case "JONIN":
      case "ELDER":
        return 7 + 2;
      case "ELITE JONIN":
        return 8 + 2;
    }
    return 4 + 2;
  };
  const extraSlots = !userdata.staffAccount
    ? userdata.extraJutsuSlots
    : MAX_EXTRA_JUTSU_SLOTS;
  return (
    1 +
    rankContrib(userdata.rank) +
    FED_JUTSU_SLOTS[getUserFederalStatus(userdata)] +
    extraSlots
  );
};

export type JutsuBloodlineItemUserItems = NonNullable<UserWithRelations>["items"];

type JutsuEquipLimitUser = Pick<
  UserData,
  "rank" | "staffAccount" | "extraJutsuSlots" | "federalStatus"
>;
