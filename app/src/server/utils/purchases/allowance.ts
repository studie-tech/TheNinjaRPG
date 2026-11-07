import { findUserById } from "@/queries/profile";
import {
  selectUserDataForReputationAllowanceUsed,
  updateUserDataForLockPurchaseBuyer,
} from "@/queries/purchases";
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
  {
    excludePaypalId = "",
    excludeStripeCheckoutId = "",
    excludeStoreOrderId = "",
  }: {
    excludePaypalId?: string;
    excludeStripeCheckoutId?: string;
    excludeStoreOrderId?: string;
  } = {},
) => {
  const [row] = await selectUserDataForReputationAllowanceUsed(
    client,
    buyerId,
    excludePaypalId,
    excludeStripeCheckoutId,
    STRIPE_CHECKOUT_RESERVATION_SECONDS,
    excludeStoreOrderId,
  );
  return row?.total ?? 0;
};

/**
 * Serialize cross-provider allowance changes on an existing buyer within a transaction.
 * The lock must precede the allowance snapshot and its reservation/delivery write; it
 * is not a standalone claim and must not be released between those operations.
 */
export const lockPurchaseBuyer = async (client: DrizzleClient, buyerId: string) => {
  const locked = await updateUserDataForLockPurchaseBuyer(client, buyerId);
  if (locked.rowsAffected !== 1) return undefined;
  return findUserById(client, buyerId);
};
