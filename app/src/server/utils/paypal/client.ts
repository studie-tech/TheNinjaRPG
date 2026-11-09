import { z } from "zod";
import { PAYPAL_PAID_PERIOD_DAYS } from "@/drizzle/constants";
import type { FederalStatus } from "@/drizzle/schema";
import { serverError } from "@/server/api/trpc";
import { plan2FedStatus } from "@/utils/paypal";
import { addDays, DAY_S, secondsFromNow } from "@/utils/time";

/** Fetch PayPal reporting transactions within 14 days of `transactionDate`, optionally for one transaction ID. */
export const getPaypalTransactions = async (
  transactionDate: Date,
  token: string,
  transactionId?: string,
) => {
  const startDate = addDays(transactionDate, -14);
  const endDate = addDays(transactionDate, 14);
  let path = `/v1/reporting/transactions?start_date=${startDate.toISOString()}&end_date=${endDate.toISOString()}`;
  if (transactionId) {
    path = `${path}&transaction_id=${transactionId}`;
  }
  const response = await paypalFetch(`${path}&fields=all`, token, { method: "GET" });
  const data = (await response.json()) as { transaction_details?: PaypalTransaction[] };
  return data.transaction_details ?? [];
};

/**
 * Get updated paypal subscription status, accounting for last payment time
 */
export const getPaypalSubscriptionStatus = (
  subscription: PaypalSubscription,
): { newStatus: FederalStatus; lastPayment: Date } => {
  const lastPayment = new Date(subscription.billing_info.last_payment.time);
  const fedStatus = plan2FedStatus(subscription.plan_id);
  const stillActive = lastPayment > secondsFromNow(-PAYPAL_PAID_PERIOD_DAYS * DAY_S);
  const newStatus = stillActive ? fedStatus : "NONE";
  return { newStatus, lastPayment };
};

/**
 * Fetch a subscription from paypal
 * @param subscriptionId - The subscription ID to fetch
 * @param token - The access token to use
 * @returns The subscription data, or undefined when PayPal does not know the subscription
 */
export const getPaypalSubscription = async (subscriptionId: string, token: string) => {
  const response = await paypalFetch(
    `/v1/billing/subscriptions/${subscriptionId}`,
    token,
    { method: "GET" },
  );
  if (response.status === 404) return undefined;
  // An outage is not proof that paid support ended; leave reconciliation retryable.
  if (!response.ok)
    throw new Error(`PayPal subscription lookup failed (${response.status})`);
  return (await response.json()) as PaypalSubscription;
};

/**
 * Cancel a subscription from paypal
 */
export const cancelPaypalSubscription = async (
  subscriptionId: string,
  token: string,
) => {
  const response = await paypalFetch(
    `/v1/billing/subscriptions/${subscriptionId}/cancel`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ reason: "Cancelled through the game" }),
    },
  );
  return response.status;
};

/** Calls the PayPal REST API as the app; callers keep their own response handling. */
const paypalFetch = (path: string, token: string, init: RequestInit) =>
  fetch(`${process.env.NEXT_PUBLIC_PAYPAL_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

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
  const response = await paypalFetch(
    `/v2/checkout/orders/${input.orderId}`,
    input.token,
    { method: "GET" },
  );
  return (response.ok ? await response.json() : undefined) as PaypalOrder;
};

/**
 * Send an idempotent provider request so retries cannot create or capture twice.
 * Returns undefined only after a recognized funding decline and its release callback;
 * ambiguous errors leave reservations intact for payment reconciliation.
 */
export const requestStorePaypalOrder = async (
  token: string,
  path: string,
  requestId: string,
  body: unknown,
  onDeclined?: () => Promise<unknown>,
): Promise<PaypalOrder> => {
  const response = await paypalFetch(path, token, {
    method: "POST",
    headers: {
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

type PaypalAmount = {
  currency_code?: string;
  value?: string;
};

export type PaypalOrder =
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

export type PaypalSubscription = {
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

export type PaypalTransaction = {
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
