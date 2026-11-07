import { nanoid } from "nanoid";
import { z } from "zod";
import {
  getCaptureStoreOrderUserUpdate,
  getSubscribeWithRepsUserUpdate,
} from "@/deltas/paypal";
import { FederalStatuses } from "@/drizzle/constants";
import { isNativeUserAgent } from "@/libs/native/userAgent";
import {
  executeResultForUpgradeSubscription,
  findPaypalSubscriptionForCancelPaypalSubscription,
  findPaypalSubscriptionForUpgradeSubscription,
  findWebStoreBundleById,
  findWebStoreOrderById,
  insertActionLogForSaveStoreBundle,
  insertPaypalSubscriptionForSubscribeWithReps,
  insertWebStoreBundleForSaveStoreBundle,
  listCheckoutUserIdAliases,
  listItemForGetStoreBundles,
  listItemForPrepareWebCheckout,
  listItemForSaveStoreBundle,
  listPaypalSubscriptionForGetPaypalSubscriptions,
  listPaypalTransactionForGetPaypalTransactions,
  listWebStoreBundleForGetStoreBundles,
  releaseDeclinedStoreCapture,
  selectWebStoreOrderForGetStoreBundles,
  updatePaypalSubscriptionForCancelPaypalSubscription,
  updateUserDataForSubscribeWithReps,
  updateUserDataForSubscribeWithReps2,
  updateWebStoreBundleForSaveStoreBundle,
  updateWebStoreOrderForCreateStoreOrder,
} from "@/queries/paypal";
import { fetchUser, findUserById } from "@/queries/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { offsetPage } from "@/server/utils/pagination";
import type { PaypalOrder } from "@/server/utils/paypal/client";
import {
  cancelPaypalSubscription,
  getPaypalAccessToken,
  getPaypalOrder,
  getPaypalSubscription,
  getPaypalTransactions,
  requestStorePaypalOrder,
} from "@/server/utils/paypal/client";
import {
  deliverPaypalOrder,
  parsePaypalSubscriptionOwners,
  reconcilePaypalSubscription,
  syncTransactions,
} from "@/server/utils/paypal/fulfillment";
import { reputationAllowanceUsed } from "@/server/utils/purchases/allowance";
import {
  fetchPurchaseUserCacheInputs,
  getKnownPurchaseUserUpdate,
} from "@/server/utils/purchases/cache";
import { setFederalStatusWithStoreFloor } from "@/server/utils/purchases/federalStatus";
import {
  canonicalStoreUserId,
  isDeletedStoreUserId,
} from "@/server/utils/purchases/storeIdentity";
import { upgradeStripeFederalWithReps } from "@/server/utils/stripe/fulfillment";
import {
  authorizeStoreCapture,
  deliverStoreOrder,
  readStoreCustomId,
  reserveStoreOrder,
  storePaymentMatches,
} from "@/server/utils/webStore";
import {
  calcFedUgradeCost,
  fedStatusRepsCost,
  getStoreBundleMinimumPriceCents,
  reps2dollars,
} from "@/utils/paypal";
import { canManageStore, canSeeSecretData } from "@/utils/permissions";
import {
  searchPaypalTransactionSchema,
  storeBundleSchema,
  storeBundleSchemaForItems,
  storeCheckoutSchema,
} from "@/validators/points";
import { userDeltaResponseSchema } from "@/validators/userCache";
import type { DrizzleClient } from "../../db";

const PAYPAL_DECLINED_MESSAGE =
  "PayPal declined the payment. No payment was captured. Start a new checkout with another payment method.";

export const paypalRouter = createTRPCRouter({
  /** List offers with the caller's lifetime buyer counts; managers may include drafts. */
  getStoreBundles: protectedProcedure
    .input(z.object({ includeInactive: z.boolean().optional() }).nullish())
    .query(async ({ ctx, input }) => {
      const user = input?.includeInactive
        ? await fetchUser(ctx.drizzle, ctx.userId)
        : undefined;
      if (input?.includeInactive && !canManageStore(user?.role))
        throw serverError(
          "FORBIDDEN",
          "Only the owner and content administrators can manage store bundles",
        );
      const [bundles, items, purchases] = await Promise.all([
        listWebStoreBundleForGetStoreBundles(ctx.drizzle, input),
        listItemForGetStoreBundles(ctx.drizzle),
        selectWebStoreOrderForGetStoreBundles(ctx.drizzle, ctx),
      ]);
      const purchaseCounts = new Map(
        purchases.map((purchase) => [purchase.bundleId, purchase.count]),
      );
      return {
        bundles: bundles.map((bundle) => ({
          ...bundle,
          purchaseCount: purchaseCounts.get(bundle.id) ?? 0,
        })),
        items,
      };
    }),
  /** Save a validated offer and its content diff using the content-editor audit convention. */
  saveStoreBundle: protectedProcedure
    .input(z.object({ id: z.string().optional(), data: storeBundleSchema }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, existing, items] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        input.id ? findWebStoreBundleById(ctx.drizzle, input.id) : undefined,
        listItemForSaveStoreBundle(ctx.drizzle),
      ]);
      if (user.isBanned || !canManageStore(user.role))
        return errorResponse(
          "Only the owner and content administrators can manage store bundles",
        );
      if (input.id && !existing) return errorResponse("Bundle no longer exists");
      if (
        input.data.contents.items.some(
          (reward) => !items.some((i) => i.id === reward.id),
        )
      )
        return errorResponse("Select existing items for the bundle");
      const validated = storeBundleSchemaForItems(items).safeParse(input.data);
      if (!validated.success)
        return errorResponse(
          validated.error.issues[0]?.message ?? "Check the bundle price",
        );
      const id = input.id ?? nanoid();
      await Promise.all([
        existing
          ? updateWebStoreBundleForSaveStoreBundle(ctx.drizzle, input, id)
          : insertWebStoreBundleForSaveStoreBundle(ctx.drizzle, id, input),
        insertActionLogForSaveStoreBundle(ctx.drizzle, ctx, id, existing, input),
      ]);
      return { success: true, message: "Store bundle saved" };
    }),
  /** Freeze server-priced contents and reserve buyer allowance/bundle capacity before checkout. */
  createStoreOrder: protectedProcedure
    .input(storeCheckoutSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await prepareWebCheckout(ctx, input);
      if (!result.success || !("order" in result)) return result;
      const order = result.order;
      try {
        const token = await getPaypalAccessToken();
        const providerOrder = await requestStorePaypalOrder(
          token,
          "/v2/checkout/orders",
          `create:${order.id}`,
          {
            intent: "CAPTURE",
            purchase_units: [
              {
                description: order.name,
                amount: {
                  currency_code: "USD",
                  value: (order.priceCents / 100).toFixed(2),
                },
                invoice_id: order.id,
                custom_id: `store:${order.id}`,
              },
            ],
          },
        );
        if (!providerOrder?.id) throw new Error("PayPal could not create checkout");
        return {
          success: true as const,
          message: "Checkout ready",
          orderId: providerOrder.id,
        };
      } catch (error) {
        await updateWebStoreOrderForCreateStoreOrder(ctx.drizzle, order);
        throw error;
      }
    }),
  /** Revalidate an unpaid checkout before capture, or safely finish delivery of a paid one. */
  captureStoreOrder: protectedProcedure
    .input(z.object({ orderId: z.string().min(15).max(20) }))
    .output(
      userDeltaResponseSchema.extend({
        purchase: z
          .object({
            transactionId: z.string(),
            name: z.string(),
            value: z.number(),
            currency: z.literal("USD"),
            snapshotId: z.string(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (isNativeUserAgent(ctx.userAgent))
        return errorResponse("Use the in-app store to make purchases");
      const token = await getPaypalAccessToken();
      let order = await getPaypalOrder({ orderId: input.orderId, token });
      const snapshotId = readStoreCustomId(order?.purchase_units?.[0]?.custom_id);
      if (!snapshotId) return errorResponse("Checkout not found");
      const snapshot = await findWebStoreOrderById(ctx.drizzle, snapshotId);
      if (!snapshot || snapshot.buyerId !== ctx.userId)
        return errorResponse("This checkout belongs to another account");
      const unit = order?.purchase_units?.[0];
      if (order?.purchase_units?.length !== 1 || !unitMatchesSnapshot(unit, snapshot))
        return errorResponse(
          "Payment does not match this checkout. No payment was captured.",
        );
      if (order?.status !== "COMPLETED" && order?.status !== "APPROVED")
        return errorResponse(
          "Approve this checkout with PayPal before capturing payment. No payment was captured.",
        );
      // Only an undelivered scalar self purchase can use an arithmetic projection.
      // Gifts leave the actor unchanged; inventory and receipt replays need recovery.
      const purchaseInputsQuery =
        !snapshot.grantedAt &&
        snapshot.recipientId === ctx.userId &&
        !snapshot.contents.items.length
          ? fetchPurchaseUserCacheInputs(ctx.drizzle, ctx.userId).catch(() => undefined)
          : undefined;
      // A completed order can still contain a failed capture: recovery releases the
      // saved attempt, while a new capture POST below must claim a fresh token.
      let captureAttemptId = snapshot.captureAttemptId;
      const releaseDeclinedCapture = () =>
        captureAttemptId
          ? releaseDeclinedStoreCapture(
              ctx.drizzle,
              snapshotId,
              ctx.userId,
              captureAttemptId,
            )
          : Promise.resolve();
      if (order?.status !== "COMPLETED") {
        captureAttemptId = nanoid();
        const [allowanceError] = await Promise.all([
          authorizeStoreCapture(ctx.drizzle, snapshotId, ctx.userId, captureAttemptId),
          purchaseInputsQuery,
        ]);
        if (allowanceError) return errorResponse(allowanceError);
        order = await requestStorePaypalOrder(
          token,
          `/v2/checkout/orders/${input.orderId}/capture`,
          `capture:${snapshotId}`,
          {},
          releaseDeclinedCapture,
        );
        if (!order) return errorResponse(PAYPAL_DECLINED_MESSAGE);
      }
      // Some provider responses are minimal; fetch the completed representation before delivery.
      if (!order?.purchase_units?.[0]?.payments?.captures?.length)
        order = await getPaypalOrder({ orderId: input.orderId, token });
      const capture = order?.purchase_units?.[0]?.payments?.captures?.[0];
      if (isDeclinedStoreCapture(capture?.status)) {
        await releaseDeclinedCapture();
        return errorResponse(PAYPAL_DECLINED_MESSAGE);
      }
      if (capture?.status !== "COMPLETED")
        return errorResponse(
          "Payment is awaiting confirmation. Use Lookup Transaction after it clears.",
        );
      const purchaseInputs = await purchaseInputsQuery;
      const result = await deliverStoreCapture(
        ctx.drizzle,
        snapshotId,
        input.orderId,
        order,
        capture,
      );
      const { delivery, ...response } = result;
      if (!delivery) return response;
      if (delivery.recipientId !== ctx.userId)
        return { ...response, ...getCaptureStoreOrderUserUpdate() };
      return {
        ...response,
        ...(!delivery.contents.items.length
          ? getKnownPurchaseUserUpdate(
              purchaseInputs,
              {},
              {
                money: delivery.contents.money,
                reputationPoints: delivery.contents.reputationPoints,
                reputationPointsTotal: delivery.contents.reputationPoints,
              },
            )
          : {}),
      };
    }),

  /** Reconcile an existing provider order without initiating or retrying payment capture. */
  resolveOrder: protectedProcedure
    .input(z.strictObject({ orderId: z.string().min(15).max(20) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      if (isNativeUserAgent(ctx.userAgent))
        return errorResponse("Use the in-app store to purchase in the native app.");
      const token = await getPaypalAccessToken();
      const order = await getPaypalOrder({ orderId: input.orderId, token: token });
      if (order === undefined) {
        throw serverError("INTERNAL_SERVER_ERROR", "Could not fetch order");
      }
      const unit = order.purchase_units?.[0];
      const snapshotId = readStoreCustomId(unit?.custom_id);
      if (snapshotId) {
        const snapshot = await findWebStoreOrderById(ctx.drizzle, snapshotId);
        if (!snapshot || snapshot.buyerId !== ctx.userId)
          return errorResponse("This checkout belongs to another account");
        if (order.purchase_units?.length !== 1 || !unitMatchesSnapshot(unit, snapshot))
          return errorResponse("Payment does not match this checkout.");
        const capture = unit?.payments?.captures?.[0];
        if (isDeclinedStoreCapture(capture?.status)) {
          if (snapshot.captureAttemptId)
            await releaseDeclinedStoreCapture(
              ctx.drizzle,
              snapshotId,
              ctx.userId,
              snapshot.captureAttemptId,
            );
          return errorResponse(PAYPAL_DECLINED_MESSAGE);
        }
        if (unit?.payments?.captures?.length !== 1 || capture?.status !== "COMPLETED")
          return errorResponse(
            "Payment is not completed yet. Retry using Lookup Transaction after it clears.",
          );
        return deliverStoreCapture(
          ctx.drizzle,
          snapshotId,
          input.orderId,
          order,
          capture,
        );
      }
      return deliverPaypalOrder(ctx.drizzle, order, ctx.userId, input.orderId);
    }),
  resolveTransaction: protectedProcedure
    .input(searchPaypalTransactionSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch potential transactions from paypal
      const token = await getPaypalAccessToken();
      const transactions = await getPaypalTransactions(
        input.transactionDate,
        token,
        input.transactionId,
      );
      const result = await syncTransactions(ctx.drizzle, transactions, token);
      return {
        success: result.length > 0 && result.every((entry) => entry.success),
        message: result.length
          ? result.map((entry) => entry.message).join(", ")
          : "No completed PayPal transaction was found for that ID and date. Check the details and try again.",
      };
    }),
  resolveSubscription: protectedProcedure
    .input(
      z.strictObject({
        subscriptionId: z.string().min(1).max(191),
        orderId: z.string().min(1).max(191).optional(),
      }),
    )
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const token = await getPaypalAccessToken();
      const subscription = await getPaypalSubscription(input.subscriptionId, token);
      return reconcilePaypalSubscription({
        client: ctx.drizzle,
        subscription,
        subscriptionId: input.subscriptionId,
        orderId: input.orderId,
        callerId: ctx.userId,
      });
    }),
  // Includes reservations from both web payment providers.
  getRecentRepsCount: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(({ ctx, input }) => reputationAllowanceUsed(ctx.drizzle, input.userId)),
  // Get all paypal transactions by this user
  getPaypalTransactions: protectedProcedure
    .input(
      z.object({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(100),
        userId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { skip, cursorAfter } = offsetPage(input);
      // Defaulting to the session means a self-view can never send a stale user id
      const targetUserId = input.userId ?? ctx.userId;
      const [user, transactions] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        listPaypalTransactionForGetPaypalTransactions(
          ctx.drizzle,
          skip,
          input,
          targetUserId,
        ),
      ]);
      if (!canSeeSecretData(user.role) && ctx.userId !== targetUserId) {
        throw serverError("UNAUTHORIZED", "You are not allowed to see this data");
      }
      const nextCursor = cursorAfter(transactions);
      return {
        data: transactions,
        nextCursor: nextCursor,
      };
    }),
  // Get all paypal subscriptions by this user
  getPaypalSubscriptions: protectedProcedure.query(async ({ ctx }) => {
    return await listPaypalSubscriptionForGetPaypalSubscriptions(ctx.drizzle, ctx);
  }),
  // Buy subscription with reputation points
  subscribeWithReps: protectedProcedure
    .input(
      z.strictObject({
        userId: z.string().min(1).max(191),
        expectedUserId: z.string().min(1).max(191),
        status: z.enum(FederalStatuses),
      }),
    )
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.expectedUserId !== ctx.userId)
        return errorResponse("Your account changed. Reload before purchasing.");
      if (input.status === "NONE")
        return errorResponse("Choose a federal support tier.");
      const cost = fedStatusRepsCost(input.status);
      const changed = new Error(
        "Your balance or recipient's subscription changed. Reload and try again.",
      );
      // A successful purchase creates a new subscription ledger row as well as debiting
      // the buyer and claiming the recipient. A guarded UPDATE cannot insert that ledger;
      // all three writes must roll back if the balance or recipient guard loses.
      try {
        await retryOnDeadlock(() =>
          ctx.drizzle.transaction(async (tx) => {
            const debited = await updateUserDataForSubscribeWithReps(tx, cost, ctx);
            if (debited.rowsAffected !== 1) throw changed;
            const claimed = await updateUserDataForSubscribeWithReps2(tx, input);
            if (claimed.rowsAffected !== 1) throw changed;
            await insertPaypalSubscriptionForSubscribeWithReps(tx, ctx, input);
          }),
        );
      } catch (error) {
        if (error === changed) return errorResponse(changed.message);
        throw error;
      }

      return {
        success: true,
        message: "OK",
        ...getSubscribeWithRepsUserUpdate({
          cost,
          inputUserId: input.userId,
          ctxUserId: ctx.userId,
          inputStatus: input.status,
        }),
      };
    }),
  // Upgrade a subscription for a user. Can only be done by the user who created the subscription
  upgradeSubscription: protectedProcedure
    .input(
      z.strictObject({
        userId: z.string().min(1).max(191),
        plan: z.enum(FederalStatuses),
      }),
    )
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Self only, which is all the UI ever offers. Without it the caller can name any
      // subscriber: the upgrade price is the delta between their tier and the new one, so
      // buying GOLD against someone else's SILVER costs the difference instead of the full
      // price, and it rewrites that player's subscription row to a plan they are not being
      // billed for -- which the hourly reconcile then reads as a tier they own.
      if (input.userId !== ctx.userId) {
        return errorResponse("You can only upgrade your own subscription");
      }
      const purchaseInputs = await fetchPurchaseUserCacheInputs(
        ctx.drizzle,
        ctx.userId,
      );
      const target = purchaseInputs[0];
      if (!target) return errorResponse("Complete registration before upgrading.");
      const subscription = await findPaypalSubscriptionForUpgradeSubscription(
        ctx.drizzle,
        target,
        ctx,
      );
      // If we could not find in paypal
      if (!subscription)
        return await upgradeStripeFederalWithReps(
          ctx.drizzle,
          ctx.userId,
          target.federalStatus,
          input.plan,
          purchaseInputs,
        );
      // Get cost, and ensure that we are actually upgrading
      const cost = calcFedUgradeCost(subscription.federalStatus, input.plan);
      if (!cost || cost < 0) {
        return errorResponse(`Invalid: ${subscription.federalStatus} to ${input.plan}`);
      }
      // Check that we have enough reputation points
      if (target.reputationPoints < cost) {
        return errorResponse(`Not enough reputation points`);
      }
      // The balance, displayed tier, and paid ledger must advance together. A single
      // guarded joined update prevents duplicate upgrades and stale-plan debits.
      const result = await retryOnDeadlock(() =>
        executeResultForUpgradeSubscription(
          ctx.drizzle,
          input,
          cost,
          ctx,
          target,
          subscription,
        ),
      );
      if (result.rowsAffected === 0)
        return errorResponse(
          "Your balance or subscription changed. Reload and try again.",
        );

      return {
        success: true,
        message: "OK",
        ...getKnownPurchaseUserUpdate(
          purchaseInputs,
          { federalStatus: input.plan },
          {
            reputationPoints: -cost,
            reputationPointsTotal: -cost,
          },
        ),
      };
    }),
  // Cancel paypal subscription
  cancelPaypalSubscription: protectedProcedure
    .input(z.strictObject({ subscriptionId: z.string().min(1).max(191) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const stored = await findPaypalSubscriptionForCancelPaypalSubscription(
        ctx.drizzle,
        input,
      );
      if (!stored)
        return errorResponse("Subscription was not found. Refresh your subscriptions.");
      if (stored.createdById !== ctx.userId && stored.affectedUserId !== ctx.userId)
        return errorResponse("This subscription belongs to another account.");
      // Reputation purchases have no external renewal. The 21-character IDs are the
      // former nanoid format; provider billing IDs are never generated this way.
      if (
        !stored.orderId &&
        (/^reps_[A-Za-z0-9_-]{21}$/.test(stored.subscriptionId) ||
          (/^[A-Za-z0-9_-]{21}$/.test(stored.subscriptionId) &&
            !stored.subscriptionId.startsWith("I-")))
      ) {
        await updatePaypalSubscriptionForCancelPaypalSubscription(ctx.drizzle, stored);
        return {
          success: true,
          message:
            "Reputation-funded support ends after its paid period; it does not renew.",
        };
      }
      const token = await getPaypalAccessToken();
      const subscription = await getPaypalSubscription(input.subscriptionId, token);
      const owners = parsePaypalSubscriptionOwners(subscription?.custom_id);
      if (
        !subscription ||
        subscription.id !== input.subscriptionId ||
        !owners ||
        !subscription.status
      )
        return errorResponse(
          "PayPal could not verify this subscription. Try again before assuming future payments have stopped.",
        );
      const [buyer, recipient, expectedBuyer, expectedRecipient] = await Promise.all([
        canonicalStoreUserId(ctx.drizzle, owners.buyer),
        canonicalStoreUserId(ctx.drizzle, owners.recipient),
        canonicalStoreUserId(ctx.drizzle, stored.createdById),
        canonicalStoreUserId(ctx.drizzle, stored.affectedUserId),
      ]);
      if (buyer !== expectedBuyer || recipient !== expectedRecipient)
        return errorResponse(
          "PayPal subscription ownership does not match this account. Contact support.",
        );
      const status = ["CANCELLED", "EXPIRED"].includes(subscription.status)
        ? 204
        : await cancelPaypalSubscription(input.subscriptionId, token);
      if (status !== 204)
        return errorResponse(
          "PayPal did not confirm cancellation. Try again or manage the subscription in PayPal.",
        );
      await updatePaypalSubscriptionForCancelPaypalSubscription(ctx.drizzle, stored);
      // Cancellation is allowed even when billing terms need support review. Only verified
      // paid data can refresh coverage; stopping future charges does not fabricate a period.
      await reconcilePaypalSubscription({
        client: ctx.drizzle,
        subscription: { ...subscription, status: "CANCELLED" },
        subscriptionId: input.subscriptionId,
        orderId: stored.orderId,
        expected: {
          createdById: stored.createdById,
          affectedUserId: stored.affectedUserId,
        },
      });
      return { success: true, message: "Future PayPal subscription payments stopped" };
    }),
});

/** Validate the offer and reserve allowance before contacting the payment provider. */
const prepareWebCheckout = async (
  ctx: { drizzle: DrizzleClient; userId: string; userAgent?: string | null },
  input: z.infer<typeof storeCheckoutSchema>,
) => {
  if (isNativeUserAgent(ctx.userAgent))
    return errorResponse("Use the in-app store to make purchases");
  const [recipient, bundle, items, aliases] = await Promise.all([
    findUserById(ctx.drizzle, input.recipientId),
    input.selection.type === "bundle"
      ? findWebStoreBundleById(ctx.drizzle, input.selection.bundleId)
      : undefined,
    listItemForPrepareWebCheckout(ctx.drizzle),
    listCheckoutUserIdAliases(ctx.drizzle, ctx.userId, input.recipientId),
  ]);
  if (aliases.some((alias) => isDeletedStoreUserId(alias.newUserId)))
    return errorResponse(
      "This account is being deleted and cannot make or receive purchases",
    );
  if (!recipient || recipient.isAi || recipient.isBanned)
    return errorResponse("Choose an active player to receive this purchase");
  if (input.selection.type === "bundle" && !bundle?.isActive)
    return errorResponse("This bundle is no longer available");
  const offer =
    input.selection.type === "custom"
      ? {
          name: `${input.selection.reputationPoints} reputation points`,
          priceCents: Math.round(reps2dollars(input.selection.reputationPoints) * 100),
          contents: {
            reputationPoints: input.selection.reputationPoints,
            money: 0,
            items: [],
          },
        }
      : bundle;
  if (!offer) return errorResponse("Bundle no longer exists");
  if (offer.contents.items.some((reward) => !items.some((i) => i.id === reward.id)))
    return errorResponse("This bundle contains an unavailable item. Contact staff.");
  // Recheck published offers against current item prices and the direct-purchase rate.
  if (offer.priceCents < getStoreBundleMinimumPriceCents(offer.contents, items))
    return errorResponse("This bundle's price needs updating. Contact staff.");
  return reserveStoreOrder(ctx.drizzle, ctx.userId, recipient.userId, {
    ...offer,
    bundleId: input.selection.type === "bundle" ? input.selection.bundleId : undefined,
  });
};

/** Whether an order's purchase unit carries the snapshot's invoice, currency and price. */
const unitMatchesSnapshot = (
  unit: PaypalPurchaseUnit | undefined,
  snapshot: { id: string; priceCents: number },
) =>
  storePaymentMatches(snapshot, {
    currency: unit?.amount?.currency_code,
    value: unit?.amount?.value,
    invoiceId: unit?.invoice_id,
  });

/** Deliver a completed capture of a snapshot-backed order. */
const deliverStoreCapture = (
  client: DrizzleClient,
  snapshotId: string,
  orderId: string,
  order: PaypalOrder,
  capture: StoreCapture,
) =>
  deliverStoreOrder(client, {
    snapshotId,
    captureId: capture.id,
    orderId,
    currency: capture.amount.currency_code ?? "",
    value: capture.amount.value ?? "",
    invoiceId: capture.invoice_id ?? order?.purchase_units?.[0]?.invoice_id,
    raw: order,
  });

/** Classify terminal capture failures independently of the provider order's overall status. */
const isDeclinedStoreCapture = (status?: string) =>
  status === "DECLINED" || status === "DENIED" || status === "FAILED";

type PaypalPurchaseUnit = NonNullable<
  NonNullable<PaypalOrder>["purchase_units"]
>[number];
type StoreCapture = NonNullable<
  NonNullable<PaypalPurchaseUnit["payments"]>["captures"]
>[number];
