import * as Sentry from "@sentry/node";
import { headers } from "next/headers";
import { env } from "@/env/server.mjs";
import { drizzleDB } from "@/server/db";
import {
  extendStoreSubscription,
  grantStorePurchase,
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
  resolveTransferStore,
  revenueCatEventSchema,
  toStorePlatform,
  transferOccurredAt,
  transferSandboxScopes,
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
      const transferredAt = transferOccurredAt(event);
      if (!transferredAt) {
        // Using arrival time would create a new ownership epoch on every retry. This
        // payload is permanently ambiguous, so acknowledge it as malformed rather than
        // mutate ownership non-idempotently or ask RevenueCat to retry forever.
        return Response.json(
          { error: "TRANSFER event is missing event_timestamp_ms" },
          { status: 400 },
        );
      }
      const resolution = resolveTransferStore(
        event.store,
        event.app_id,
        env.REVENUECAT_IOS_APP_ID,
        env.REVENUECAT_ANDROID_APP_ID,
      );
      if (resolution.status === "unsupported-store") {
        return unsupportedStore(event.type, resolution.value);
      }
      if (resolution.status === "unknown-app") {
        // Configuration may be lagging a new RevenueCat app. A 5xx keeps this isolated
        // event retryable instead of silently applying it to both stores.
        throw new Error(`RevenueCat TRANSFER used unknown app_id ${resolution.value}`);
      }
      const outcomes = [];
      for (const sandboxScope of transferSandboxScopes(event.environment)) {
        outcomes.push(
          await transferStorePurchases(drizzleDB, {
            eventId: event.id,
            fromUserIds: event.transferred_from ?? [],
            toUserIds: event.transferred_to ?? [],
            store: resolution.status === "mapped" ? resolution.store : undefined,
            isSandbox: sandboxScope,
            occurredAt: transferredAt,
          }),
        );
      }
      const destinationUserIds = new Set(
        outcomes.map((outcome) => outcome.destinationUserId),
      );
      if (destinationUserIds.size !== 1) {
        throw new Error("RevenueCat TRANSFER resolved different environment owners");
      }
      return Response.json({
        handled: "transferred",
        destinationUserId: outcomes[0]?.destinationUserId,
        rowsAffected: outcomes.reduce(
          (total, outcome) => total + outcome.rowsAffected,
          0,
        ),
      });
    }
    if (!event.app_user_id) {
      Sentry.captureException(
        new Error(`RevenueCat ${event.type} without an app_user_id`),
        { level: "warning", tags: { source: "revenuecatWebhook" } },
      );
      return Response.json({ handled: "ignored" });
    }
    if (action === "revoke") {
      const store = toStorePlatform(event.store);
      if (!store) return unsupportedStore(event.type, event.store);
      await revokeFederalStatus(drizzleDB, appUserId, {
        eventId: event.id,
        occurredAt: occurredAt(event),
        productId: event.product_id,
        store,
        transactionId: event.transaction_id,
        isSandbox: isSandbox(event.environment),
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
        isSandbox: isSandbox(event.environment),
      });
      return Response.json({ handled: "extended" });
    }
    if (action === "extend") {
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
        isSandbox: isSandbox(event.environment),
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
