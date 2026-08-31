import * as Sentry from "@sentry/node";
import { headers } from "next/headers";
import { env } from "@/env/server.mjs";
import { drizzleDB } from "@/server/db";
import {
  grantStorePurchase,
  revokeFederalStatus,
} from "@/server/utils/purchases/grant";
import {
  classifyEvent,
  idempotencyKey,
  isAuthorized,
  isRefund,
  isSandbox,
  occurredAt,
  revenueCatEventSchema,
  toStorePlatform,
} from "@/server/utils/purchases/revenuecat";

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

  // TRANSFER names `transferred_from`/`transferred_to` rather than an `app_user_id`, and
  // the Restore Purchases button can provoke one. There is nobody to credit without an
  // account id, so acknowledge it — a 400 would only stop RevenueCat retrying an event it
  // is never going to reshape — and raise it, because the entitlement has moved and the
  // receipts on this side have not followed it.
  if (!event.app_user_id) {
    Sentry.captureException(
      new Error(`RevenueCat ${event.type} without an app_user_id`),
      {
        level: "warning",
        tags: { source: "revenuecatWebhook" },
        extra: {
          eventType: event.type,
          transferredFrom: event.transferred_from,
          transferredTo: event.transferred_to,
        },
      },
    );
    return Response.json({ handled: "ignored" });
  }
  const appUserId = event.app_user_id;

  try {
    if (action === "revoke") {
      // A sandbox subscription never granted anything, so letting its expiry through
      // would strip a real status a tester also holds on the same account.
      if (isSandbox(event.environment)) {
        return Response.json({ handled: "ignored" });
      }
      await revokeFederalStatus(drizzleDB, appUserId, {
        occurredAt: occurredAt(event),
        productId: event.product_id,
        store: event.store ? toStorePlatform(event.store) : null,
      });
      return Response.json({ handled: "revoked" });
    }
    if (action === "grant" && event.product_id) {
      const outcome = await grantStorePurchase(drizzleDB, {
        userId: appUserId,
        transactionId: idempotencyKey(event),
        productId: event.product_id,
        store: toStorePlatform(event.store),
        isSandbox: isSandbox(event.environment),
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
