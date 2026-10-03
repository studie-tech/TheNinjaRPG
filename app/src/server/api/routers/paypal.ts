import { and, desc, eq, gte, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { TransactionType } from "@/drizzle/constants";
import { FederalStatuses } from "@/drizzle/constants";
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
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { reputationAllowanceUsed } from "@/server/utils/purchases/allowance";
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
  paypalCheckoutIdSchema,
  paypalCheckoutSchema,
  paypalOrderSchema,
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
          const buyer = await lockPaypalBuyer(tx, ctx.userId);
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
    .output(baseServerResponse)
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
      const msgs = await syncTransactions(ctx.drizzle, transactions, token);

      return { success: true, message: msgs.join(", ") };
    }),
  resolveSubscription: protectedProcedure
    .input(
      z.object({
        subscriptionId: z.string(),
        orderId: z.string().optional(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const token = await getPaypalAccessToken();
      const subscription = await getPaypalSubscription(input.subscriptionId, token);
      if (subscription === undefined) {
        throw serverError("INTERNAL_SERVER_ERROR", "Could not fetch subscription");
      }
      const users = subscription.custom_id?.split("-");
      const createdByUserId = users?.[0];
      const affectedUserId = users?.[1];
      if (affectedUserId === undefined || createdByUserId === undefined) {
        throw serverError("INTERNAL_SERVER_ERROR", "Could not extract user ID");
      }
      const newStatus =
        subscription.status === "ACTIVE"
          ? plan2FedStatus(subscription.plan_id)
          : "NONE";

      const result = await updateSubscription({
        client: ctx.drizzle,
        createdById: createdByUserId,
        orderId: input.orderId,
        affectedUserId: affectedUserId,
        federalStatus: newStatus,
        status: subscription.status,
        subscriptionId: subscription.id,
      });

      return {
        success: result.rowsAffected !== 0,
        message: `Synced with data from Paypal. UsedID ${affectedUserId} set to have ${newStatus} federal subscription.`,
      };
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
    .input(z.object({ userId: z.string(), status: z.enum(FederalStatuses) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [buyer, target] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
      ]);
      // DERIVED
      const cost = fedStatusRepsCost(input.status);
      // Guard
      if (!cost || cost < 0) return errorResponse("Negative cost?");
      if (buyer.reputationPoints < cost) return errorResponse(`Insufficient funds`);
      if (target.federalStatus !== "NONE") return errorResponse(`Already subscribed`);
      // Mutate
      await Promise.all([
        ctx.drizzle
          .update(userData)
          .set({ federalStatus: input.status })
          .where(
            and(eq(userData.userId, target.userId), eq(userData.federalStatus, "NONE")),
          ),
        ctx.drizzle
          .update(userData)
          .set({ reputationPoints: sql`${userData.reputationPoints} - ${cost}` })
          .where(
            and(
              eq(userData.userId, buyer.userId),
              gte(userData.reputationPoints, cost),
            ),
          ),
        ctx.drizzle.insert(paypalSubscription).values({
          id: nanoid(),
          createdById: ctx.userId,
          affectedUserId: input.userId,
          federalStatus: input.status,
          subscriptionId: nanoid(),
          status: "ACTIVE",
        }),
      ]);
      return { success: true, message: "OK" };
    }),
  // Upgrade a subscription for a user. Can only be done by the user who created the subscription
  upgradeSubscription: protectedProcedure
    .input(z.object({ userId: z.string(), plan: z.enum(FederalStatuses) }))
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
      // Update the database
      await Promise.all([
        ctx.drizzle
          .update(userData)
          .set({
            federalStatus: input.plan,
            reputationPointsTotal: sql`${userData.reputationPointsTotal} - ${cost}`,
            reputationPoints: sql`${userData.reputationPoints} - ${cost}`,
          })
          .where(eq(userData.userId, upgrader.userId)),
        ctx.drizzle
          .update(paypalSubscription)
          .set({ federalStatus: input.plan, updatedAt: new Date() })
          .where(eq(paypalSubscription.subscriptionId, subscription.subscriptionId)),
      ]);
      return { success: true, message: "OK" };
    }),
  // Cancel paypal subscription
  cancelPaypalSubscription: protectedProcedure
    .input(z.object({ subscriptionId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const token = await getPaypalAccessToken();
      // Get subscription from paypal & database
      const paypalSub = await getPaypalSubscription(input.subscriptionId, token);
      const dbSub = await ctx.drizzle.query.paypalSubscription.findFirst({
        where: eq(paypalSubscription.subscriptionId, input.subscriptionId),
      });
      // If we could not find in paypal
      if (paypalSub === undefined) {
        throw serverError(
          "INTERNAL_SERVER_ERROR",
          `Subscription ${input.subscriptionId} not found in paypal`,
        );
      }
      // If not found in local database
      if (dbSub === undefined) {
        throw serverError(
          "INTERNAL_SERVER_ERROR",
          `Subscription ${input.subscriptionId} not found in database`,
        );
      }
      // Check that the user is related to this subscription
      const createdByUserId = dbSub.createdById;
      const affectedUserId = dbSub.affectedUserId;
      const users = [createdByUserId, affectedUserId];
      if (!users.includes(ctx.userId) || !createdByUserId || !affectedUserId) {
        throw serverError("UNAUTHORIZED", "You are not related to this subscription");
      }
      // If status is not active on paypal, let us just cancel. Otherwise assume success cancel already
      let status = 204;
      if (["ACTIVE", "CREATED"].includes(paypalSub.status)) {
        status = await cancelPaypalSubscription(input.subscriptionId, token);
      }
      // If successfull cancel, update database subscription
      if (status === 204) {
        await ctx.drizzle
          .update(paypalSubscription)
          .set({ status: "CANCELLED" })
          .where(eq(paypalSubscription.subscriptionId, input.subscriptionId));
        return { success: true, message: "Successfully canceled subscription" };
      } else {
        throw serverError("INTERNAL_SERVER_ERROR", "Could not cancel subscription");
      }
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
  return await input.client.transaction(async (tx) => {
    // Get the subscription in question
    const current = await tx.query.paypalSubscription.findFirst({
      where: eq(paypalSubscription.subscriptionId, input.subscriptionId),
    });
    if (current && current.updatedAt > secondsFromNow(-3600 * 24 * 31)) {
      return { rowsAffected: 0 };
    }
    // Get any other active subscriptions on this affected user. Update user if not found
    const otherActive = await tx.query.paypalSubscription.findFirst({
      where: and(
        eq(paypalSubscription.affectedUserId, input.affectedUserId),
        eq(paypalSubscription.status, "ACTIVE"),
        ne(paypalSubscription.subscriptionId, input.subscriptionId),
        gte(paypalSubscription.updatedAt, secondsFromNow(-3600 * 24 * 31)),
      ),
    });
    const otherIdx = otherActive
      ? FederalStatuses.indexOf(otherActive.federalStatus)
      : -1;
    const newIdx = FederalStatuses.indexOf(input.federalStatus);
    if (newIdx > otherIdx) {
      // otherActive only knows about PayPal. A store subscription is billed elsewhere and
      // is invisible to it, so the tier still has to be floored by what the stores vouch
      // for or a web sync would strip a subscription Apple or Google is charging for.
      await setFederalStatusWithStoreFloor(
        tx,
        input.affectedUserId,
        input.federalStatus,
      );
    }
    // Update subscription
    if (current) {
      return await tx
        .update(paypalSubscription)
        .set({
          status: input.status,
          federalStatus: input.federalStatus,
          updatedAt: input.lastPayment ?? new Date(),
        })
        .where(eq(paypalSubscription.subscriptionId, input.subscriptionId));
    } else {
      return await tx.insert(paypalSubscription).values({
        id: nanoid(),
        createdById: input.createdById,
        subscriptionId: input.subscriptionId,
        affectedUserId: input.affectedUserId,
        orderId: input.orderId,
        status: input.status,
        federalStatus: input.federalStatus,
        updatedAt: input.lastPayment ?? new Date(),
      });
    }
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
      .filter((t) => t.transaction_info.transaction_status === "S")
      .map(async (t) => {
        // Derived
        const info = t.transaction_info;
        const createdByUserId = info.custom_field?.split("-")?.[0];
        const affectedUserId = info.custom_field?.split("-")?.[1];
        const value = info.transaction_amount.value;
        const currency = info.transaction_amount.currency_code;
        // If data could not be parsed
        if (!value || !currency || !createdByUserId || !affectedUserId) {
          return `Transaction ID ${info.transaction_id} invalid`;
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
          // Update if we found external and it's time to update internal
          if (externalSubscription) {
            const status = getPaypalSubscriptionStatus(externalSubscription);
            await updateSubscription({
              client: client,
              createdById: createdByUserId,
              affectedUserId: affectedUserId,
              federalStatus: status.newStatus,
              status: externalSubscription.status,
              subscriptionId: externalSubscription.id,
              lastPayment: status.lastPayment,
            });
            return `Subscription ID ${info.paypal_reference_id} synced to ${status.newStatus}`;
          } else {
            return `Subscription ID ${info.paypal_reference_id} not found`;
          }
        } else {
          const stored = await client.query.paypalTransaction.findFirst({
            where: or(
              eq(paypalTransaction.transactionId, info.transaction_id),
              eq(paypalTransaction.invoiceId, info.invoice_id),
            ),
          });
          const parsedValue = parseFloat(value);
          if (parsedValue < 0) {
            return `Transaction ID ${info.transaction_id} invalid value`;
          } else if (
            stored &&
            !["RESERVED", "CAPTURING", "DELIVERY_PENDING", "REVIEW_REQUIRED"].includes(
              stored.status,
            )
          ) {
            return `Transaction ID ${info.transaction_id} already processed`;
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
            return `Transaction ID ${info.transaction_id}: ${result && "message" in result ? result.message : "synced"}`;
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
    .then((response) => response.json())
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
      body: JSON.stringify({ reason: "Canceleted through site" }),
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
      return response.json();
    })
    .then((data: PaypalOrder) => {
      return data;
    });
  return order;
};

/** Serialize cross-provider allowance changes on the buyer row without missing-row locks. */
const lockPaypalBuyer = async (client: DrizzleClient, buyerId: string) => {
  const locked = await client
    .update(userData)
    .set({
      updatedAt: sql`GREATEST(CURRENT_TIMESTAMP(3), ${userData.updatedAt} + INTERVAL 1000 MICROSECOND)`,
    })
    .where(eq(userData.userId, buyerId));
  if (locked.rowsAffected !== 1) return undefined;
  return client.query.userData.findFirst({ where: eq(userData.userId, buyerId) });
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
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok)
    throw new Error(
      `PayPal order request failed (${response.status}); retry the same checkout`,
    );
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
      const buyer = await lockPaypalBuyer(tx, input.createdById);
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
