import {
  MAX_ACTIVITY_REDUCTION_PERCENT,
  MAX_GATHERING_BONUS_QUANTITY,
  MAX_HUNTING_BONUS_QUANTITY,
} from "@/drizzle/constants";
import {
  gearMissingMastery,
  isActiveWornGear,
  type MasteryBuffUser,
  type MasteryGear,
  wornGearTags,
} from "@/libs/mastery";
import { hasRequiredSkill } from "@/libs/skillRequirements";

/**
 * Sum percentage time reductions and flat yields from the base bloodline,
 * activated skills and usable worn gear/imbuements, using only preloaded relations.
 * Apply the shared caps after stacking all eligible sources.
 * Jobs capture reductions at submission, including queued jobs; gathering and
 * hunting capture yields when collection or battle initiation begins.
 */
export const getActivityBonuses = (user: ActivityBonusUser) => {
  const totals = {
    gatheringReductionPercent: 0,
    farmingReductionPercent: 0,
    craftingReductionPercent: 0,
    cookingReductionPercent: 0,
    huntingBonusQuantity: 0,
    gatheringBonusQuantity: 0,
  };
  const userSkills = (user.userSkills ?? []).filter(
    (skill) => skill.activated === true,
  );
  const now = new Date();
  const items = (user.items ?? [])
    .filter(hasPassiveGearData)
    .filter(
      (gear) =>
        (gear.quantity === undefined || gear.quantity > 0) &&
        !gear.storedAtHome &&
        !gear.isInAuction &&
        (!gear.craftingFinishedAt || gear.craftingFinishedAt < now),
    );
  // Mastery requirements must use the same active skills and available inventory as the bonuses.
  const wearer = { ...user, userSkills, items };
  const tags = [
    ...(user.bloodline?.effects ?? []),
    ...userSkills.flatMap(({ skill }) =>
      skill.effects.filter(
        (tag) => skill.target === "SELF" || tag.friendlyFire !== "ENEMIES",
      ),
    ),
  ].map((tag) => ({ tag, authoredPower: tag.power }));
  const gearTags = items
    .filter(
      (gear) =>
        isActiveWornGear(gear, user.bloodlineId) &&
        (user.isAi || hasRequiredSkill(gear.item, wearer)) &&
        !gearMissingMastery(gear, wearer),
    )
    .flatMap((gear) =>
      wornGearTags(gear).map((tag, index) => ({
        tag,
        // wornGearTags keeps authored base tags before the appended crystals.
        authoredPower: gear.item.effects[index]?.power ?? tag.power,
      })),
    );
  for (const { tag, authoredPower } of [...tags, ...gearTags]) {
    // Persisted content must still satisfy the self-only, noncombat contract.
    if (
      !Number.isFinite(authoredPower) ||
      authoredPower < 0 ||
      !Number.isFinite(tag.power) ||
      tag.power < 0 ||
      (tag.type === "increasehuntingyield" || tag.type === "increasegatheringyield"
        ? tag.calculation !== "static" || !Number.isSafeInteger(tag.power)
        : tag.calculation !== "percentage" ||
          authoredPower > MAX_ACTIVITY_REDUCTION_PERCENT) ||
      tag.powerPerLevel !== 0 ||
      tag.target !== "SELF" ||
      tag.rounds !== undefined
    )
      continue;
    switch (tag.type) {
      case "decreasegatheringtime":
        totals.gatheringReductionPercent += tag.power;
        break;
      case "decreasefarmingtime":
        totals.farmingReductionPercent += tag.power;
        break;
      case "decreasecraftingtime":
        totals.craftingReductionPercent += tag.power;
        break;
      case "decreasecookingtime":
        totals.cookingReductionPercent += tag.power;
        break;
      case "increasegatheringyield":
        totals.gatheringBonusQuantity += tag.power;
        break;
      case "increasehuntingyield":
        totals.huntingBonusQuantity += tag.power;
        break;
    }
  }
  for (const key of [
    "gatheringReductionPercent",
    "farmingReductionPercent",
    "craftingReductionPercent",
    "cookingReductionPercent",
  ] as const)
    totals[key] = Math.min(totals[key], MAX_ACTIVITY_REDUCTION_PERCENT);
  totals.huntingBonusQuantity = Math.min(
    totals.huntingBonusQuantity,
    MAX_HUNTING_BONUS_QUANTITY,
  );
  totals.gatheringBonusQuantity = Math.min(
    totals.gatheringBonusQuantity,
    MAX_GATHERING_BONUS_QUANTITY,
  );
  return totals;
};

/** Ignore narrow profile projections that omit the fields needed to establish passive eligibility. */
const hasPassiveGearData = (gear: ActivityBonusGear): gear is MasteryGear =>
  Array.isArray(gear.item.effects) &&
  typeof gear.item.canBeImbued === "boolean" &&
  gear.item.bloodlineId !== undefined;

/** Accept profile rows with partial item data; only complete passive sources contribute. */
type ActivityBonusGear = Omit<MasteryGear, "item"> & {
  item: Pick<MasteryGear["item"], "itemType" | "maxDurability"> &
    Partial<MasteryGear["item"]>;
};
/** Preloaded passive sources; omitted relations contribute no bonuses. */
type ActivityBonusUser = Omit<MasteryBuffUser, "items"> & {
  items?: ActivityBonusGear[];
};
