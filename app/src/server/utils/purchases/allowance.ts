import { eq, sql } from "drizzle-orm";
import {
  paypalTransaction,
  stripeCheckout,
  stripePayment,
  userData,
} from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import type { DrizzleClient } from "@/server/db";

// Send a fixed deadline to Stripe and retain an extra hour for payment reconciliation.
// Leave thirty-one minutes for Stripe's creation minimum when resuming a lost response.
export const STRIPE_CHECKOUT_LIFETIME_SECONDS = 24 * 60 * 60;
export const STRIPE_CHECKOUT_RESERVATION_SECONDS =
  STRIPE_CHECKOUT_LIFETIME_SECONDS + 60 * 60;
export const STRIPE_CHECKOUT_RETRY_SECONDS = STRIPE_CHECKOUT_LIFETIME_SECONDS - 31 * 60;

/** Count delivered purchases and unfinished orders in one consistent snapshot. */
export const reputationAllowanceUsed = async (
  client: DrizzleClient,
  buyerId: string,
  excludedPaypalId = "",
  excludedStripeId = "",
) => {
  const [row] = await client
    .select({
      total: sql<number>`
    COALESCE((SELECT SUM(p.reputationPoints) FROM ${paypalTransaction} p
      WHERE p.createdById = ${buyerId} AND p.id != ${excludedPaypalId}
        AND p.createdAt >= NOW() - INTERVAL 30 DAY
        AND p.status NOT IN ('CANCELLED', 'REVIEW_REQUIRED')
        AND (p.status != 'RESERVED' OR p.createdAt >= NOW() - INTERVAL 3 HOUR)), 0)
    + COALESCE((SELECT SUM(p.reputationPoints) FROM ${stripePayment} p
      WHERE p.createdById = ${buyerId} AND p.grantedAt IS NOT NULL
        ${env.NODE_ENV === "production" ? sql`AND p.isSandbox = FALSE` : sql``}
        AND p.purchasedAt >= NOW() - INTERVAL 30 DAY), 0)
    + COALESCE((SELECT SUM(c.reputationPoints) FROM ${stripeCheckout} c
      WHERE c.createdById = ${buyerId} AND c.id != ${excludedStripeId}
        AND c.closedAt IS NULL AND c.createdAt >= NOW() - INTERVAL ${STRIPE_CHECKOUT_RESERVATION_SECONDS} SECOND
        AND NOT EXISTS (SELECT 1 FROM ${stripePayment} p
          WHERE p.checkoutId = c.id AND p.grantedAt IS NOT NULL)), 0)
  `.mapWith(Number),
    })
    .from(userData)
    .where(eq(userData.userId, buyerId));
  return row?.total ?? 0;
};

/** Serialize cross-provider allowance changes on the buyer row without missing-row locks. */
export const lockPurchaseBuyer = async (client: DrizzleClient, buyerId: string) => {
  const locked = await client
    .update(userData)
    .set({
      updatedAt: sql`GREATEST(CURRENT_TIMESTAMP(3), ${userData.updatedAt} + INTERVAL 1000 MICROSECOND)`,
    })
    .where(eq(userData.userId, buyerId));
  if (locked.rowsAffected !== 1) return undefined;
  return client.query.userData.findFirst({ where: eq(userData.userId, buyerId) });
};
