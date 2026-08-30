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
    id: z.string(),
    app_user_id: z.string(),
    product_id: z.string().nullish(),
    /** Absent on some event types, in which case the event id stands in. */
    transaction_id: z.string().nullish(),
    store: z.string().nullish(),
    environment: z.string().nullish(),
    entitlement_ids: z.array(z.string()).nullish(),
  }),
});
export type RevenueCatEvent = z.infer<typeof revenueCatEventSchema>["event"];

/** Events that mean the player now owns something. */
const GRANTING_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "NON_RENEWING_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
]);

/**
 * Events that mean access has ended. CANCELLATION is deliberately absent: it means
 * auto-renew was switched off, and the player keeps what they paid for until EXPIRATION.
 */
const REVOKING_EVENTS = new Set(["EXPIRATION"]);

export type EventAction = "grant" | "revoke" | "ignore";

export const classifyEvent = (type: string): EventAction => {
  if (GRANTING_EVENTS.has(type)) return "grant";
  if (REVOKING_EVENTS.has(type)) return "revoke";
  return "ignore";
};

export const toStorePlatform = (store: string | null | undefined): StorePlatform =>
  store === "PLAY_STORE" ? "GOOGLE" : "APPLE";

export const isSandbox = (environment: string | null | undefined): boolean =>
  environment?.toUpperCase() === "SANDBOX";

/**
 * The transaction id is the idempotency key, and some event types omit it. The event id is
 * unique per event, so it is a safe stand-in: a retry of the same delivery repeats it.
 */
export const idempotencyKey = (event: RevenueCatEvent): string =>
  event.transaction_id ?? `event:${event.id}`;

/** Constant-time comparison, so a wrong secret cannot be found a byte at a time. */
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
