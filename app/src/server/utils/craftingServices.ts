import * as Sentry from "@sentry/nextjs";
import { nanoid } from "nanoid";
import { after } from "next/server";
import type { CraftingServiceRequest } from "@/drizzle/schema";
import { getEffectiveStackSize, splitIntoStacks } from "@/libs/item";
import { getServerPusher } from "@/libs/pusher";
import {
  deleteCraftingServices,
  deliverServiceEquipment,
  findOpenServiceRequests,
  findServiceEquipment,
  insertServiceImbuement,
  lockServiceParticipant,
  notifyServiceRequest,
  releaseServiceSlot,
  removeServiceImbuement,
  rewardServiceUser,
  transitionServiceRequest,
} from "@/queries/craftingServices";
import { fetchItemWithCraftingRequirements, insertUserItems } from "@/queries/item";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { notifyPrivateConversation } from "@/server/utils/push/social";
import { returnCraftMaterials } from "@/server/utils/userQueue";

/** A lost escrow/snapshot race rolls back the whole operation and permits a fresh attempt. */
export class CraftingServiceConflict extends Error {}

/** Deliver a receipt exactly once, allowing carried inventory overflow to preserve ownership. */
export const completeCraftingService = async (
  db: DrizzleClient,
  request: CraftingServiceRequest,
) => {
  const [equipment, recipe] = await Promise.all([
    request.targetUserItemId ? findServiceEquipment(db, request) : undefined,
    request.service === "CRAFT"
      ? fetchItemWithCraftingRequirements(db, request.itemId)
      : undefined,
  ]);
  if (request.service === "CRAFT" && !recipe) return refundCraftingService(db, request);

  // Receipt transition, output INSERTs, ownership transfer and payment cannot be expressed
  // as one guarded UPDATE; the transaction prevents partial delivery or lost escrow.
  const notification = await retryOnDeadlock(() =>
    db.transaction(async (tx) => {
      if ((await transitionServiceRequest(tx, request, "COMPLETED")).rowsAffected !== 1)
        return false;
      for (const userId of [request.requesterId, request.crafterId].sort())
        if ((await lockServiceParticipant(tx, userId)).rowsAffected !== 1)
          throw new CraftingServiceConflict(
            "A service participant changed. Please retry",
          );
      if (request.targetUserItemId && !equipment)
        throw new Error("Crafting service escrow equipment missing");
      if (request.service === "CRAFT" && recipe) {
        await insertUserItems(
          tx,
          splitIntoStacks(request.outputQuantity, getEffectiveStackSize(recipe)).map(
            (quantity) => ({
              id: nanoid(),
              userId: request.requesterId,
              itemId: recipe.id,
              quantity,
              durability: recipe.maxDurability,
            }),
          ),
        );
      }
      if (request.service === "IMBUE") {
        if (!request.targetUserItemId || !request.crystalItemId || !request.finishesAt)
          throw new Error("Invalid imbuement receipt");
        await insertServiceImbuement(
          tx,
          request.targetUserItemId,
          request.crystalItemId,
          request.finishesAt,
        );
      }
      if (request.service === "DISIMBUE") {
        if (!request.crystalItemId) throw new Error("Invalid disimbuement receipt");
        if ((await removeServiceImbuement(tx, request)).rowsAffected !== 1)
          throw new CraftingServiceConflict("The submitted imbuement changed");
        await insertUserItems(tx, [
          {
            id: nanoid(),
            userId: request.requesterId,
            itemId: request.crystalItemId,
            quantity: 1,
          },
        ]);
      }
      if (
        request.targetUserItemId &&
        (
          await deliverServiceEquipment(
            tx,
            request,
            request.repairDurability ?? undefined,
          )
        ).rowsAffected !== 1
      )
        throw new CraftingServiceConflict("Equipment delivery changed");
      if (
        (await rewardServiceUser(tx, request.crafterId, request.fee)).rowsAffected !== 1
      )
        throw new CraftingServiceConflict("Crafter account changed");
      return notifyServiceRequest(tx, request, "completed");
    }),
  );
  if (!notification) return false;
  publishServiceNotification(db, notification);
  return true;
};

/** Cancel/decline a receipt and return its complete escrow once, including active jobs on account deletion. */
export const refundCraftingService = async (
  db: DrizzleClient,
  request: CraftingServiceRequest,
) => {
  const notification = await retryOnDeadlock(() =>
    db.transaction(async (tx) => {
      if ((await transitionServiceRequest(tx, request, "REFUNDED")).rowsAffected !== 1)
        return false;
      for (const userId of [request.requesterId, request.crafterId].sort())
        if ((await lockServiceParticipant(tx, userId)).rowsAffected !== 1)
          throw new CraftingServiceConflict(
            "A service participant changed. Please retry",
          );
      // Refund includes INSERTs for vanished material stacks, ownership and a receipt transition.
      // Keeping them in the same transaction makes a failed return safely retryable.
      await returnCraftMaterials(tx, request.requesterId, request.materials, true);
      if (
        request.targetUserItemId &&
        (await deliverServiceEquipment(tx, request)).rowsAffected !== 1
      )
        throw new CraftingServiceConflict("Escrow equipment changed");
      await rewardServiceUser(tx, request.requesterId, request.fee);
      await releaseServiceSlot(tx, request);
      return notifyServiceRequest(tx, request, "refunded");
    }),
  );
  if (!notification) return false;
  publishServiceNotification(db, notification);
  return true;
};

/** Normal profile/request reads settle only already-loaded due receipts, without an extra discovery query. */
export const settleCraftingServices = async (
  db: DrizzleClient,
  requests: readonly CraftingServiceRequest[],
  now = new Date(),
) => {
  let changed = false;
  const failedRequestIds: string[] = [];
  for (const request of requests) {
    if (request.status !== "ACTIVE" || !request.finishesAt || request.finishesAt > now)
      continue;
    try {
      changed = (await completeCraftingService(db, request)) || changed;
    } catch (error) {
      // Failed receipts retain their escrow and a retryable status. The service desk
      // shows delivery feedback while unrelated receipts and profile actions stay usable.
      failedRequestIds.push(request.id);
      Sentry.captureException(error, {
        level: "warning",
        tags: { source: "settleCraftingServices" },
        extra: { requestId: request.id, service: request.service },
      });
    }
  }
  return { changed, failedRequestIds };
};

/** Refund outstanding cross-player escrow before either participant's account is removed. */
export const retireCraftingServices = async (db: DrizzleClient, userId: string) => {
  // The deletion tombstone is already installed. Wait for any submission that passed
  // its write-time identity guard before discovering the receipts it published.
  await lockServiceParticipant(db, userId);
  const requests = await findOpenServiceRequests(db, userId);
  for (const request of requests) await refundCraftingService(db, request);
  await deleteCraftingServices(db, userId);
};

/** Publish committed inbox receipts through the shared websocket and opt-in native push paths. */
export const publishServiceNotification = (
  db: DrizzleClient,
  notification: Awaited<ReturnType<typeof notifyServiceRequest>>,
) => {
  after(async () => {
    const pusher = getServerPusher();
    await Promise.all(
      notification.recipientIds.map((userId) =>
        pusher.trigger(userId, "event", {
          type: "newInbox",
          craftingService: true,
          conversationId: notification.conversationId,
          countedAt: notification.countedAt,
        }),
      ),
    );
  });
  notifyPrivateConversation(db, {
    ...notification,
    isPublic: false,
    authorId: notification.senderId,
  });
};
