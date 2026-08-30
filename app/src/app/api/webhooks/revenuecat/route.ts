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
  isSandbox,
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

  try {
    if (action === "revoke") {
      await revokeFederalStatus(drizzleDB, event.app_user_id);
      return Response.json({ handled: "revoked" });
    }
    if (action === "grant" && event.product_id) {
      const outcome = await grantStorePurchase(drizzleDB, {
        userId: event.app_user_id,
        transactionId: idempotencyKey(event),
        productId: event.product_id,
        store: toStorePlatform(event.store),
        isSandbox: isSandbox(event.environment),
        raw: body,
      });
      return Response.json({ handled: outcome.status });
    }
    return Response.json({ handled: "ignored" });
  } catch (error) {
    Sentry.captureException(error, {
      level: "error",
      tags: { source: "revenuecatWebhook" },
      extra: { eventType: event.type, appUserId: event.app_user_id },
    });
    // 5xx so RevenueCat retries something that might be transient.
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
