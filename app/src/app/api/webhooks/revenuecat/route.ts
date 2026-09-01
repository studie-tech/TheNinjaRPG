import * as Sentry from "@sentry/node";
import { headers } from "next/headers";
import { env } from "@/env/server.mjs";
import { drizzleDB } from "@/server/db";
import {
  extendStoreSubscription,
  grantStorePurchase,
  isSandboxGrantee,
  revokeFederalStatus,
  transferStorePurchases,
} from "@/server/utils/purchases/grant";
import {
  classifyEvent,
  idempotencyKey,
  isAuthorized,
  isRefund,
  isSandbox,
  occurredAt,
  paidThroughAt,
  purchasedAt,
  revenueCatEventSchema,
  toStorePlatform,
} from "@/server/utils/purchases/revenuecat";

const unsupportedStore = (eventType: string, store: string | null | undefined) => {
  Sentry.captureException(
    new Error(`RevenueCat ${eventType} used unsupported store ${store ?? "missing"}`),
    { level: "warning", tags: { source: "revenuecatWebhook" } },
  );
  // Retrying cannot turn an unsupported payload into a supported one.
  return Response.json({ handled: "ignored" });
};

/**
 * Grants entitlements bought through the App Store or Play Billing.
 *
 * This is the only place a store purchase becomes reputation or federal status. The client
 * never credits itself: RevenueCat validates the receipt with Apple or Google first, and
 * this endpoint is what the player's balance depends on.
 *
 * Anything other than a 5xx tells RevenueCat to stop retrying, so unknown and duplicate
 * events are acknowledged rather than failed — RevenueCat retries for days, and a
 * permanent failure on an event we simply do not handle would retry forever.
 */
export async function POST(request: Request) {
  const authorization = (await headers()).get("authorization");
  if (!isAuthorized(authorization, env.REVENUECAT_WEBHOOK_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = revenueCatEventSchema.safeParse(body);
  if (!parsed.success) {
    // Malformed and unretryable; 400 stops the retries.
    return Response.json({ error: "Malformed event" }, { status: 400 });
  }

  const { event } = parsed.data;
  const action = classifyEvent(event.type);

  const appUserId = event.app_user_id ?? event.transferred_to?.join(",") ?? "unknown";

  try {
    if (event.type === "TRANSFER") {
      const store = toStorePlatform(event.store);
      if (!store) return unsupportedStore(event.type, event.store);
      const outcome = await transferStorePurchases(drizzleDB, {
        fromUserIds: event.transferred_from ?? [],
        toUserIds: event.transferred_to ?? [],
        store,
      });
      return Response.json({ handled: "transferred", ...outcome });
    }
    if (!event.app_user_id) {
      Sentry.captureException(
        new Error(`RevenueCat ${event.type} without an app_user_id`),
        { level: "warning", tags: { source: "revenuecatWebhook" } },
      );
      return Response.json({ handled: "ignored" });
    }
    if (action === "revoke") {
      // A sandbox subscription normally granted nothing, so letting its expiry through
      // would strip a real status a tester also holds on the same account. An allowlisted
      // account is the exception: its sandbox purchase did grant, so its expiry must land.
      if (isSandbox(event.environment) && !isSandboxGrantee(appUserId)) {
        return Response.json({ handled: "ignored" });
      }
      const store = toStorePlatform(event.store);
      if (!store) return unsupportedStore(event.type, event.store);
      await revokeFederalStatus(drizzleDB, appUserId, {
        occurredAt: occurredAt(event),
        productId: event.product_id,
        store,
      });
      return Response.json({ handled: "revoked" });
    }
    if (event.type === "BILLING_ISSUE") {
      // RevenueCat keeps the entitlement active through an explicit store grace period.
      // Persist that boundary so reconciliation neither drops it early nor lets the
      // receipt live on the generic age fallback after the boundary has passed.
      const gracePeriodEndsAt = event.grace_period_expiration_at_ms
        ? new Date(event.grace_period_expiration_at_ms)
        : null;
      if (!gracePeriodEndsAt) return Response.json({ handled: "ignored" });
      if (isSandbox(event.environment) && !isSandboxGrantee(appUserId)) {
        return Response.json({ handled: "ignored" });
      }
      const store = toStorePlatform(event.store);
      if (!store) return unsupportedStore(event.type, event.store);
      if (!event.product_id) {
        throw new Error("RevenueCat billing issue is missing its product");
      }
      await extendStoreSubscription(drizzleDB, {
        userId: appUserId,
        store,
        productId: event.product_id,
        expirationAt: gracePeriodEndsAt,
        transactionId: event.transaction_id,
      });
      return Response.json({ handled: "extended" });
    }
    if (action === "extend") {
      if (isSandbox(event.environment) && !isSandboxGrantee(appUserId)) {
        return Response.json({ handled: "ignored" });
      }
      const store = toStorePlatform(event.store);
      if (!store) return unsupportedStore(event.type, event.store);
      if (!event.product_id) {
        throw new Error("RevenueCat extension is missing its store or product");
      }
      const expiresAt = paidThroughAt(event);
      if (!expiresAt) throw new Error("RevenueCat extension has no expiration");
      await extendStoreSubscription(drizzleDB, {
        userId: appUserId,
        store,
        productId: event.product_id,
        expirationAt: expiresAt,
        transactionId: event.transaction_id,
      });
      return Response.json({ handled: "extended" });
    }
    if (action === "grant" && event.product_id) {
      const store = toStorePlatform(event.store);
      if (!store) return unsupportedStore(event.type, event.store);
      const outcome = await grantStorePurchase(drizzleDB, {
        userId: appUserId,
        transactionId: idempotencyKey(event),
        productId: event.product_id,
        store,
        isSandbox: isSandbox(event.environment),
        purchasedAt: purchasedAt(event),
        expiresAt: paidThroughAt(event),
        raw: body,
      });
      return Response.json({ handled: outcome.status });
    }
    if (isRefund(event) && !isSandbox(event.environment)) {
      // Deliberately not reversed automatically — see isRefund. Raised so a human can.
      Sentry.captureException(new Error("Store purchase refunded"), {
        level: "warning",
        tags: { source: "revenuecatWebhook" },
        extra: {
          appUserId: event.app_user_id,
          productId: event.product_id,
          transactionId: idempotencyKey(event),
        },
      });
      return Response.json({ handled: "refund-flagged" });
    }
    return Response.json({ handled: "ignored" });
  } catch (error) {
    Sentry.captureException(error, {
      level: "error",
      tags: { source: "revenuecatWebhook" },
      extra: { eventType: event.type, appUserId },
    });
    // 5xx so RevenueCat retries something that might be transient.
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
