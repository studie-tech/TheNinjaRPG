import * as Sentry from "@sentry/nextjs";
import type Stripe from "stripe";
import { env } from "@/env/server.mjs";
import { drizzleDB } from "@/server/db";
import { getStripe, stripeIsLive } from "@/server/utils/stripe/client";
import {
  fulfillStripeInvoice,
  fulfillStripeSession,
} from "@/server/utils/stripe/fulfillment";

export async function POST(request: Request) {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET)
    return Response.json({ error: "Stripe webhook unavailable" }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing signature" }, { status: 400 });
  let event: Stripe.Event;
  try {
    // Verify the exact bytes before parsing or making any database queries.
    event = await getStripe().webhooks.constructEventAsync(
      await request.text(),
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }
  if (event.livemode !== stripeIsLive())
    return Response.json({ error: "Wrong Stripe environment" }, { status: 400 });
  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    )
      await fulfillStripeSession(drizzleDB, event.data.object.id);
    else if (event.type === "invoice.paid")
      await fulfillStripeInvoice(drizzleDB, event.data.object.id);
    else if (
      event.type === "charge.refunded" ||
      event.type === "charge.dispute.created"
    ) {
      // Points may already be spent. Staff resolves refunds/disputes without silently
      // producing negative balances or removing support bought through another provider.
      Sentry.captureMessage("Stripe payment needs refund/dispute review", {
        level: "warning",
        tags: { source: "stripeWebhook" },
        extra: {
          eventId: event.id,
          eventType: event.type,
          objectId: event.data.object.id,
        },
      });
    }
    return Response.json({ received: true });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "stripeWebhook" },
      extra: { eventId: event.id, eventType: event.type },
    });
    // Retry can complete an interrupted receipt claim or federal status reconciliation.
    return Response.json({ error: "Payment fulfillment failed" }, { status: 500 });
  }
}
