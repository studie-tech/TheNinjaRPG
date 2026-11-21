import { getInventoryQuantityChanges } from "@/deltas/item";
import { getCraftingUserUpdate } from "@/deltas/occupation";
import type { UserItem } from "@/drizzle/schema";

/** Project paid supply rewards and profession quest progress from the committed snapshot. */
export const getSupplyRequestUserUpdate = (
  props: Parameters<typeof getCraftingUserUpdate>[0],
  ryo: number,
) => {
  const progression = getCraftingUserUpdate(props);
  if (!progression.userPatch) return {};
  return {
    ...progression,
    userPatch: {
      ...progression.userPatch,
      huntingExperience: props.user.huntingExperience,
      gatheringExperience: props.user.gatheringExperience,
      supplyRequestAt: props.user.supplyRequestAt,
    },
    userDelta: { money: ryo },
  };
};

/** Describe the submitted stack; queue settlement withholds changes for an authoritative inventory read. */
export const getSupplyRequestInventoryUpdate = (
  stack: Pick<UserItem, "id" | "itemId" | "quantity">,
  quantity: number,
  updatedAt: Date,
  settlement: { craftingItemsChanged: boolean; startedQueuedJobs: number },
) => {
  if (settlement.craftingItemsChanged || settlement.startedQueuedJobs > 0) return;
  return getInventoryQuantityChanges(
    [stack],
    [{ id: stack.id, quantity: stack.quantity - quantity }],
    updatedAt,
  );
};
