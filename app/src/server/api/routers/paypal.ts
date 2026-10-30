import { nanoid } from "nanoid";
import { z } from "zod";
import {
  FEDERAL_MONTHLY_USD_CENTS,
  FederalStatuses,
  type TransactionType,
} from "@/drizzle/constants";

import type { FederalStatus } from "@/drizzle/schema";
import { isNativeUserAgent } from "@/libs/native/userAgent";
import {
  executeResultForUpgradeSubscription,
  findPaypalSubscriptionForCancelPaypalSubscription,
  findPaypalSubscriptionForUpgradeSubscription,
  findPaypalTransactionForDeliverPaypalReputation,
  findPaypalTransactionForSyncTransactions,
  findWebStoreBundleById,
  findWebStoreOrderById,
  insertActionLogForSaveStoreBundle,
  insertPaypalSubscriptionForSubscribeWithReps,
  insertPaypalSubscriptionForUpdateSubscription,
  insertPaypalTransactionForDeliverPaypalReputation,
  insertPaypalTransactionForUpdateReps,
  insertRecruitmentRewardsForUpdateReps,
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
  updatePaypalSubscriptionForUpdateSubscription,
  updatePaypalTransactionForDeliverPaypalReputation,
  updateUserDataForSubscribeWithReps,
  updateUserDataForSubscribeWithReps2,
  updateUserDataForUpdateReps,
  updateWebStoreBundleForSaveStoreBundle,
  updateWebStoreOrderForCreateStoreOrder,
} from "@/queries/paypal";
import { fetchUser, findUserById } from "@/queries/profile";
import {
  type BaseServerResponse,
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import {
  lockPurchaseBuyer,
  reputationAllowanceUsed,
} from "@/server/utils/purchases/allowance";
import {
  fetchPurchaseUserCacheInputs,
  getKnownPurchaseUserUpdate,
} from "@/server/utils/purchases/cache";
import {
  canonicalStoreUserId,
  isDeletedStoreUserId,
  setFederalStatusWithStoreFloor,
} from "@/server/utils/purchases/grant";
import { logError } from "@/server/utils/sentry";
import { upgradeStripeFederalWithReps } from "@/server/utils/stripe/fulfillment";
import {
  authorizeStoreCapture,
  deliverStoreOrder,
  readStoreCustomId,
  reserveStoreOrder,
} from "@/server/utils/webStore";
import {
  calcFedUgradeCost,
  dollars2reps,
  dynamicMonthlyRepCap,
  fedStatusRepsCost,
  getStoreBundleMinimumPriceCents,
  plan2FedStatus,
  reps2dollars,
} from "@/utils/paypal";
import { canManageStore, canSeeSecretData } from "@/utils/permissions";
import { addDays, secondsFromNow } from "@/utils/time";
import type { JsonData } from "@/utils/typeutils";
import {
  searchPaypalTransactionSchema,
  storeBundleSchema,
  storeBundleSchemaForItems,
  storeCheckoutSchema,
} from "@/validators/points";
import { userDeltaResponseSchema } from "@/validators/userCache";
import type { DrizzleClient } from "../../db";

type PaypalAmount = {
  currency_code?: string;
  value?: string;
};

type PaypalOrder =
  | {
      id?: string;
      status?: string;
      purchase_units?: {
        amount?: PaypalAmount;
        invoice_id?: string;
        custom_id?: string;
        payments?: {
          captures?: {
            id: string;
            status: string;
            amount: PaypalAmount;
            invoice_id: string;
            update_time: string;
          }[];
        };
      }[];
    }
  | undefined;

type PaypalSubscription = {
  id: string;
  custom_id: string;
  plan_id: string;
  status: string;
  billing_info: {
    last_payment: {
      amount: PaypalAmount;
      time: string;
    };
  };
};

type PaypalTransaction = {
  transaction_info: {
    transaction_id: string;
    transaction_initiation_date: string;
    transaction_updated_date: string;
    paypal_reference_id: string;
    paypal_reference_id_type: "ODR" | "TXN" | "SUB" | "PAP";
    transaction_event_code: string;
    transaction_subject: string;
    transaction_amount: PaypalAmount;
    transaction_status: "D" | "P" | "S" | "V";
    custom_field: string;
    invoice_id: string;
  };
  cart_info: {
    item_details: {
      total_item_amount: PaypalAmount;
    }[];
  };
};

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
      const [token, purchaseInputs] = await Promise.all([
        getPaypalAccessToken(),
        fetchPurchaseUserCacheInputs(ctx.drizzle, ctx.userId).catch(() => undefined),
      ]);
      let order = await getPaypalOrder({ orderId: input.orderId, token });
      const snapshotId = readStoreCustomId(order?.purchase_units?.[0]?.custom_id);
      if (!snapshotId) return errorResponse("Checkout not found");
      const snapshot = await findWebStoreOrderById(ctx.drizzle, snapshotId);
      if (!snapshot || snapshot.buyerId !== ctx.userId)
        return errorResponse("This checkout belongs to another account");
      const unit = order?.purchase_units?.[0];
      if (
        order?.purchase_units?.length !== 1 ||
        unit?.invoice_id !== snapshot.id ||
        unit.amount?.currency_code !== "USD" ||
        !unit.amount.value ||
        !/^\d+(?:\.\d{1,2})?$/.test(unit.amount.value) ||
        Math.round(Number(unit.amount.value) * 100) !== snapshot.priceCents
      )
        return errorResponse(
          "Payment does not match this checkout. No payment was captured.",
        );
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
        if (order?.status !== "APPROVED")
          return errorResponse(
            "Approve this checkout with PayPal before capturing payment. No payment was captured.",
          );
        captureAttemptId = nanoid();
        const allowanceError = await authorizeStoreCapture(
          ctx.drizzle,
          snapshotId,
          ctx.userId,
          captureAttemptId,
        );
        if (allowanceError) return errorResponse(allowanceError);
        order = await requestStorePaypalOrder(
          token,
          `/v2/checkout/orders/${input.orderId}/capture`,
          `capture:${snapshotId}`,
          {},
          releaseDeclinedCapture,
        );
        if (!order)
          return errorResponse(
            "PayPal declined the payment. No payment was captured. Start a new checkout with another payment method.",
          );
      }
      // Some provider responses are minimal; fetch the completed representation before delivery.
      if (!order?.purchase_units?.[0]?.payments?.captures?.length)
        order = await getPaypalOrder({ orderId: input.orderId, token });
      const capture = order?.purchase_units?.[0]?.payments?.captures?.[0];
      if (isDeclinedStoreCapture(capture?.status)) {
        await releaseDeclinedCapture();
        return errorResponse(
          "PayPal declined the payment. No payment was captured. Start a new checkout with another payment method.",
        );
      }
      if (capture?.status !== "COMPLETED")
        return errorResponse(
          "Payment is awaiting confirmation. Use Lookup Transaction after it clears.",
        );
      const result = await deliverStoreOrder(ctx.drizzle, {
        snapshotId,
        captureId: capture.id,
        orderId: input.orderId,
        currency: capture.amount.currency_code ?? "",
        value: capture.amount.value ?? "",
        invoiceId: capture.invoice_id ?? order?.purchase_units?.[0]?.invoice_id,
        raw: order,
      });
      const { delivery, ...response } = result;
      return {
        ...response,
        ...(delivery &&
        (delivery.recipientId !== ctx.userId || !delivery.contents.items.length)
          ? getKnownPurchaseUserUpdate(
              purchaseInputs,
              {},
              delivery.recipientId === ctx.userId
                ? {
                    money: delivery.contents.money,
                    reputationPoints: delivery.contents.reputationPoints,
                    reputationPointsTotal: delivery.contents.reputationPoints,
                  }
                : {},
            )
          : {}),
      };
    }),

  resolveOrder: protectedProcedure
    .input(z.strictObject({ orderId: z.string().min(15).max(20) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      if (isNativeUserAgent(ctx.userAgent))
        return errorResponse("Use the in-app store to purchase in the native app.");
      const token = await getPaypalAccessToken();
      const order = await getPaypalOrder({ orderId: input.orderId, token: token });
      // Guarding
      if (order === undefined) {
        throw serverError("INTERNAL_SERVER_ERROR", "Could not fetch order");
      }
      const unit = order.purchase_units?.[0];
      const snapshotId = readStoreCustomId(unit?.custom_id);
      if (snapshotId) {
        const capture = unit?.payments?.captures?.[0];
        if (isDeclinedStoreCapture(capture?.status)) {
          const snapshot = await findWebStoreOrderById(ctx.drizzle, snapshotId);
          if (
            snapshot?.buyerId === ctx.userId &&
            snapshot.captureAttemptId &&
            order.purchase_units?.length === 1 &&
            unit?.invoice_id === snapshot.id &&
            unit.amount?.currency_code === "USD" &&
            unit.amount.value &&
            /^\d+(?:\.\d{1,2})?$/.test(unit.amount.value) &&
            Math.round(Number(unit.amount.value) * 100) === snapshot.priceCents
          ) {
            await releaseDeclinedStoreCapture(
              ctx.drizzle,
              snapshotId,
              ctx.userId,
              snapshot.captureAttemptId,
            );
          }
          return errorResponse(
            "PayPal declined the payment. No payment was captured. Start a new checkout with another payment method.",
          );
        }
        if (capture?.status !== "COMPLETED")
          return errorResponse(
            "Payment is not completed yet. Retry using Lookup Transaction after it clears.",
          );
        return deliverStoreOrder(ctx.drizzle, {
          snapshotId,
          captureId: capture.id,
          orderId: input.orderId,
          currency: capture.amount.currency_code ?? "",
          value: capture.amount.value ?? "",
          invoiceId: capture.invoice_id ?? unit?.invoice_id,
          raw: order,
        });
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
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const token = await getPaypalAccessToken();
      const subscription = await getPaypalSubscription(input.subscriptionId, token);
      const result = await reconcilePaypalSubscription({
        client: ctx.drizzle,
        subscription,
        subscriptionId: input.subscriptionId,
        orderId: input.orderId,
        callerId: ctx.userId,
      });
      return result;
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
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;
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
      const nextCursor = transactions.length < input.limit ? null : currentCursor + 1;
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
        userDelta: { reputationPoints: -cost },
        userPatch: input.userId === ctx.userId ? { federalStatus: input.status } : {},
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

/** CAS the verified paid period, then rebuild its recoverable cross-provider entitlement. */
export const updateSubscription = async (input: {
  client: DrizzleClient;
  createdById: string;
  orderId?: string;
  affectedUserId: string;
  subscriptionId: string;
  federalStatus: FederalStatus;
  status: string;
  lastPayment?: Date;
}) => {
  return retryOnDeadlock(async () => {
    const current = await findPaypalSubscriptionForCancelPaypalSubscription(
      input.client,
      input,
    );
    if (
      current &&
      (current.createdById !== input.createdById ||
        current.affectedUserId !== input.affectedUserId)
    )
      return errorResponse("Subscription ownership changed. Retry recovery.");
    // Preserve the saved window of a reputation-funded upgrade. Otherwise, a newer
    // confirmed payment advances the paid marker without inventing another billing date.
    const retainsPeriod =
      current &&
      current.updatedAt > secondsFromNow(-3600 * 24 * 31) &&
      (!input.lastPayment ||
        input.lastPayment <= current.updatedAt ||
        FederalStatuses.indexOf(current.federalStatus) >
          FederalStatuses.indexOf(input.federalStatus));
    const tier = retainsPeriod ? current.federalStatus : input.federalStatus;
    const paidAt = retainsPeriod
      ? current.updatedAt
      : (input.lastPayment ?? new Date());
    const approvalReference = current?.orderId ?? input.orderId;
    if (
      retainsPeriod &&
      current.federalStatus === "NONE" &&
      input.federalStatus !== "NONE"
    )
      return errorResponse(
        "This paid period requires support review before coverage can be restored.",
      );
    const synchronized =
      current &&
      current.status === input.status &&
      current.federalStatus === tier &&
      current.updatedAt.getTime() === paidAt.getTime() &&
      current.orderId === (approvalReference ?? null);
    if (current && !synchronized) {
      const claimed = await updatePaypalSubscriptionForUpdateSubscription(
        input.client,
        input,
        tier,
        paidAt,
        approvalReference,
        current,
      );
      if (claimed.rowsAffected !== 1)
        return errorResponse("Subscription changed. Retry recovery.");
    } else if (!current) {
      try {
        await insertPaypalSubscriptionForUpdateSubscription(
          input.client,
          input,
          tier,
          paidAt,
        );
      } catch (error) {
        if (isMysqlDuplicateKeyError(error))
          return errorResponse("Subscription changed. Retry recovery.");
        throw error;
      }
    }
    // The subscription is authoritative; federalStatus is a rebuildable projection,
    // like Stripe's post-claim reconciliation. Retrying must repair it even when the
    // paid-period CAS already committed, so no transaction spans these two writes.
    await setFederalStatusWithStoreFloor(input.client, input.affectedUserId, tier);
    return { success: true, message: "Subscription synchronized" };
  });
};

/**
 * Updates reputation points for a user
 */
export const updateReps = async (input: {
  client: DrizzleClient;
  createdById: string;
  transactionId: string;
  transactionUpdatedDate: string;
  orderId?: string;
  affectedUserId: string;
  invoiceId?: string | null;
  value: number;
  currency: string;
  status: string;
  reps: number;
  type: TransactionType;
  raw: JsonData;
}) => {
  if (input.type === "REP_PURCHASE") return deliverPaypalReputation(input);
  // First see if we can insert transaction.
  await insertPaypalTransactionForUpdateReps(input.client, {
    createdById: input.createdById,
    transactionId: input.transactionId,
    transactionUpdatedDate: input.transactionUpdatedDate,
    orderId: input.orderId,
    affectedUserId: input.affectedUserId,
    invoiceId: input.invoiceId,
    value: input.value,
    reps: input.reps,
    currency: input.currency,
    status: input.status,
    type: input.type,
    raw: input.raw,
  });
  if (input.type === "REFERRAL") {
    await insertRecruitmentRewardsForUpdateReps(input.client, input);
  }
  // If we succeed, that means the transaction was not already in the database.
  // We can then update the user
  return await updateUserDataForUpdateReps(input.client, input);
};

/**
 * Fetch a subscrioption from paypal
 */
export const getPaypalTransactions = async (
  transactionDate: Date,
  token: string,
  transactionId?: string,
) => {
  // Current date in 2014-07-12T00:00:00-0700 format
  const startDate = addDays(transactionDate, -14);
  const endDate = addDays(transactionDate, 14);
  let path = `${process.env.NEXT_PUBLIC_PAYPAL_URL}/v1/reporting/transactions?start_date=${startDate.toISOString()}&end_date=${endDate.toISOString()}`;
  if (transactionId) {
    path = `${path}&transaction_id=${transactionId}`;
  }
  return await fetch(`${path}&fields=all`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })
    .then((response) => {
      return response.json();
    })
    .then((data: { transaction_details?: PaypalTransaction[] }) => {
      return data.transaction_details ?? [];
    });
};

/**
 * Sync PayPal subscriptions and purchases, returning each completed payment's outcome.
 */
export const syncTransactions = async (
  client: DrizzleClient,
  transactions: PaypalTransaction[],
  token: string,
): Promise<BaseServerResponse[]> => {
  const notifications = await Promise.all(
    transactions
      .filter((t) => t?.transaction_info?.transaction_status === "S")
      .map(async (t) => {
        // Derived
        const info = t.transaction_info;
        const snapshotId = readStoreCustomId(info.custom_field);
        if (snapshotId) {
          // Successful reporting events also include refunds and reversals.
          if (parseFloat(info.transaction_amount.value ?? "") < 0) {
            return errorResponse(`Transaction ID ${info.transaction_id} invalid value`);
          }
          try {
            return await deliverStoreOrder(client, {
              snapshotId,
              captureId: info.transaction_id,
              orderId: info.paypal_reference_id,
              currency: info.transaction_amount.currency_code ?? "",
              value: info.transaction_amount.value ?? "",
              invoiceId: info.invoice_id,
              raw: t,
            });
          } catch (error) {
            // A blocked delivery must not stop other payments or the hourly referral pass.
            const known =
              error instanceof Error &&
              [
                "Checkout snapshot not found. Contact support with your payment receipt.",
                "Payment does not match this checkout. Contact support with your payment receipt.",
                "A purchased item is unavailable. Contact support; your payment can be retried.",
                "Recipient unavailable. Contact support with your payment receipt.",
              ].includes(error.message);
            if (!known) {
              logError(error, "Store delivery failed", {
                transactionId: info.transaction_id,
              });
            }
            return errorResponse(
              `Transaction ID ${info.transaction_id}: ${known ? error.message : "Store delivery failed. Retry later or contact support."}`,
            );
          }
        }
        const createdByUserId =
          typeof info.custom_field === "string"
            ? info.custom_field.split("-")[0]
            : undefined;
        const affectedUserId =
          typeof info.custom_field === "string"
            ? info.custom_field.split("-")[1]
            : undefined;
        const value = info.transaction_amount?.value;
        const currency = info.transaction_amount?.currency_code;
        // If data could not be parsed
        if (
          typeof value !== "string" ||
          !value ||
          typeof currency !== "string" ||
          !currency ||
          !createdByUserId ||
          !affectedUserId ||
          typeof info.transaction_id !== "string" ||
          !info.transaction_id ||
          typeof info.transaction_updated_date !== "string" ||
          !Number.isFinite(new Date(info.transaction_updated_date).getTime())
        ) {
          return errorResponse(
            `Transaction ID ${info.transaction_id} has invalid payment data`,
          );
        }
        // Handle different cases
        if (
          info.paypal_reference_id_type === "SUB" ||
          info.transaction_event_code === "T0002"
        ) {
          // Fetch from internal & paypal
          const externalSubscription = await getPaypalSubscription(
            info.paypal_reference_id,
            token,
          );
          return reconcilePaypalSubscription({
            client,
            subscription: externalSubscription,
            subscriptionId: info.paypal_reference_id,
            expected: { createdById: createdByUserId, affectedUserId },
          });
        } else {
          const stored = await findPaypalTransactionForSyncTransactions(client, info);
          const parsedValue = Number(value);
          if (stored?.status === "REVIEW_REQUIRED")
            return errorResponse(
              "Payment requires manual support review or refund; no points were delivered.",
            );
          if (
            stored?.orderId &&
            ["RESERVED", "CAPTURING", "DELIVERY_PENDING"].includes(stored.status)
          ) {
            const order = await getPaypalOrder({ orderId: stored.orderId, token });
            const buyerId = await canonicalStoreUserId(client, createdByUserId);
            return deliverPaypalOrder(client, order, buyerId, stored.orderId);
          }
          if (!Number.isFinite(parsedValue) || parsedValue < 1 || currency !== "USD") {
            return errorResponse(`Transaction ID ${info.transaction_id} invalid value`);
          } else if (
            stored &&
            !["RESERVED", "CAPTURING", "DELIVERY_PENDING", "REVIEW_REQUIRED"].includes(
              stored.status,
            )
          ) {
            return {
              success: true,
              message: `Transaction ID ${info.transaction_id} already processed`,
            };
          } else {
            const result = await updateReps({
              client: client,
              createdById: createdByUserId,
              transactionId: info.transaction_id,
              transactionUpdatedDate: info.transaction_updated_date,
              orderId: stored?.orderId ?? undefined,
              affectedUserId: affectedUserId,
              invoiceId: info.invoice_id,
              value: parsedValue,
              currency: currency,
              status: "COMPLETED",
              reps: dollars2reps(parsedValue),
              type: "REP_PURCHASE",
              raw: t,
            });
            return result && "success" in result && !result.success
              ? result
              : {
                  success: true,
                  message: `Transaction ID ${info.transaction_id} synced!`,
                };
          }
        }
      }),
  );
  return notifications;
};

/**
 * Get updated paypal subscription status, accounting for last payment time
 */
export const getPaypalSubscriptionStatus = (
  subscription: PaypalSubscription,
): { newStatus: FederalStatus; lastPayment: Date } => {
  const lastPayment = new Date(subscription.billing_info.last_payment.time);
  const fedStatus = plan2FedStatus(subscription.plan_id);
  const stillActive = lastPayment > secondsFromNow(-3600 * 24 * 31);
  const newStatus = stillActive ? fedStatus : "NONE";
  return { newStatus, lastPayment };
};

/**
 * Fetch a subscrioption from paypal
 * @param subscriptionId - The subscription ID to fetch
 * @param token - The access token to use
 * @returns The subscription data
 */
export const getPaypalSubscription = async (subscriptionId: string, token: string) => {
  return await fetch(
    `${process.env.NEXT_PUBLIC_PAYPAL_URL}/v1/billing/subscriptions/${subscriptionId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  )
    .then((response) => {
      if (response.status === 404) return undefined;
      // An outage is not proof that paid support ended; leave reconciliation retryable.
      if (!response.ok)
        throw new Error(`PayPal subscription lookup failed (${response.status})`);
      return response.json();
    })
    .then((data: PaypalSubscription | undefined) => {
      return data;
    });
};

/**
 * Cancel a subscrioption from paypal
 */
export const cancelPaypalSubscription = async (
  subscriptionId: string,
  token: string,
) => {
  return await fetch(
    `${process.env.NEXT_PUBLIC_PAYPAL_URL}/v1/billing/subscriptions/${subscriptionId}/cancel`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: "Cancelled through the game" }),
    },
  ).then((response) => response.status);
};

/**
 * Fetch an access token from paypal
 */
export const getPaypalAccessToken = async () => {
  return await fetch(`${process.env.NEXT_PUBLIC_PAYPAL_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
    }),
  })
    .then((response) => response.json())
    .then((data: { access_token: string }) => {
      return data.access_token;
    });
};

/**
 * Fetch a paypal order
 */
export const getPaypalOrder = async (input: { orderId: string; token: string }) => {
  const order = await fetch(
    `${process.env.NEXT_PUBLIC_PAYPAL_URL}/v2/checkout/orders/${input.orderId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
    },
  )
    .then((response) => {
      return response.ok ? response.json() : undefined;
    })
    .then((data: PaypalOrder) => {
      return data;
    });
  return order;
};

/** Verify one authoritative legacy capture before entering shared receipt delivery. */
const deliverPaypalOrder = async (
  client: DrizzleClient,
  order: PaypalOrder,
  buyerId: string,
  orderId: string,
) => {
  const unit = order?.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  const [createdById, affectedUserId] = unit?.custom_id?.split("-") ?? [];
  const value = Number(capture?.amount.value);
  if (
    order?.id !== orderId ||
    order.status !== "COMPLETED" ||
    order.purchase_units?.length !== 1 ||
    unit?.payments?.captures?.length !== 1 ||
    capture?.status !== "COMPLETED" ||
    capture.amount.currency_code !== "USD" ||
    !Number.isFinite(value) ||
    value < 1 ||
    !createdById ||
    !affectedUserId
  )
    return errorResponse(
      "Payment has not been verified. Check your purchase history before trying again.",
    );
  const canonicalBuyer = await canonicalStoreUserId(client, createdById);
  if (canonicalBuyer !== buyerId)
    return errorResponse("This payment belongs to another account.");
  return deliverPaypalReputation({
    client,
    createdById,
    affectedUserId,
    orderId,
    transactionId: capture.id,
    transactionUpdatedDate: capture.update_time,
    invoiceId: capture.invoice_id ?? unit.invoice_id,
    value,
    currency: "USD",
    status: "COMPLETED",
    reps: dollars2reps(value),
    type: "REP_PURCHASE",
    raw: order,
  });
};

/** Verify legacy terms and serialize allowance, receipt conversion and credit for safe replay. */
const deliverPaypalReputation = async (input: Parameters<typeof updateReps>[0]) => {
  const [createdById, affectedUserId] = await Promise.all([
    canonicalStoreUserId(input.client, input.createdById),
    canonicalStoreUserId(input.client, input.affectedUserId),
  ]);
  input = { ...input, createdById, affectedUserId };
  // The allowance SUM must follow the buyer lock, as it does for store reservations.
  // Legacy imports can also require an INSERT: a joined credit UPDATE alone cannot
  // atomically create the receipt or protect the cross-provider aggregate.
  return retryOnDeadlock(() =>
    input.client.transaction(async (tx) => {
      const buyer = await lockPurchaseBuyer(tx, input.createdById);
      if (!buyer)
        return errorResponse(
          "Payment requires support review: buyer account was not found.",
        );
      const stored = await findPaypalTransactionForDeliverPaypalReputation(tx, input);
      if (
        stored &&
        (stored.createdById !== input.createdById ||
          stored.affectedUserId !== input.affectedUserId ||
          stored.amount !== input.value ||
          stored.currency !== input.currency)
      )
        throw new Error("PayPal payment does not match receipt ownership or amount");
      if (
        stored &&
        ![
          "RESERVED",
          "CAPTURING",
          "DELIVERY_PENDING",
          "REVIEW_REQUIRED",
          "CANCELLED",
        ].includes(stored.status)
      )
        return { success: true, message: "Reputation points already delivered" };
      if (
        input.currency !== "USD" ||
        !Number.isFinite(input.value) ||
        input.value < 1 ||
        input.reps !== dollars2reps(input.value)
      )
        return errorResponse(
          "Payment requires support review: unexpected currency or amount.",
        );
      if (
        stored &&
        (stored.createdById !== input.createdById ||
          stored.affectedUserId !== input.affectedUserId ||
          stored.amount !== input.value ||
          stored.reputationPoints !== input.reps ||
          (stored.orderId && input.orderId && stored.orderId !== input.orderId))
      )
        throw new Error("PayPal payment does not match reserved terms");
      if (stored?.status === "REVIEW_REQUIRED")
        return errorResponse(
          "Payment requires manual support review or refund; no points were delivered.",
        );
      const id = stored?.id ?? `paypal_${input.transactionId}`;
      const terms = {
        createdById: input.createdById,
        affectedUserId: input.affectedUserId,
        transactionId: input.transactionId,
        transactionUpdatedDate: input.transactionUpdatedDate,
        orderId: input.orderId,
        invoiceId: input.invoiceId,
        amount: input.value,
        reputationPoints: input.reps,
        currency: input.currency,
        type: input.type,
        rawData: input.raw,
      };
      const allowed =
        (await reputationAllowanceUsed(tx, input.createdById, id)) + input.reps <=
        dynamicMonthlyRepCap(buyer);
      const status = allowed ? "COMPLETED" : "REVIEW_REQUIRED";
      if (stored)
        await updatePaypalTransactionForDeliverPaypalReputation(tx, terms, status, id);
      else
        await insertPaypalTransactionForDeliverPaypalReputation(tx, id, terms, status);
      // A previously captured legacy order may arrive after another provider reserved the
      // remaining allowance. Retain the payment for staff review; never silently over-grant.
      if (!allowed)
        return errorResponse(
          "Payment received but exceeds your monthly allowance. Contact support with your PayPal transaction ID for review or refund; no points were delivered.",
        );
      const granted = await updateUserDataForUpdateReps(tx, input);
      if (granted.rowsAffected !== 1)
        throw new Error("PayPal recipient not found; delivery will retry");
      return { success: true, message: "Reputation points purchased" };
    }),
  );
};

/** Only configured paid plans and consistent provider ownership can change coverage. */
const verifiedPaypalSubscription = async (
  client: DrizzleClient,
  subscription: PaypalSubscription | undefined,
  subscriptionId: string,
  expected?: { createdById: string; affectedUserId: string },
) => {
  if (
    !subscription ||
    subscription.id !== subscriptionId ||
    typeof subscription.plan_id !== "string" ||
    !subscription.plan_id ||
    plan2FedStatus(subscription.plan_id) === "NONE" ||
    typeof subscription.custom_id !== "string" ||
    !["ACTIVE", "SUSPENDED", "CANCELLED", "EXPIRED"].includes(subscription.status)
  )
    return null;
  const owners = parsePaypalSubscriptionOwners(subscription.custom_id);
  if (!owners) return null;
  const { buyer, recipient } = owners;
  const payment = subscription.billing_info?.last_payment;
  const lastPayment =
    typeof payment?.time === "string" ? new Date(payment.time) : new Date(Number.NaN);
  const amount = Number(payment?.amount?.value);
  const tier = plan2FedStatus(subscription.plan_id);
  if (tier === "NONE" || amount !== FEDERAL_MONTHLY_USD_CENTS[tier] / 100) return null;
  if (
    !Number.isFinite(lastPayment.getTime()) ||
    lastPayment > secondsFromNow(60) ||
    payment?.amount?.currency_code !== "USD" ||
    !Number.isFinite(amount) ||
    amount <= 0
  )
    return null;
  const [createdById, affectedUserId, expectedBuyer, expectedRecipient] =
    await Promise.all([
      canonicalStoreUserId(client, buyer),
      canonicalStoreUserId(client, recipient),
      expected
        ? canonicalStoreUserId(client, expected.createdById)
        : Promise.resolve(undefined),
      expected
        ? canonicalStoreUserId(client, expected.affectedUserId)
        : Promise.resolve(undefined),
    ]);
  if (
    expected &&
    (createdById !== expectedBuyer || affectedUserId !== expectedRecipient)
  )
    return null;
  return { createdById, affectedUserId, lastPayment };
};

/** All provider-driven subscription recovery uses the same ownership and paid-term checks. */
export const reconcilePaypalSubscription = async (input: {
  client: DrizzleClient;
  subscription: PaypalSubscription | undefined;
  subscriptionId: string;
  expected?: { createdById: string; affectedUserId: string };
  callerId?: string;
  orderId?: string | null;
}) => {
  const owners = await verifiedPaypalSubscription(
    input.client,
    input.subscription,
    input.subscriptionId,
    input.expected,
  );
  if (!owners || !input.subscription)
    return errorResponse(
      `Subscription ID ${input.subscriptionId} not found or ownership/payment could not be verified. Wait for payment to clear, then retry.`,
    );
  if (
    input.callerId &&
    input.callerId !== owners.createdById &&
    input.callerId !== owners.affectedUserId
  )
    return errorResponse("This subscription belongs to another account.");
  // PayPal's subscription approval/reporting APIs can omit an order ID. Retain its
  // provider reference so the renewal job does not classify paid billing as rep-funded.
  return updateSubscription({
    client: input.client,
    ...owners,
    subscriptionId: input.subscription.id,
    orderId: input.orderId ?? input.subscription.id,
    federalStatus: getPaypalSubscriptionStatus(input.subscription).newStatus,
    status: input.subscription.status,
  });
};

/** Decode the legacy buyer-recipient reference without accepting ambiguous identities. */
const parsePaypalSubscriptionOwners = (customId: unknown) => {
  if (typeof customId !== "string") return null;
  const users = customId.split("-");
  const buyer = users[0];
  const recipient = users[1];
  return users.length === 2 &&
    buyer &&
    recipient &&
    users.every((id) => /^[A-Za-z0-9_]+$/.test(id))
    ? { buyer, recipient }
    : null;
};

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

/** Classify terminal capture failures independently of the provider order's overall status. */
const isDeclinedStoreCapture = (status?: string) =>
  status === "DECLINED" || status === "DENIED" || status === "FAILED";

/**
 * Send an idempotent provider request so retries cannot create or capture twice.
 * Returns undefined only after a recognized funding decline and its release callback;
 * ambiguous errors leave reservations intact for payment reconciliation.
 */
const requestStorePaypalOrder = async (
  token: string,
  path: string,
  requestId: string,
  body: unknown,
  onDeclined?: () => Promise<unknown>,
): Promise<PaypalOrder> => {
  const response = await fetch(`${process.env.NEXT_PUBLIC_PAYPAL_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": requestId,
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 422 && onDeclined) {
      const failure = z
        .object({
          details: z
            .array(
              z.object({
                issue: z.enum([
                  "INSTRUMENT_DECLINED",
                  "PAYER_CANNOT_PAY",
                  "TRANSACTION_REFUSED",
                  "MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED",
                  "REDIRECT_PAYER_FOR_ALTERNATE_FUNDING",
                  "CARD_EXPIRED",
                  "CARD_CLOSED",
                  "COMPLIANCE_VIOLATION",
                  "DOMESTIC_TRANSACTION_REQUIRED",
                  "PAYEE_BLOCKED_TRANSACTION",
                  "PAYER_ACCOUNT_LOCKED_OR_CLOSED",
                  "PAYER_ACCOUNT_RESTRICTED",
                  "TRANSACTION_LIMIT_EXCEEDED",
                  "TRANSACTION_RECEIVING_LIMIT_EXCEEDED",
                  "TRANSACTION_BLOCKED_BY_PAYEE",
                  "PAYMENT_DENIED",
                  "CONTINGENCY_NOT_SUCCESSFUL",
                  "REFERENCED_CARD_EXPIRED",
                  "CARD_BRAND_NOT_SUPPORTED",
                  "CARD_COUNTRY_NOT_SUPPORTED",
                  "CARD_DATA_NOT_FOUND",
                  "PREFERRED_BRAND_NOT_SUPPORTED",
                ]),
              }),
            )
            .min(1),
        })
        .safeParse(await response.json().catch(() => null));
      // Only explicit funding failures release a slot. Timeouts, pending payments and
      // ORDER_ALREADY_CAPTURED may still be paid and must remain reserved for recovery.
      if (failure.success) {
        await onDeclined();
        return undefined;
      }
    }
    throw serverError(
      "BAD_GATEWAY",
      "PayPal could not complete checkout. Retry, or use Lookup Transaction if payment cleared.",
    );
  }
  return (await response.json()) as PaypalOrder;
};
