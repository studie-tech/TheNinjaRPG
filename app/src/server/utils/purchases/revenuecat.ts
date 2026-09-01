/**
 * RevenueCat webhook parsing.
 *
 * RevenueCat authenticates its webhooks with a shared secret sent in the `Authorization`
 * header — there is no signature to verify — so the comparison has to be constant-time
 * and the endpoint has to refuse when no secret is configured. Accepting unauthenticated
 * calls would let anyone credit any account.
 */

import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { StorePlatform } from "@/drizzle/constants";

/**
 * Only the fields that decide what happens. RevenueCat sends a great deal more, and the
 * whole body is stored on the purchase row for the audit trail.
 */
export const revenueCatEventSchema = z.object({
  event: z.object({
    type: z.string(),
    id: z.string().min(1),
    /**
     * Absent on TRANSFER, which names `transferred_from`/`transferred_to` instead. Required
     * here would make safeParse fail and the route answer 400, which tells RevenueCat to
     * stop retrying an event it will never redeliver.
     */
    app_user_id: z.string().nullish(),
    /** Public dashboard app id; identifies the originating platform when store is absent. */
    app_id: z.string().nullish(),
    product_id: z.string().nullish(),
    /** Absent on some event types, in which case the event id stands in. */
    transaction_id: z.string().nullish(),
    store: z.string().nullish(),
    cancel_reason: z.string().nullish(),
    /** When the store says this happened, which is not when we hear about it. */
    event_timestamp_ms: z.number().nullish(),
    purchased_at_ms: z.number().nullish(),
    expiration_at_ms: z.number().nullish(),
    grace_period_expiration_at_ms: z.number().nullish(),
    environment: z.string().nullish(),
    entitlement_ids: z.array(z.string()).nullish(),
    transferred_from: z.array(z.string()).nullish(),
    transferred_to: z.array(z.string()).nullish(),
  }),
});
export type RevenueCatEvent = z.infer<typeof revenueCatEventSchema>["event"];

/**
 * Events that mean the player now owns something.
 *
 * PRODUCT_CHANGE is deliberately absent. It is informative: it announces a switch that
 * has not taken effect yet, and on the App Store its `product_id` is the tier being
 * *left*, not the one being moved to. Granting on it would credit the old product and,
 * for a scheduled downgrade, cut short a month already paid for. The change arrives on
 * its own once it is real — RENEWAL on the App Store, INITIAL_PURCHASE on Play — and
 * both of those are already here.
 */
const GRANTING_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "NON_RENEWING_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
]);

/**
 * Events that mean access has ended. CANCELLATION is deliberately absent: for the usual
 * reason — the player switched auto-renew off — they keep what they paid for until
 * EXPIRATION, and revoking here would cut a paid month short.
 *
 * A refund is the exception, and it arrives as a CANCELLATION too. See `isRefund`.
 */
const REVOKING_EVENTS = new Set(["EXPIRATION"]);
const EXTENDING_EVENTS = new Set(["SUBSCRIPTION_EXTENDED"]);

/**
 * Whether a CANCELLATION is a refund rather than a lapse.
 *
 * The money has gone back to the player, so whatever it bought should come back too. That
 * is not automated here: reputation points are spent the moment they land, so clawing them
 * back can leave a negative balance or unwind a purchase two owners later. The event is
 * recorded and raised for a human, which is how the PayPal side already handles refunds.
 */
export const isRefund = (event: RevenueCatEvent): boolean =>
  event.type === "CANCELLATION" && event.cancel_reason === "CUSTOMER_SUPPORT";

export type EventAction = "grant" | "revoke" | "extend" | "ignore";

export const classifyEvent = (type: string): EventAction => {
  if (GRANTING_EVENTS.has(type)) return "grant";
  if (REVOKING_EVENTS.has(type)) return "revoke";
  if (EXTENDING_EVENTS.has(type)) return "extend";
  return "ignore";
};

/** Map only the two stores this app supports; never alias a new RevenueCat store to Apple. */
export const toStorePlatform = (
  store: string | null | undefined,
): StorePlatform | undefined => {
  if (store === "APP_STORE") return "APPLE";
  if (store === "PLAY_STORE") return "GOOGLE";
  return undefined;
};

/** Resolve RevenueCat's dashboard app identifier against the configured native apps. */
export const storePlatformFromAppId = (
  appId: string | null | undefined,
  iosAppId: string | null | undefined,
  androidAppId: string | null | undefined,
): StorePlatform | undefined => {
  if (!appId) return undefined;
  if (iosAppId && appId === iosAppId) return "APPLE";
  if (androidAppId && appId === androidAppId) return "GOOGLE";
  return undefined;
};

export type TransferStoreResolution =
  | { status: "mapped"; store: StorePlatform }
  | { status: "legacy" }
  | { status: "unsupported-store"; value: string }
  | { status: "unknown-app"; value: string };

/**
 * Resolve a storeless TRANSFER without letting a present but unknown discriminator leak
 * across both stores. The both-store fallback is reserved for old payloads that contain
 * neither field at all.
 */
export const resolveTransferStore = (
  store: string | null | undefined,
  appId: string | null | undefined,
  iosAppId: string | null | undefined,
  androidAppId: string | null | undefined,
): TransferStoreResolution => {
  if (store !== null && store !== undefined) {
    const mapped = toStorePlatform(store);
    return mapped
      ? { status: "mapped", store: mapped }
      : { status: "unsupported-store", value: store };
  }
  if (appId !== null && appId !== undefined) {
    const mapped = storePlatformFromAppId(appId, iosAppId, androidAppId);
    return mapped
      ? { status: "mapped", store: mapped }
      : { status: "unknown-app", value: appId };
  }
  return { status: "legacy" };
};

export const isSandbox = (environment: string | null | undefined): boolean =>
  environment?.toUpperCase() === "SANDBOX";

/**
 * The transaction id is the idempotency key, and some event types omit it. The event id is
 * unique per event, so it is a safe stand-in: a retry of the same delivery repeats it.
 */
export const idempotencyKey = (event: RevenueCatEvent): string =>
  event.transaction_id ?? `event:${event.id}`;

/** Constant-time comparison, so a wrong secret cannot be found a byte at a time. */
/**
 * When the event actually happened.
 *
 * RevenueCat retries for days and can deliver out of order, so "now" is not a safe stand-in
 * for the moment an expiry took effect. Falls back to now only if the field is absent.
 */
export const occurredAt = (event: RevenueCatEvent): Date =>
  event.expiration_at_ms
    ? new Date(event.expiration_at_ms)
    : event.event_timestamp_ms
      ? new Date(event.event_timestamp_ms)
      : new Date();

/**
 * A transfer cutoff must be stable across retries. RevenueCat's event id deduplicates a
 * delivery, but it cannot recover chronology when the payload omitted its event time.
 */
export const transferOccurredAt = (event: RevenueCatEvent): Date | null =>
  event.event_timestamp_ms ? new Date(event.event_timestamp_ms) : null;

/** Start of the transaction's billing period, used to order receipts across retries. */
export const purchasedAt = (event: RevenueCatEvent): Date =>
  event.purchased_at_ms
    ? new Date(event.purchased_at_ms)
    : event.event_timestamp_ms
      ? new Date(event.event_timestamp_ms)
      : new Date();

/** The current paid-through date when RevenueCat provides one. */
export const expirationAt = (event: RevenueCatEvent): Date | null =>
  event.expiration_at_ms ? new Date(event.expiration_at_ms) : null;

/**
 * The last instant RevenueCat says an entitlement remains active.
 *
 * BILLING_ISSUE is the only normal event carrying a grace-period end, but taking the
 * maximum here also makes delayed or hand-built payloads fail closed around the same
 * paid-through definition.
 */
export const paidThroughAt = (event: RevenueCatEvent): Date | null => {
  const timestamps = [
    event.expiration_at_ms,
    event.grace_period_expiration_at_ms,
  ].filter((timestamp): timestamp is number => typeof timestamp === "number");
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;
};

export const isAuthorized = (
  header: string | null,
  secret: string | undefined,
): boolean => {
  if (!secret || !header) return false;
  const provided = Buffer.from(header);
  const expected = Buffer.from(secret);
  // timingSafeEqual throws on a length mismatch, which would itself leak the length.
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
};
