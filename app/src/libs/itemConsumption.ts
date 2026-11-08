import { nanoid } from "nanoid";
import type { Item } from "@/drizzle/schema";
import { isRetryableTrpcError } from "@/utils/error";
import {
  safeSessionStorageGetItem,
  safeSessionStorageRemoveItem,
  safeSessionStorageSetItem,
} from "@/utils/storage";

// Memory retains retries when browser storage is unavailable; session storage survives reloads.
const pending = new Map<string, string>();
/** Keep pending openings separate across account switches and inventory stacks. */
const storageKey = (userId: string, userItemId: string) =>
  `tnr:item-consume:${userId}:${userItemId}`;

/** Retain the opening identity through a lost response, dialog closure and page reload. */
export const getItemConsumeRequestId = (userId: string, userItemId: string) => {
  const key = storageKey(userId, userItemId);
  const requestId = pending.get(key) ?? safeSessionStorageGetItem(key) ?? nanoid();
  pending.set(key, requestId);
  safeSessionStorageSetItem(key, requestId);
  return requestId;
};

/** A server response, including an expected rejection, definitively settles this attempt. */
export const finishItemConsumeRequest = (userId: string, userItemId: string) => {
  const key = storageKey(userId, userItemId);
  pending.delete(key);
  // Storage availability does not affect the authoritative server receipt.
  safeSessionStorageRemoveItem(key);
};

/**
 * Build the consume mutation input for an owned stack, shared by every consume button.
 * The server rejects meals without the rendered quantity snapshot; meals settle
 * immediately, so only non-meals keep a retryable opening identity.
 */
export const getItemConsumeInput = (
  userId: string,
  useritem: { id: string; quantity: number; item: { itemType: string } },
) =>
  useritem.item.itemType === "MEAL"
    ? { userItemId: useritem.id, expectedQuantity: useritem.quantity }
    : {
        userItemId: useritem.id,
        expectedQuantity: useritem.quantity,
        requestId: getItemConsumeRequestId(userId, useritem.id),
      };

/** Transport failures leave consumption uncertain; server rejections use the global toast. */
export const getItemConsumeErrorMessage = (
  error: Parameters<typeof isRetryableTrpcError>[0],
  item?: Pick<Item, "effects">,
): string | undefined => {
  if (!isRetryableTrpcError(error)) return;
  const isCache = item?.effects.some(
    (effect) =>
      effect.type === "noncombatconsumereward" &&
      (effect.rewardMode === "weightedCache" || (effect.reward_pets?.length ?? 0) > 0),
  );
  return isCache
    ? "Could not confirm item use. Try Consume again to check the opening."
    : "Could not confirm item use. Refresh your inventory to check the result.";
};
