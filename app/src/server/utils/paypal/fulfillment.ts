import { getReconcilePaypalSubscriptionUserUpdate } from "@/deltas/paypal";
import {
  FEDERAL_MONTHLY_USD_CENTS,
  FederalStatuses,
  PAYPAL_PAID_PERIOD_DAYS,
} from "@/drizzle/constants";
import type { FederalStatus } from "@/drizzle/schema";
import {
  creditPaypalReputation,
  findPaypalSubscriptionForCancelPaypalSubscription,
  findPaypalTransactionForDeliverPaypalReputation,
  findPaypalTransactionForSyncTransactions,
  insertPaypalSubscriptionForUpdateSubscription,
  insertPaypalTransactionForDeliverPaypalReputation,
  updatePaypalSubscriptionForUpdateSubscription,
  updatePaypalTransactionForDeliverPaypalReputation,
} from "@/queries/paypal";
import { type BaseServerResponse, errorResponse } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import type {
  PaypalOrder,
  PaypalSubscription,
  PaypalTransaction,
} from "@/server/utils/paypal/client";
import {
  getPaypalOrder,
  getPaypalSubscription,
  getPaypalSubscriptionStatus,
} from "@/server/utils/paypal/client";
import {
  lockPurchaseBuyer,
  reputationAllowanceUsed,
} from "@/server/utils/purchases/allowance";
import {
  canonicalStoreUserId,
  setFederalStatusWithStoreFloor,
} from "@/server/utils/purchases/grant";
import { logError } from "@/server/utils/sentry";
import {
  deliverStoreOrder,
  readStoreCustomId,
  STORE_DELIVERY_ERRORS,
} from "@/server/utils/webStore";
import { dollars2reps, dynamicMonthlyRepCap, plan2FedStatus } from "@/utils/paypal";
import { DAY_S, secondsFromNow } from "@/utils/time";
import type { JsonData } from "@/utils/typeutils";

/** Receipt states a reported payment can still be delivered from. */
const UNDELIVERED_RECEIPT_STATUSES = ["RESERVED", "CAPTURING", "DELIVERY_PENDING"];

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
      current.updatedAt > secondsFromNow(-PAYPAL_PAID_PERIOD_DAYS * DAY_S) &&
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
              Object.values<string>(STORE_DELIVERY_ERRORS).includes(error.message);
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
          if (stored?.orderId && UNDELIVERED_RECEIPT_STATUSES.includes(stored.status)) {
            const order = await getPaypalOrder({ orderId: stored.orderId, token });
            const buyerId = await canonicalStoreUserId(client, createdByUserId);
            return deliverPaypalOrder(client, order, buyerId, stored.orderId);
          }
          if (!Number.isFinite(parsedValue) || parsedValue < 1 || currency !== "USD") {
            return errorResponse(`Transaction ID ${info.transaction_id} invalid value`);
          } else if (stored && !UNDELIVERED_RECEIPT_STATUSES.includes(stored.status)) {
            return {
              success: true,
              message: `Transaction ID ${info.transaction_id} already processed`,
            };
          } else {
            const result = await deliverPaypalReputation({
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
            return result.success
              ? {
                  success: true,
                  message: `Transaction ID ${info.transaction_id} synced!`,
                }
              : result;
          }
        }
      }),
  );
  return notifications;
};

/** Verify one authoritative legacy capture before entering shared receipt delivery. */
export const deliverPaypalOrder = async (
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
export const deliverPaypalReputation = async (input: PaypalReputationPayment) => {
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
        (stored.reputationPoints !== input.reps ||
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
      const granted = await creditPaypalReputation(tx, input);
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
  const result = await updateSubscription({
    client: input.client,
    ...owners,
    subscriptionId: input.subscription.id,
    orderId: input.orderId ?? input.subscription.id,
    federalStatus: getPaypalSubscriptionStatus(input.subscription).newStatus,
    status: input.subscription.status,
  });
  return {
    ...result,
    // Only the canonical recipient's cross-provider entitlement changes.
    ...getReconcilePaypalSubscriptionUserUpdate({
      resultSuccess: result.success,
      inputCallerId: input.callerId,
      ownersAffectedUserId: owners.affectedUserId,
    }),
  };
};

/** Decode the legacy buyer-recipient reference without accepting ambiguous identities. */
export const parsePaypalSubscriptionOwners = (customId: unknown) => {
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

type PaypalReputationPayment = {
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
  type: "REP_PURCHASE";
  raw: JsonData;
};
