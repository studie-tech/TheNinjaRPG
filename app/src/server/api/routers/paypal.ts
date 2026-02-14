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
import {
  calcFedUgradeCost,
  dollars2reps,
  fedStatusRepsCost,
  plan2FedStatus,
} from "@/utils/paypal";
import { canSeeSecretData } from "@/utils/permissions";
import { addDays, secondsFromNow } from "@/utils/time";
import type { JsonData } from "@/utils/typeutils";
import { searchPaypalTransactionSchema } from "@/validators/points";
import type { DrizzleClient } from "../../db";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "../trpc";
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
  resolveOrder: protectedProcedure
    .input(
      z.object({
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        orderId: z.string().min(15).max(20),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const token = await getPaypalAccessToken();
      const order = await getPaypalOrder({ orderId: input.orderId, token: token });
      // Guarding
      if (order === undefined) {
        throw serverError("INTERNAL_SERVER_ERROR", "Could not fetch order");
      }
      const affectedUserId = order?.purchase_units?.[0]?.custom_id?.split("-")?.[1];
      if (affectedUserId === undefined) {
        throw serverError("INTERNAL_SERVER_ERROR", "Could not extract user ID");
      }
      const affectedUser = await fetchUser(ctx.drizzle, affectedUserId);
      if (!affectedUser) {
        throw serverError("INTERNAL_SERVER_ERROR", "Could not fetch target user");
      }
      const capture = order?.purchase_units?.[0]?.payments?.captures?.[0];
      if (capture?.status !== "COMPLETED") {
        throw serverError("INTERNAL_SERVER_ERROR", "Payments not completed");
      }
      const { currency_code, value } = capture.amount;
      // Guards
      if (value === undefined) {
        throw serverError("INTERNAL_SERVER_ERROR", "Could not extract payment amount");
      }
      if (parseFloat(value) < 1) {
        throw serverError("INTERNAL_SERVER_ERROR", "Too low payment amount");
      }
      if (currency_code !== "USD") {
        throw serverError("INTERNAL_SERVER_ERROR", "Invalid currency");
      }
      // Update database - will fail if orderID already exists, due to unique constraint
      await updateReps({
        client: ctx.drizzle,
        createdById: ctx.userId,
        transactionId: capture.id,
        transactionUpdatedDate: capture.update_time,
        orderId: input.orderId,
        affectedUserId: affectedUserId,
        invoiceId: capture.invoice_id,
        value: parseFloat(value),
        currency: currency_code,
        status: "COMPLETED",
        reps: dollars2reps(parseFloat(value)),
        type: "REP_PURCHASE",
        raw: order,
      });
      return { success: true, message: "Reputation points purchased" };
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
  // Get reps from the last 30 days
  getRecentRepsCount: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.drizzle
        .select({
          count: sql<number>`SUM(${paypalTransaction.reputationPoints})`.mapWith(
            Number,
          ),
        })
        .from(paypalTransaction)
        .where(
          and(
            eq(paypalTransaction.createdById, input.userId),
            gte(paypalTransaction.createdAt, sql`NOW() - INTERVAL 30 DAY`),
          ),
        );
      return result?.[0]?.count ?? 0;
    }),
  // Get all paypal transactions by this user
  getPaypalTransactions: protectedProcedure
    .input(
      z.object({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(100),
        userId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;
      const [user, transactions] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.paypalTransaction.findMany({
          offset: skip,
          limit: input.limit,
          where: eq(paypalTransaction.createdById, input.userId),
          with: { affectedUser: true },
          orderBy: desc(paypalTransaction.createdAt),
        }),
      ]);
      if (!canSeeSecretData(user.role) && ctx.userId !== input.userId) {
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
      if (!subscription) {
        return errorResponse("Could not find such a subscription");
      }
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
      await tx
        .update(userData)
        .set({ federalStatus: input.federalStatus })
        .where(eq(userData.userId, input.affectedUserId));
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
          } else if (stored) {
            return `Transaction ID ${info.transaction_id} already processed`;
          } else {
            await updateReps({
              client: client,
              createdById: createdByUserId,
              transactionId: info.transaction_id,
              transactionUpdatedDate: info.transaction_updated_date,
              orderId: nanoid(),
              affectedUserId: affectedUserId,
              invoiceId: info.invoice_id,
              value: parsedValue,
              currency: currency,
              status: "COMPLETED",
              reps: dollars2reps(parsedValue),
              type: "REP_PURCHASE",
              raw: t,
            });
            return `Transaction ID ${info.transaction_id} synced!`;
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
