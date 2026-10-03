import { and, desc, eq, gte, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { TransactionType } from "@/drizzle/constants";
import { FEDERAL_MONTHLY_USD_CENTS, FederalStatuses } from "@/drizzle/constants";
import type { FederalStatus } from "@/drizzle/schema";
import {
  paypalSubscription,
  paypalTransaction,
  recruitmentRewards,
  userData,
} from "@/drizzle/schema";
import { isNativeUserAgent } from "@/libs/native/userAgent";
import {
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
  canonicalStoreUserId,
  setFederalStatusWithStoreFloor,
} from "@/server/utils/purchases/grant";
import { upgradeStripeFederalWithReps } from "@/server/utils/stripe/fulfillment";
import {
  calcFedUgradeCost,
  dollars2reps,
  dynamicMonthlyRepCap,
  fedStatusRepsCost,
  plan2FedStatus,
  reps2dollars,
} from "@/utils/paypal";
import { canSeeSecretData } from "@/utils/permissions";
import { addDays, secondsFromNow } from "@/utils/time";
import type { JsonData } from "@/utils/typeutils";
import {
  federalReputationPurchaseSchema,
  federalUpgradeSchema,
  paypalCaptureResponseSchema,
  paypalCheckoutIdSchema,
  paypalCheckoutSchema,
  paypalOrderSchema,
  paypalSubscriptionIdSchema,
  paypalSubscriptionSchema,
  searchPaypalTransactionSchema,
} from "@/validators/points";
import type { DrizzleClient } from "../../db";
import { fetchUser } from "./profile";

type PaypalAmount = {
  currency_code?: string;
  value?: string;
};

type PaypalOrder =
  | {
      fundingDeclined?: boolean;
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
  createOrder: protectedProcedure
    .input(paypalCheckoutSchema)
    .mutation(async ({ ctx, input }) => {
      if (isNativeUserAgent(ctx.userAgent))
        return errorResponse("Use the in-app store to purchase in the native app.");
      if (input.expectedUserId !== ctx.userId)
        return errorResponse("Your account changed. Start checkout again.");
      const amount = Math.round(reps2dollars(input.reputationPoints) * 100) / 100;
      const reps = dollars2reps(amount);
      const reserved = await retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          const buyer = await lockPurchaseBuyer(tx, ctx.userId);
          const [recipient, existing] = await Promise.all([
            tx.query.userData.findFirst({ where: eq(userData.userId, input.userId) }),
            tx.query.paypalTransaction.findFirst({
              where: eq(paypalTransaction.id, input.requestId),
            }),
          ]);
          if (!buyer || buyer.isBanned || !recipient || recipient.isBanned)
            return false;
          if (existing)
            return (
              existing.createdById === ctx.userId &&
              existing.affectedUserId === input.userId &&
              existing.amount === amount &&
              existing.reputationPoints === reps &&
              existing.status === "RESERVED" &&
              existing.createdAt.getTime() > Date.now() - 3 * 3600000
            );
          if (
            (await reputationAllowanceUsed(tx, ctx.userId)) + reps >
            dynamicMonthlyRepCap(buyer)
          )
            return false;
          await tx.insert(paypalTransaction).values({
            id: input.requestId,
            createdById: ctx.userId,
            affectedUserId: input.userId,
            transactionId: `reservation_${input.requestId}`,
            transactionUpdatedDate: new Date().toISOString(),
            invoiceId: input.requestId,
            amount,
            reputationPoints: reps,
            currency: "USD",
            status: "RESERVED",
            type: "REP_PURCHASE",
            rawData: {},
          });
          return true;
        }),
      );
      if (!reserved)
        return errorResponse(
          "This purchase exceeds your remaining monthly allowance, or checkout changed. Cancel unfinished checkout and try again.",
        );
      const existing = await ctx.drizzle.query.paypalTransaction.findFirst({
        where: eq(paypalTransaction.id, input.requestId),
      });
      if (existing?.orderId)
        return {
          success: true,
          message: "Continue checkout",
          orderId: existing.orderId,
        };
      // The same request resumes after an uncertain provider response; do not release its
      // reservation until cancellation prevents our capture endpoint from charging it.
      const token = await getPaypalAccessToken();
      const order = await paypalOrderRequest("", token, input.requestId, {
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: { currency_code: "USD", value: amount.toFixed(2) },
            invoice_id: input.requestId,
            custom_id: `${ctx.userId}-${input.userId}`,
          },
        ],
      });
      if (!order?.id) throw new Error("PayPal did not return an order ID");
      const saved = await ctx.drizzle
        .update(paypalTransaction)
        .set({ orderId: order.id })
        .where(
          and(
            eq(paypalTransaction.id, input.requestId),
            eq(paypalTransaction.status, "RESERVED"),
          ),
        );
      if (saved.rowsAffected !== 1) {
        const current = await ctx.drizzle.query.paypalTransaction.findFirst({
          where: eq(paypalTransaction.id, input.requestId),
        });
        if (current?.orderId !== order.id || current.status !== "RESERVED")
          return errorResponse("Checkout was cancelled. Start checkout again.");
      }
      return { success: true, message: "Continue checkout", orderId: order.id };
    }),
  cancelOrder: protectedProcedure
    .input(paypalCheckoutIdSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.drizzle
        .update(paypalTransaction)
        .set({ status: "CANCELLED" })
        .where(
          and(
            eq(paypalTransaction.id, input.requestId),
            eq(paypalTransaction.createdById, ctx.userId),
            eq(paypalTransaction.status, "RESERVED"),
          ),
        );
      if (result.rowsAffected === 1)
        return { success: true, message: "Checkout cancelled" };
      const existing = await ctx.drizzle.query.paypalTransaction.findFirst({
        where: eq(paypalTransaction.id, input.requestId),
      });
      if (
        !existing ||
        (existing.createdById === ctx.userId && existing.status === "CANCELLED")
      )
        return { success: true, message: "Checkout cancelled" };
      return errorResponse(
        "Payment may already be processing. Check your purchase history before trying again.",
      );
    }),
  captureOrder: protectedProcedure
    .input(paypalOrderSchema)
    .output(paypalCaptureResponseSchema)
    .mutation(async ({ ctx, input }) => {
      if (isNativeUserAgent(ctx.userAgent))
        return errorResponse("Use the in-app store to purchase in the native app.");
      const receipt = await ctx.drizzle.query.paypalTransaction.findFirst({
        where: and(
          eq(paypalTransaction.orderId, input.orderId),
          eq(paypalTransaction.type, "REP_PURCHASE"),
        ),
      });
      if (!receipt || receipt.createdById !== ctx.userId)
        return errorResponse("This checkout belongs to another account.");
      if (receipt.status === "COMPLETED")
        return { success: true, message: "Reputation points already delivered" };
      if (receipt.status === "RESERVED") {
        const claimed = await ctx.drizzle
          .update(paypalTransaction)
          .set({ status: "CAPTURING" })
          .where(
            and(
              eq(paypalTransaction.id, receipt.id),
              eq(paypalTransaction.status, "RESERVED"),
              gte(paypalTransaction.createdAt, sql`NOW() - INTERVAL 3 HOUR`),
            ),
          );
        if (claimed.rowsAffected !== 1)
          return errorResponse("Checkout expired or changed. Start checkout again.");
      } else if (receipt.status !== "CAPTURING")
        return errorResponse("Checkout is closed. Start checkout again.");
      const token = await getPaypalAccessToken();
      let order = await getPaypalOrder({ orderId: input.orderId, token });
      if (order?.status !== "COMPLETED")
        order = await paypalOrderRequest(
          `${input.orderId}/capture`,
          token,
          `capture_${receipt.id}`,
          {},
        );
      if (order?.fundingDeclined) {
        // Only a definite provider decline can release a capture claim. Unknown
        // outcomes retain it until the same idempotent capture is reconciled.
        await ctx.drizzle
          .update(paypalTransaction)
          .set({ status: "RESERVED" })
          .where(
            and(
              eq(paypalTransaction.id, receipt.id),
              eq(paypalTransaction.status, "CAPTURING"),
            ),
          );
        return {
          ...errorResponse(
            "PayPal declined this payment method. Choose another payment method or cancel checkout.",
          ),
          restartFunding: true,
        };
      }
      // Some provider responses omit purchase-unit metadata even after capture. Fetch
      // the completed order rather than interpreting an incomplete response as delivery.
      if (order?.status === "COMPLETED" && !order.purchase_units?.[0]?.custom_id)
        order = await getPaypalOrder({ orderId: input.orderId, token });
      return deliverPaypalOrder(ctx.drizzle, order, ctx.userId, input.orderId);
    }),
  // Recover orders approved by a previously loaded checkout client.
  resolveOrder: protectedProcedure
    .input(paypalOrderSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      if (isNativeUserAgent(ctx.userAgent))
        return errorResponse("Use the in-app store to purchase in the native app.");
      const token = await getPaypalAccessToken();
      const order = await getPaypalOrder({ orderId: input.orderId, token });
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
      return { success: result.success, message: result.messages.join(", ") };
    }),
  resolveSubscription: protectedProcedure
    .input(paypalSubscriptionSchema)
    .output(baseServerResponse)
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
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;
      // Defaulting to the session means a self-view can never send a stale user id
      const targetUserId = input.userId ?? ctx.userId;
      const [user, transactions] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.paypalTransaction.findMany({
          offset: skip,
          limit: input.limit,
          where: eq(paypalTransaction.createdById, targetUserId),
          with: { affectedUser: true },
          orderBy: desc(paypalTransaction.createdAt),
        }),
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
    return await ctx.drizzle.query.paypalSubscription.findMany({
      where: and(
        or(
          eq(paypalSubscription.createdById, ctx.userId),
          eq(paypalSubscription.affectedUserId, ctx.userId),
        ),
        eq(paypalSubscription.status, "ACTIVE"),
      ),
      with: { affectedUser: true, createdBy: true },
      orderBy: desc(paypalSubscription.createdAt),
    });
  }),
  // Buy subscription with reputation points
  subscribeWithReps: protectedProcedure
    .input(federalReputationPurchaseSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      if (input.expectedUserId !== ctx.userId)
        return errorResponse("Your account changed. Reload before purchasing.");
      if (input.status === "NONE")
        return errorResponse("Choose a federal support tier.");
      const cost = fedStatusRepsCost(input.status);
      const changed = new Error(
        "Your balance or recipient's subscription changed. Reload and try again.",
      );
      try {
        await retryOnDeadlock(() =>
          ctx.drizzle.transaction(async (tx) => {
            const debited = await tx
              .update(userData)
              .set({ reputationPoints: sql`${userData.reputationPoints} - ${cost}` })
              .where(
                and(
                  eq(userData.userId, ctx.userId),
                  gte(userData.reputationPoints, cost),
                ),
              );
            if (debited.rowsAffected !== 1) throw changed;
            const claimed = await tx
              .update(userData)
              .set({ federalStatus: input.status })
              .where(
                and(
                  eq(userData.userId, input.userId),
                  eq(userData.federalStatus, "NONE"),
                ),
              );
            if (claimed.rowsAffected !== 1) throw changed;
            await tx.insert(paypalSubscription).values({
              id: nanoid(),
              createdById: ctx.userId,
              affectedUserId: input.userId,
              federalStatus: input.status,
              subscriptionId: `reps_${nanoid()}`,
              status: "ACTIVE",
            });
          }),
        );
      } catch (error) {
        if (error === changed) return errorResponse(changed.message);
        throw error;
      }
      return { success: true, message: "OK" };
    }),
  // Upgrade a subscription for a user. Can only be done by the user who created the subscription
  upgradeSubscription: protectedProcedure
    .input(federalUpgradeSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Self only, which is all the UI ever offers. Without it the caller can name any
      // subscriber: the upgrade price is the delta between their tier and the new one, so
      // buying GOLD against someone else's SILVER costs the difference instead of the full
      // price, and it rewrites that player's subscription row to a plan they are not being
      // billed for -- which the hourly reconcile then reads as a tier they own.
      if (input.userId !== ctx.userId) {
        return errorResponse("You can only upgrade your own subscription");
      }
      const [upgrader, target] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
      ]);
      const subscription = await ctx.drizzle.query.paypalSubscription.findFirst({
        where: and(
          or(
            eq(paypalSubscription.status, "ACTIVE"),
            eq(paypalSubscription.status, "CANCELLED"),
          ),
          eq(paypalSubscription.federalStatus, target.federalStatus),
          eq(paypalSubscription.affectedUserId, target.userId),
          eq(paypalSubscription.createdById, ctx.userId),
          gte(paypalSubscription.updatedAt, sql`NOW() - INTERVAL 31 DAY`),
        ),
      });
      // If we could not find in paypal
      if (!subscription)
        return await upgradeStripeFederalWithReps(
          ctx.drizzle,
          ctx.userId,
          target.federalStatus,
          input.plan,
        );
      // Get cost, and ensure that we are actually upgrading
      const cost = calcFedUgradeCost(subscription.federalStatus, input.plan);
      if (!cost || cost < 0) {
        return errorResponse(`Invalid: ${subscription.federalStatus} to ${input.plan}`);
      }
      // Check that we have enough reputation points
      if (upgrader.reputationPoints < cost) {
        return errorResponse(`Not enough reputation points`);
      }
      // The balance, displayed tier, and paid ledger must advance together. A single
      // guarded joined update prevents duplicate upgrades and stale-plan debits.
      const result = await retryOnDeadlock(() =>
        ctx.drizzle.execute(sql`
        UPDATE ${userData} u INNER JOIN ${paypalSubscription} p ON p.affectedUserId = u.userId
        SET u.federalStatus = ${input.plan},
            u.reputationPoints = u.reputationPoints - ${cost},
            u.reputationPointsTotal = u.reputationPointsTotal - ${cost},
            p.federalStatus = ${input.plan}, p.updatedAt = CURRENT_TIMESTAMP(3)
        WHERE u.userId = ${ctx.userId} AND u.federalStatus = ${target.federalStatus}
          AND u.reputationPoints >= ${cost} AND p.id = ${subscription.id}
          AND p.createdById = ${ctx.userId} AND p.federalStatus = ${subscription.federalStatus}
          AND p.status IN ('ACTIVE', 'CANCELLED')
          AND p.updatedAt = ${subscription.updatedAt}
          AND p.updatedAt >= CURRENT_TIMESTAMP(3) - INTERVAL 31 DAY`),
      );
      if (result.rowsAffected === 0)
        return errorResponse(
          "Your balance or subscription changed. Reload and try again.",
        );
      return { success: true, message: "OK" };
    }),
  // Cancel paypal subscription
  cancelPaypalSubscription: protectedProcedure
    .input(paypalSubscriptionIdSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const stored = await ctx.drizzle.query.paypalSubscription.findFirst({
        where: eq(paypalSubscription.subscriptionId, input.subscriptionId),
      });
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
        await ctx.drizzle
          .update(paypalSubscription)
          .set({ status: "CANCELLED" })
          .where(eq(paypalSubscription.id, stored.id));
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
      await ctx.drizzle
        .update(paypalSubscription)
        .set({ status: "CANCELLED" })
        .where(eq(paypalSubscription.id, stored.id));
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

/**
 * Updates subscription for a user
 */
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
  return retryOnDeadlock(() =>
    input.client.transaction(async (tx) => {
      const current = await tx.query.paypalSubscription.findFirst({
        where: eq(paypalSubscription.subscriptionId, input.subscriptionId),
      });
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
      if (
        current &&
        current.status === input.status &&
        current.federalStatus === tier &&
        current.updatedAt.getTime() === paidAt.getTime() &&
        current.orderId === (approvalReference ?? null)
      )
        return { success: true, message: "Subscription already synchronized" };
      if (current) {
        const claimed = await tx
          .update(paypalSubscription)
          .set({
            status: input.status,
            federalStatus: tier,
            updatedAt: paidAt,
            orderId: approvalReference,
          })
          .where(
            and(
              eq(paypalSubscription.id, current.id),
              eq(paypalSubscription.updatedAt, current.updatedAt),
              eq(paypalSubscription.status, current.status),
              eq(paypalSubscription.federalStatus, current.federalStatus),
            ),
          );
        if (claimed.rowsAffected !== 1)
          return errorResponse("Subscription changed. Retry recovery.");
      } else {
        try {
          await tx.insert(paypalSubscription).values({
            id: nanoid(),
            createdById: input.createdById,
            affectedUserId: input.affectedUserId,
            orderId: input.orderId,
            subscriptionId: input.subscriptionId,
            federalStatus: tier,
            status: input.status,
            updatedAt: paidAt,
          });
        } catch (error) {
          if (isMysqlDuplicateKeyError(error))
            return errorResponse("Subscription changed. Retry recovery.");
          throw error;
        }
      }
      await setFederalStatusWithStoreFloor(tx, input.affectedUserId, tier);
      return { success: true, message: "Subscription synchronized" };
    }),
  );
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
  await input.client.insert(paypalTransaction).values({
    id: nanoid(),
    createdById: input.createdById,
    transactionId: input.transactionId,
    transactionUpdatedDate: input.transactionUpdatedDate,
    orderId: input.orderId,
    affectedUserId: input.affectedUserId,
    invoiceId: input.invoiceId,
    amount: input.value,
    reputationPoints: input.reps,
    currency: input.currency,
    status: input.status,
    type: input.type,
    rawData: input.raw,
  });
  if (input.type === "REFERRAL") {
    await input.client.insert(recruitmentRewards).values({
      id: nanoid(),
      userId: input.affectedUserId,
      recruitedUserId: input.createdById,
      amount: input.reps,
      type: "REPUTATION",
    });
  }
  // If we succeed, that means the transaction was not already in the database.
  // We can then update the user
  return await input.client
    .update(userData)
    .set({
      reputationPointsTotal: sql`${userData.reputationPointsTotal} + ${input.reps}`,
      reputationPoints: sql`${userData.reputationPoints} + ${input.reps}`,
    })
    .where(eq(userData.userId, input.affectedUserId));
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
 * Sync transactions (both subs & reps from paypal to game)
 */
export const syncTransactions = async (
  client: DrizzleClient,
  transactions: PaypalTransaction[],
  token: string,
) => {
  const notifications = await Promise.all(
    transactions
      .filter((t) => t?.transaction_info?.transaction_status === "S")
      .map(async (t) => {
        // Derived
        const info = t.transaction_info;
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
          const stored = await client.query.paypalTransaction.findFirst({
            where: and(
              eq(paypalTransaction.type, "REP_PURCHASE"),
              or(
                eq(paypalTransaction.transactionId, info.transaction_id),
                ...(info.invoice_id
                  ? [eq(paypalTransaction.invoiceId, info.invoice_id)]
                  : []),
              ),
            ),
          });
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
            return errorResponse(
              `Transaction ID ${info.transaction_id} has invalid USD payment amount`,
            );
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
            return result && "message" in result
              ? result
              : {
                  success: true,
                  message: `Transaction ID ${info.transaction_id} synced`,
                };
          }
        }
      }),
  );
  return {
    success:
      notifications.length > 0 && notifications.every((result) => result.success),
    messages:
      notifications.length > 0
        ? notifications.map((result) => result.message)
        : [
            "No completed PayPal transaction was found for that ID and date. Check the details and try again.",
          ],
  };
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
    .then((response) => (response.ok ? response.json() : undefined))
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

const paypalOrderRequest = async (
  path: string,
  token: string,
  requestId: string,
  body: JsonData,
): Promise<PaypalOrder> => {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_PAYPAL_URL}/v2/checkout/orders${path ? `/${path}` : ""}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": requestId,
        Prefer: "return=representation",
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    const failure = (await response.json().catch(() => undefined)) as
      | { details?: { issue?: string }[] }
      | undefined;
    if (
      path.endsWith("/capture") &&
      response.status === 422 &&
      failure?.details?.[0]?.issue === "INSTRUMENT_DECLINED"
    )
      return { fundingDeclined: true };
    throw new Error(
      `PayPal order request failed (${response.status}); retry the same checkout`,
    );
  }
  return response.json();
};

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

/** Receipt conversion and reward delivery commit together, including recovery imports. */
const deliverPaypalReputation = async (input: Parameters<typeof updateReps>[0]) => {
  const [createdById, affectedUserId] = await Promise.all([
    canonicalStoreUserId(input.client, input.createdById),
    canonicalStoreUserId(input.client, input.affectedUserId),
  ]);
  input = { ...input, createdById, affectedUserId };
  return retryOnDeadlock(() =>
    input.client.transaction(async (tx) => {
      const buyer = await lockPurchaseBuyer(tx, input.createdById);
      if (!buyer)
        return errorResponse(
          "Payment requires support review: buyer account was not found.",
        );
      const stored = await tx.query.paypalTransaction.findFirst({
        where: and(
          eq(paypalTransaction.type, "REP_PURCHASE"),
          or(
            eq(paypalTransaction.transactionId, input.transactionId),
            ...(input.invoiceId
              ? [eq(paypalTransaction.invoiceId, input.invoiceId)]
              : []),
            ...(input.orderId ? [eq(paypalTransaction.orderId, input.orderId)] : []),
          ),
        ),
      });
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
        await tx
          .update(paypalTransaction)
          .set({ ...terms, status })
          .where(eq(paypalTransaction.id, id));
      else await tx.insert(paypalTransaction).values({ id, ...terms, status });
      // A previously captured legacy order may arrive after another provider reserved the
      // remaining allowance. Retain the payment for staff review; never silently over-grant.
      if (!allowed)
        return errorResponse(
          "Payment received but exceeds your monthly allowance. Contact support with your PayPal transaction ID for review or refund; no points were delivered.",
        );
      const granted = await tx
        .update(userData)
        .set({
          reputationPointsTotal: sql`${userData.reputationPointsTotal} + ${input.reps}`,
          reputationPoints: sql`${userData.reputationPoints} + ${input.reps}`,
        })
        .where(eq(userData.userId, input.affectedUserId));
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
