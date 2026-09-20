import { and, eq, gt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  type Item,
  type UserData,
  type UserItemWithItem,
  userData,
  userItem,
} from "@/drizzle/schema";
import { getInventoryBucket, getInventoryBucketCapacity } from "@/libs/item";
import type { DrizzleClient } from "@/server/db";
import { getNextUserSnapshotAt } from "@/server/utils/concurrency";

export type CaughtFishAwardResult = "DELIVERED" | "FULL" | "CHANGED";
type CaughtFishDeliveryClient = Pick<DrizzleClient, "insert" | "update">;

/** Pure stack calculation for placing a catch in the item's normal inventory bucket. */
export const getCaughtFishStackRequirement = ({
  itemInfo,
  quantity,
  userItems,
}: {
  itemInfo: Pick<Item, "id" | "canStack" | "stackSize">;
  quantity: number;
  userItems: readonly Pick<
    UserItemWithItem,
    | "id"
    | "itemId"
    | "quantity"
    | "equipped"
    | "storedAtHome"
    | "isInAuction"
    | "craftingFinishedAt"
    | "item"
  >[];
}) => {
  const stackSize = itemInfo.canStack ? Math.max(1, itemInfo.stackSize) : 1;
  const now = new Date();
  const reusable = itemInfo.canStack
    ? userItems.find(
        (stack) =>
          stack.itemId === itemInfo.id &&
          stack.quantity > 0 &&
          stack.equipped === "NONE" &&
          !stack.storedAtHome &&
          !stack.isInAuction &&
          (!stack.craftingFinishedAt || stack.craftingFinishedAt < now),
      )
    : undefined;
  const reusableSpace = reusable ? Math.max(0, stackSize - reusable.quantity) : 0;
  return {
    reusable,
    stackSize,
    newStacks: Math.ceil(Math.max(0, quantity - reusableSpace) / stackSize),
  };
};

/**
 * Delivers caught fish through the standard bucket rules. Fish items use the cooking
 * bucket, so this shares its capacity with other cooking ingredients and prepared food.
 */
export const awardCaughtFish = async ({
  client,
  user,
  userId,
  itemInfo,
  userItems,
  quantity = 1,
}: {
  client: CaughtFishDeliveryClient;
  user: UserData;
  userId: string;
  itemInfo: Item;
  userItems: UserItemWithItem[];
  quantity?: number;
}): Promise<CaughtFishAwardResult> => {
  if (quantity <= 0) return "DELIVERED";
  const { reusable, stackSize, newStacks } = getCaughtFishStackRequirement({
    itemInfo,
    quantity,
    userItems,
  });
  const bucket = getInventoryBucket(itemInfo);
  const bucketCount = userItems.filter(
    (stack) =>
      !stack.storedAtHome &&
      stack.quantity > 0 &&
      getInventoryBucket(stack.item) === bucket,
  ).length;
  if (bucketCount + newStacks > getInventoryBucketCapacity(bucket, user)) return "FULL";

  const snapshot = await client
    .update(userData)
    .set({ updatedAt: getNextUserSnapshotAt(user.updatedAt) })
    .where(and(eq(userData.userId, userId), eq(userData.updatedAt, user.updatedAt)));
  if (Number(snapshot.rowsAffected ?? 0) !== 1) return "CHANGED";

  let remaining = quantity;
  if (reusable) {
    const toAdd = Math.min(remaining, Math.max(0, stackSize - reusable.quantity));
    if (toAdd > 0) {
      const fill = await client
        .update(userItem)
        .set({ quantity: sql`${userItem.quantity} + ${toAdd}`, updatedAt: new Date() })
        .where(
          and(
            eq(userItem.id, reusable.id),
            eq(userItem.userId, userId),
            eq(userItem.quantity, reusable.quantity),
            gt(userItem.quantity, 0),
            sql`${userItem.quantity} + ${toAdd} <= ${stackSize}`,
          ),
        );
      if (Number(fill.rowsAffected ?? 0) !== 1) return "CHANGED";
      remaining -= toAdd;
    }
  }
  if (remaining > 0) {
    const stacks = [];
    while (remaining > 0) {
      const stackQuantity = Math.min(remaining, stackSize);
      stacks.push({
        id: nanoid(),
        userId,
        itemId: itemInfo.id,
        quantity: stackQuantity,
        equipped: "NONE" as const,
      });
      remaining -= stackQuantity;
    }
    await client.insert(userItem).values(stacks);
  }
  return "DELIVERED";
};
