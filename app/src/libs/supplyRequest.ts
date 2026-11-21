import {
  DURABILITY_MAX_DEFAULT,
  MAP_WAKE_ISLAND_SECTOR,
  SUPPLY_REQUEST_BUNDLE_SIZE,
  SUPPLY_REQUEST_EXPERIENCE,
  SUPPLY_REQUEST_PAYOUT_PERCENT,
} from "@/drizzle/constants";
import type { Item, UserData, UserItem } from "@/drizzle/schema";
import { periodStart } from "@/utils/time";

export const supplyExperienceField = (
  occupation: NonNullable<UserData["occupation"]>,
) =>
  ({
    CRAFTING: "craftingExperience",
    GATHERING: "gatheringExperience",
    HUNTER: "huntingExperience",
  })[occupation] as "craftingExperience" | "gatheringExperience" | "huntingExperience";

export const matchesSupplyProfession = (
  item: Pick<Item, "canBeCrafted" | "canBeGathered" | "canBeHunted">,
  occupation: UserData["occupation"],
) =>
  occupation === "CRAFTING"
    ? item.canBeCrafted
    : occupation === "GATHERING"
      ? item.canBeGathered
      : occupation === "HUNTER"
        ? item.canBeHunted
        : false;

export const isSupplyStackAvailable = (
  stack: Pick<
    UserItem,
    | "quantity"
    | "equipped"
    | "storedAtHome"
    | "isInAuction"
    | "craftingFinishedAt"
    | "activeVariantId"
    | "level"
    | "experience"
    | "durability"
  > & { imbuements: unknown[] },
  now = new Date(),
) =>
  stack.quantity >= SUPPLY_REQUEST_BUNDLE_SIZE &&
  stack.equipped === "NONE" &&
  !stack.storedAtHome &&
  !stack.isInAuction &&
  (!stack.craftingFinishedAt || stack.craftingFinishedAt <= now) &&
  !stack.activeVariantId &&
  stack.imbuements.length === 0 &&
  stack.level === 1 &&
  stack.experience === 0 &&
  stack.durability === DURABILITY_MAX_DEFAULT;

export const supplyRequestBlockMessage = (
  user: Pick<
    UserData,
    "occupation" | "status" | "sector" | "isBanned" | "supplyRequestAt"
  >,
  now = new Date(),
) => {
  if (user.isBanned) return "Banned characters cannot submit supplies.";
  if (user.status !== "AWAKE") return "You must be awake to submit supplies.";
  if (user.sector !== MAP_WAKE_ISLAND_SECTOR)
    return "Visit the Administration Building on Wake Island to submit supplies.";
  if (!user.occupation)
    return "Choose Crafting, Gathering or Hunter as your profession before submitting supplies.";
  if (user.supplyRequestAt && user.supplyRequestAt >= periodStart("daily", now))
    return "You have already submitted supplies this reset.";
  return null;
};

export const getSupplyRequestReward = (auctionMaxPrice: number, quantity: number) => ({
  ryo: Math.round((auctionMaxPrice * quantity * SUPPLY_REQUEST_PAYOUT_PERCENT) / 100),
  experience: (quantity / SUPPLY_REQUEST_BUNDLE_SIZE) * SUPPLY_REQUEST_EXPERIENCE,
});
