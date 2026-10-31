import { nanoid } from "nanoid";
import { AUCTION_HOUSE_MIN_LEVEL, auctionHouseLevelMessage } from "@/drizzle/constants";
import type { UserItemWithRelations, userData } from "@/drizzle/schema";
import { isEquippableUserItem, isImbuing } from "@/libs/item";
import { getAuctionPriceError } from "@/libs/itemEconomy";
import {
  fetchOfferItem,
  findAuctionOfferForAcceptAuctionOffer,
  findAuctionOfferForCancelAuctionOffer,
  insertAuctionOfferForCreateAuctionOffer,
  insertUserItemForMoveOfferItem,
  listAuctionOfferForGetAuctionOffers,
  listItemForGetAuctionOfferItems,
  logOffer,
  updateAuctionOfferForAcceptAuctionOffer,
  updateAuctionOfferForCancelAuctionOffer,
  updateUserDataForAcceptAuctionOffer,
  updateUserDataForClaimOfferUser,
  updateUserDataForCreateAuctionOffer,
  updateUserItemForCancelAuctionOffer,
  updateUserItemForMoveOfferItem,
} from "@/queries/auctionOffers";
import { fetchItem } from "@/queries/item";
import { findUserById } from "@/queries/profile";
import {
  baseServerResponse,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { deferPushToUsers } from "@/server/utils/push/defer";
import { tradeUpdate } from "@/server/utils/push/messages";
import {
  acceptAuctionOfferSchema,
  auctionOfferIdSchema,
  createAuctionOfferSchema,
  getAuctionOffersSchema,
} from "@/validators/auction";

export const auctionOfferProcedures = {
  getAuctionOfferItems: protectedProcedure.query(({ ctx }) =>
    listItemForGetAuctionOfferItems(ctx.drizzle),
  ),

  getAuctionOffers: protectedProcedure
    .input(getAuctionOffersSchema)
    .query(async ({ ctx, input }) => {
      const rows = await listAuctionOfferForGetAuctionOffers(ctx.drizzle, input, ctx);
      return {
        data: rows.slice(0, input.limit),
        nextCursor: rows.length > input.limit ? (input.cursor ?? 0) + 1 : null,
      };
    }),

  createAuctionOffer: protectedProcedure
    .input(createAuctionOfferSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, requested, offered] = await Promise.all([
        findUserById(ctx.drizzle, ctx.userId),
        fetchItem(ctx.drizzle, input.requestedItemId),
        input.offerType === "TRADE"
          ? fetchOfferItem(ctx.drizzle, input.offeredUserItemId, ctx.userId)
          : Promise.resolve(undefined),
      ]);
      const userError = offerUserError(user);
      if (userError) return errorResponse(userError);
      if (!requested?.canBeTraded || requested.hidden)
        return errorResponse("Requested item is not tradable");
      if (input.offerType === "REQUEST" && requested.itemType !== "MATERIAL")
        return errorResponse("Ryo requests are for materials");
      if (!requested.canStack && input.requestedQuantity !== 1)
        return errorResponse("Non-stackable items must have quantity 1");
      if (input.offerType === "REQUEST") {
        const priceError = getAuctionPriceError(
          requested,
          "AUCTION",
          input.ryo,
          input.requestedQuantity,
          "MONEY",
        );
        if (priceError) return errorResponse(priceError);
      } else {
        const itemError = offerItemError(offered, input.offeredQuantity);
        if (itemError) return errorResponse(itemError);
      }
      const id = nanoid();
      return runOfferMutation(ctx.drizzle, async (tx) => {
        let offeredUserItemId: string | null = null;
        if (input.offerType === "REQUEST") {
          const debit = await updateUserDataForCreateAuctionOffer(
            tx,
            input,

            ctx,
          );
          requireOfferWrite(
            debit.rowsAffected,
            "Insufficient funds in bank or trading access changed",
          );
        } else if (offered) {
          await claimOfferUser(tx, ctx.userId);
          offeredUserItemId = await moveOfferItem(
            tx,
            offered,
            input.offeredQuantity,
            ctx.userId,
            true,
          );
        }
        await insertAuctionOfferForCreateAuctionOffer(
          tx,
          id,
          ctx,
          input,
          offeredUserItemId,
        );
        await logOffer(tx, ctx.userId, id, "CREATE", input);
        return {
          success: true,
          message: "Offer posted; your payment is reserved until accepted or cancelled",
        };
      });
    }),

  acceptAuctionOffer: protectedProcedure
    .input(acceptAuctionOfferSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [offer, accepter, supplied] = await Promise.all([
        findAuctionOfferForAcceptAuctionOffer(ctx.drizzle, input),
        findUserById(ctx.drizzle, ctx.userId),
        fetchOfferItem(ctx.drizzle, input.userItemId, ctx.userId),
      ]);
      if (offer?.status !== "ACTIVE") return errorResponse("Offer is no longer active");
      if (offer.ownerId === ctx.userId)
        return errorResponse("You cannot accept your own offer");
      const userError = offerUserError(accepter) ?? offerUserError(offer.owner);
      if (userError) return errorResponse(userError);
      if (
        !offer.requestedItem?.canBeTraded ||
        supplied?.itemId !== offer.requestedItemId
      )
        return errorResponse("Choose the requested item from your inventory");
      const itemError = offerItemError(supplied, offer.requestedQuantity);
      if (itemError) return errorResponse(itemError);
      if (
        offer.offerType === "TRADE" &&
        (!offer.offeredUserItem?.item.canBeTraded ||
          !offer.offeredUserItem.isInAuction ||
          offer.offeredUserItem.userId !== offer.ownerId ||
          offer.offeredUserItem.quantity !== offer.offeredQuantity)
      )
        return errorResponse("Offered item is no longer available");
      if (
        offer.offeredUserItem &&
        (offer.offeredUserItem.storedAtHome ||
          offer.offeredUserItem.equipped !== "NONE")
      )
        return errorResponse(
          "The seller's offered item is currently unavailable; ask them to retrieve it or cancel the offer",
        );
      if (!supplied) return errorResponse("Item is unavailable");
      const result = await runOfferMutation(ctx.drizzle, async (tx) => {
        // Claim the offer before either side moves. Every subsequent write rolls back on conflict.
        const claim = await updateAuctionOfferForAcceptAuctionOffer(tx, ctx, offer);
        requireOfferWrite(
          claim.rowsAffected,
          "Offer was accepted or cancelled; please refresh",
        );
        // Stable account order keeps concurrent exchanges from taking opposite user-row locks.
        for (const id of [ctx.userId, offer.ownerId].sort())
          await claimOfferUser(tx, id);
        await moveOfferItem(
          tx,
          supplied,
          offer.requestedQuantity,
          offer.ownerId,
          false,
        );
        if (offer.offerType === "REQUEST") {
          const payment = await updateUserDataForAcceptAuctionOffer(tx, offer, ctx);
          requireOfferWrite(payment.rowsAffected, "Recipient account is unavailable");
        } else if (offer.offeredUserItem) {
          await moveOfferItem(
            tx,
            offer.offeredUserItem,
            offer.offeredQuantity ?? 0,
            ctx.userId,
            false,
            true,
          );
        }
        await logOffer(tx, ctx.userId, offer.id, "ACCEPT", {
          ownerId: offer.ownerId,
          userItemId: supplied.id,
          requestedQuantity: offer.requestedQuantity,
          ryo: offer.ryo,
          offeredUserItemId: offer.offeredUserItemId,
        });
        return {
          success: true,
          message: "Offer accepted; items and payment delivered",
        };
      });
      if (result.success)
        deferPushToUsers(ctx.drizzle, [offer.ownerId], tradeUpdate(offer.id));
      return result;
    }),

  cancelAuctionOffer: protectedProcedure
    .input(auctionOfferIdSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const offer = await findAuctionOfferForCancelAuctionOffer(
        ctx.drizzle,
        input,
        ctx,
      );
      if (offer?.status !== "ACTIVE") return errorResponse("Offer is no longer active");
      return runOfferMutation(ctx.drizzle, async (tx) => {
        const claim = await updateAuctionOfferForCancelAuctionOffer(tx, offer, ctx);
        requireOfferWrite(
          claim.rowsAffected,
          "Offer was accepted or cancelled; please refresh",
        );
        if (offer.offerType === "REQUEST") {
          const refund = await updateUserDataForAcceptAuctionOffer(tx, offer, ctx);
          requireOfferWrite(refund.rowsAffected, "Account is unavailable");
        } else {
          // Cancellation reclaims the owner's row even if an in-flight grant changed its quantity.
          const release = await updateUserItemForCancelAuctionOffer(tx, offer, ctx);
          requireOfferWrite(release.rowsAffected, "Reserved item is unavailable");
        }
        await logOffer(tx, ctx.userId, offer.id, "CANCEL", {
          ryo: offer.ryo,
          offeredUserItemId: offer.offeredUserItemId,
        });
        return { success: true, message: "Offer cancelled; reserved payment returned" };
      });
    }),
};

const offerUserError = (user: typeof userData.$inferSelect | undefined | null) => {
  if (!user) return "Account not found";
  if (user.isBanned || user.isTradeBanned) return "Account is banned from trading";
  if (user.level < AUCTION_HOUSE_MIN_LEVEL) return auctionHouseLevelMessage;
  return null;
};

const claimOfferUser = async (tx: OfferTransaction, id: string) => {
  const result = await updateUserDataForClaimOfferUser(tx, id);
  requireOfferWrite(result.rowsAffected, "Trading access changed; please refresh");
};

const offerItemError = (row: UserItemWithRelations | undefined, quantity: number) => {
  if (
    !row?.item.canBeTraded ||
    row.quantity < quantity ||
    row.equipped !== "NONE" ||
    !isEquippableUserItem(row) ||
    isImbuing(row)
  )
    return "Item is not available for trading";
  if (!row.item.canStack && quantity !== 1)
    return "Non-stackable items must have quantity 1";
  if (quantity < row.quantity && row.imbuements.length > 0)
    return "Cannot split items with imbuements";
  return null;
};

/** Unlike standalone splitting, this split must roll back with the offer and both payments. */
const moveOfferItem = async (
  tx: OfferTransaction,
  row: UserItemWithRelations,
  quantity: number,
  recipientId: string,
  reserve: boolean,
  wasReserved = false,
) => {
  const { item: _item, imbuements: _imbuements, ...snapshot } = row;
  const isPartial = quantity < row.quantity;
  const destinationId = isPartial ? nanoid() : row.id;
  const result = await updateUserItemForMoveOfferItem(
    tx,
    isPartial,
    quantity,
    recipientId,
    reserve,
    row,
    wasReserved,
  );
  requireOfferWrite(
    result.rowsAffected,
    "Inventory changed; please refresh and try again",
  );
  if (isPartial)
    await insertUserItemForMoveOfferItem(
      tx,
      snapshot,
      destinationId,
      recipientId,
      quantity,
      reserve,
      row,
    );
  return destinationId;
};

const requireOfferWrite = (rowsAffected: number, message: string) => {
  if (rowsAffected !== 1)
    throw Object.assign(new Error(message), { name: "AuctionOfferConflict" });
};

const runOfferMutation = async (
  database: DrizzleClient,
  work: (tx: OfferTransaction) => Promise<{ success: boolean; message: string }>,
) => {
  try {
    // These cross-user exchanges need multiple rows to commit together; a lone guarded update
    // cannot couple an offer claim, a split inventory row and delivery to the other account.
    return await retryOnDeadlock(() => database.transaction(work));
  } catch (error) {
    if (error instanceof Error && error.name === "AuctionOfferConflict")
      return errorResponse(error.message);
    throw error;
  }
};

type OfferTransaction = Parameters<Parameters<DrizzleClient["transaction"]>[0]>[0];
