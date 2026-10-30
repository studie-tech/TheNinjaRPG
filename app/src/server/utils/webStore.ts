import { nanoid } from "nanoid";
import { STORE_ORDER_RESERVATION_MINUTES } from "@/drizzle/constants";
import type { userData, userItem } from "@/drizzle/schema";
import { insertUserItems } from "@/queries/item";
import {
  findUserDataForAuthorize,
  findWebStoreBundleForCheckBundlePurchaseLimit,
  findWebStoreOrderById,
  insertPaypalTransactionForDeliverStoreOrder,
  insertWebStoreOrderForReserve,
  listCheckoutUserIdAliases,
  listItemForAuthorize,
  listItemForDeliverStoreOrder,
  lockStoreBuyer,
  selectUserDataForDeliverStoreOrder,
  selectUserDataForReserve,
  selectWebStoreOrderForCheckBundlePurchaseLimit,
  updateUserDataForDeliverStoreOrder,
  updateWebStoreOrderForAuthorize,
  updateWebStoreOrderForDeliverStoreOrder,
} from "@/queries/paypal";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { reputationAllowanceUsed } from "@/server/utils/purchases/allowance";
import { isDeletedStoreUserId } from "@/server/utils/purchases/grant";
import { dynamicMonthlyRepCap, getStoreBundleMinimumPriceCents } from "@/utils/paypal";
import { type StoreContents, storeContentsSchema } from "@/validators/points";

/** Distinguish snapshot-backed purchases from legacy PayPal custom IDs during recovery. */
export const readStoreCustomId = (value?: string) =>
  value?.startsWith("store:") ? value.slice(6) : undefined;

/**
 * Save a server-priced quote and reserve the buyer's allowance and bundle slot.
 * Gifts consume the buyer's lifetime limit, independently of their recipient.
 */
export const reserveStoreOrder = async (
  client: DrizzleClient,
  buyerId: string,
  recipientId: string,
  offer: {
    name: string;
    priceCents: number;
    contents: StoreContents;
    bundleId?: string;
  },
) => {
  const needsBuyerLock = offer.contents.reputationPoints > 0 || !!offer.bundleId;
  const reserve = async (db: DrizzleClient) => {
    const buyerQuery = selectUserDataForReserve(db, buyerId);
    const [buyer] = await (needsBuyerLock ? lockStoreBuyer(buyerQuery) : buyerQuery);
    if (!buyer || buyer.isBanned)
      return {
        success: false as const,
        message: "This account cannot make purchases",
      };
    const bundleError = offer.bundleId
      ? await checkBundlePurchaseLimit(db, buyerId, offer.bundleId)
      : null;
    if (bundleError) return { success: false as const, message: bundleError };
    const allowanceError = await checkStoreAllowance(
      db,
      buyer,
      offer.contents.reputationPoints,
    );
    if (allowanceError) return { success: false as const, message: allowanceError };
    const order = {
      id: nanoid(),
      buyerId,
      recipientId,
      bundleId: offer.bundleId,
      name: offer.name,
      priceCents: offer.priceCents,
      contents: offer.contents,
      expiresAt: new Date(Date.now() + STORE_ORDER_RESERVATION_MINUTES * 60_000),
    };
    await insertWebStoreOrderForReserve(db, order);
    return { success: true as const, message: "Checkout ready", order };
  };
  // Capacity is a SUM/COUNT over other orders, not a remaining-balance row that a
  // single WHERE/CAS can decrement. Different checkout IDs must share the buyer
  // lock across that read and INSERT, or both can reserve the same capacity.
  // Unlimited bundles participate because staff can enable a limit during checkout;
  // zero-reputation custom offers stay outside the transaction.
  return retryOnDeadlock(() =>
    needsBuyerLock ? client.transaction(reserve) : reserve(client),
  );
};

/**
 * Deliver a verified capture once from its immutable checkout snapshot.
 * Paid recovery honors that snapshot even if the offer or its limit has changed;
 * its claim, receipt and rewards commit together to prevent partial delivery.
 */
export const deliverStoreOrder = async (
  client: DrizzleClient,
  input: {
    snapshotId: string;
    captureId: string;
    orderId: string;
    currency: string;
    value: string;
    invoiceId?: string;
    raw: unknown;
  },
) => {
  const order = await findWebStoreOrderById(client, input.snapshotId);
  if (!order)
    throw new Error(
      "Checkout snapshot not found. Contact support with your payment receipt.",
    );
  if (
    input.currency !== "USD" ||
    !/^\d+(?:\.\d{1,2})?$/.test(input.value) ||
    Math.round(Number(input.value) * 100) !== order.priceCents ||
    input.invoiceId !== order.id
  )
    throw new Error(
      "Payment does not match this checkout. Contact support with your payment receipt.",
    );
  if (order.grantedAt) return { success: true, message: "Purchase already delivered" };
  const contents = storeContentsSchema.parse(order.contents);
  const items = contents.items.length
    ? await listItemForDeliverStoreOrder(client, contents)
    : [];
  const grants: (typeof userItem.$inferInsert)[] = [];
  for (const reward of contents.items) {
    const definition = items.find((i) => i.id === reward.id);
    if (!definition)
      throw new Error(
        "A purchased item is unavailable. Contact support; your payment can be retried.",
      );
    const stackSize = definition.canStack ? Math.max(1, definition.stackSize) : 1;
    for (let remaining = reward.quantity; remaining > 0; remaining -= stackSize)
      grants.push({
        id: nanoid(),
        userId: order.recipientId,
        itemId: reward.id,
        quantity: Math.min(remaining, stackSize),
      });
  }
  // Capture uniqueness lives on the order; its claim must commit with the allowance
  // receipt and rewards so retries and account cleanup see the same delivery state.
  // A guarded multi-table UPDATE cannot also INSERT the new receipt/inventory rows.
  return retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      const claim = await updateWebStoreOrderForDeliverStoreOrder(tx, input, order);
      if (claim.rowsAffected !== 1) {
        const current = await findWebStoreOrderById(tx, order.id);
        return current?.grantedAt
          ? { success: true, message: "Purchase already delivered" }
          : {
              success: false,
              message:
                "The checkout account changed. Retry delivery using Lookup Transaction.",
            };
      }
      // Item-only offers still require a recipient, but must not interpret a no-op +0 as absence.
      if (contents.reputationPoints === 0 && contents.money === 0) {
        const [recipient] = await selectUserDataForDeliverStoreOrder(tx, order);
        if (!recipient)
          throw new Error(
            "Recipient unavailable. Contact support with your payment receipt.",
          );
      } else {
        const credited = await updateUserDataForDeliverStoreOrder(tx, contents, order);
        if (credited.rowsAffected !== 1)
          throw new Error(
            "Recipient unavailable. Contact support with your payment receipt.",
          );
      }
      if (grants.length) await insertUserItems(tx, grants);
      await insertPaypalTransactionForDeliverStoreOrder(tx, order, input, contents);
      return {
        success: true,
        message: `${order.name} delivered`,
        delivery: { recipientId: order.recipientId, contents },
        purchase: {
          transactionId: input.captureId,
          name: order.name,
          value: order.priceCents / 100,
          currency: "USD" as const,
          snapshotId: order.id,
        },
      };
    }),
  );
};

/**
 * Revalidate a quote and claim its attempt immediately before capturing payment.
 * Returns null when capture may proceed, otherwise a recoverable user-facing error.
 * The caller retains the attempt token to release only its own confirmed decline.
 */
export const authorizeStoreCapture = async (
  client: DrizzleClient,
  snapshotId: string,
  buyerId: string,
  captureAttemptId = nanoid(),
) => {
  const snapshot = await findWebStoreOrderById(client, snapshotId);
  if (!snapshot) return "This checkout is not available for your account";
  const needsBuyerLock = snapshot.contents.reputationPoints > 0 || !!snapshot.bundleId;
  const authorize = async (db: DrizzleClient) => {
    const buyerQuery = selectUserDataForReserve(db, buyerId);
    // Acquire the lock before consistent reads so queued captures see prior refreshes.
    const [buyer] = await (needsBuyerLock ? lockStoreBuyer(buyerQuery) : buyerQuery);
    const order = snapshot;
    if (!buyer || buyer.isBanned || order.buyerId !== buyerId)
      return "This checkout is not available for your account";
    if (order.grantedAt) return null;
    const bundleError = order.bundleId
      ? await checkBundlePurchaseLimit(db, buyerId, order.bundleId, order.id)
      : null;
    if (bundleError) return bundleError;
    if (isDeletedStoreUserId(order.recipientId))
      return "The recipient account was deleted. No payment was captured.";
    const recipientQuery = findUserDataForAuthorize(db, order);
    const aliasesQuery = listCheckoutUserIdAliases(db, buyerId, order.recipientId);
    const itemsQuery = order.contents.items.length
      ? listItemForAuthorize(db, order)
      : [];
    // PlanetScale transactions share one session and reject overlapping statements.
    const [recipient, aliases, items] = needsBuyerLock
      ? ([await recipientQuery, await aliasesQuery, await itemsQuery] as const)
      : await Promise.all([recipientQuery, aliasesQuery, itemsQuery]);
    if (
      !recipient ||
      recipient.isBanned ||
      recipient.isAi ||
      aliases.some((alias) => isDeletedStoreUserId(alias.newUserId))
    )
      return "The recipient account is no longer available. No payment was captured.";
    if (items.length !== order.contents.items.length)
      return "An item in this checkout is no longer available. No payment was captured.";
    // Stop unpaid quotes that became too cheap; completed captures bypass this preflight.
    if (order.priceCents < getStoreBundleMinimumPriceCents(order.contents, items))
      return "This checkout's price needs updating. Start a new checkout. No payment was captured.";
    const error = await checkStoreAllowance(
      db,
      buyer,
      order.contents.reputationPoints,
      order.id,
    );
    if (error) return error;
    // Snapshot contents stay fixed; guard identities changed by account repair/deletion.
    const refreshed = await updateWebStoreOrderForAuthorize(
      db,
      captureAttemptId,
      order,
      buyerId,
    );
    if (refreshed.rowsAffected !== 1) {
      const current = await findWebStoreOrderById(db, order.id);
      return current?.buyerId === buyerId && current.grantedAt
        ? null
        : "The checkout account changed. Retry checkout. No payment was captured.";
    }
    return null;
  };
  // A CAS on this order alone cannot serialize competing expired orders that both
  // observe a free allowance/bundle slot. Hold the buyer lock through the
  // aggregate check and refresh. Its scope matches reservation creation above;
  // recheck live quotes too, since paid history and staff limits can change.
  return retryOnDeadlock(() =>
    needsBuyerLock ? client.transaction(authorize) : authorize(client),
  );
};

/**
 * Reject unavailable offers or exhausted lifetime usage on the buyer's account.
 * The caller must hold the buyer lock until its reservation INSERT/refresh finishes.
 * Exclude the current quote when refreshing its own slot; paid or in-flight captures
 * retain capacity beyond quote expiry, while an unstarted abandoned quote can expire.
 */
const checkBundlePurchaseLimit = async (
  client: DrizzleClient,
  buyerId: string,
  bundleId: string,
  excludeOrderId?: string,
) => {
  const bundle = await findWebStoreBundleForCheckBundlePurchaseLimit(client, bundleId);
  if (!bundle?.isActive)
    return "This bundle is no longer available. No payment was captured.";
  if (bundle.purchaseLimit === 0) return null;
  const [usage] = await selectWebStoreOrderForCheckBundlePurchaseLimit(
    client,
    buyerId,
    bundleId,
    excludeOrderId,
  );
  return (usage?.count ?? 0) >= bundle.purchaseLimit
    ? "This account has reached this bundle's purchase limit, including other open checkouts. No payment was captured."
    : null;
};

/** Count paid reputation and live reservations; positive reservations hold the buyer lock. */
const checkStoreAllowance = async (
  client: DrizzleClient,
  buyer: typeof userData.$inferSelect,
  points: number,
  excludeOrderId?: string,
) => {
  const used = await reputationAllowanceUsed(
    client,
    buyer.userId,
    "",
    "",
    excludeOrderId,
  );
  return used + points > dynamicMonthlyRepCap(buyer)
    ? "This exceeds your monthly reputation allowance, including other open checkouts. No payment was captured."
    : null;
};
