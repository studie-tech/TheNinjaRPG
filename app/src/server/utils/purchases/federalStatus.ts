/**
 * The federal tier a player holds, derived across PayPal, Stripe and store receipts.
 */

import {
  and,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import {
  type FederalStatus,
  FederalStatuses,
  PAYPAL_PAID_PERIOD_DAYS,
  STORE_RECEIPT_FALLBACK_DAYS,
} from "@/drizzle/constants";
import {
  paypalSubscription,
  storePurchase,
  stripePayment,
  userData,
} from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import {
  executeRowsForReconcileFederalStatuses,
  listPaypalSubscriptionForPaypalFederalFloor,
  selectUserDataForReconcileFederalStatuses,
  updateUserDataForSetFederalStatusWithStoreFloor,
  userFederalRankSql,
} from "@/queries/purchases";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { DAY_S } from "@/utils/time";

/**
 * Whether sandbox receipts count for this account.
 *
 * Set STORE_SANDBOX_USER_IDS, as a release step, to the demo account App Review is given
 * before submitting. Unset, sandbox purchases grant nothing at all, which is the safe
 * default for an ordinary deployment.
 */
export const isSandboxGrantee = (userId: string): boolean =>
  sandboxGranteeUserIds().includes(userId);

/** Where a status sits on the ladder, so two sources can be compared. */
export const rankOf = (status: FederalStatus): number =>
  FederalStatuses.indexOf(status);

/** Recompute a player's tier from everything that vouches for it now. */
export const rederiveFederalStatus = async (client: DrizzleClient, userId: string) => {
  const paypal = await paypalFederalFloor(client, userId);
  await setFederalStatusWithStoreFloor(client, userId, paypal);
};

/**
 * Set the shared federal-status column without leaving a gap between reading the store
 * receipts and writing the user. Store grants update the receipt and user in one statement
 * too, so both writers serialize on the user row: whichever runs last sees the other's
 * committed source of truth instead of applying a stale pre-read value.
 */
export const setFederalStatusWithStoreFloor = async (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  paypalStatus: FederalStatus,
) => {
  const sandboxRule = isSandboxGrantee(userId)
    ? undefined
    : eq(storePurchase.isSandbox, false);
  // Only when the caller reports no PayPal tier at all. That is the case the grace exists
  // for: paypalFederalFloor counts only ACTIVE rows, so a web cancellation reads as NONE
  // while the period the player paid for is still running. A caller naming a real tier is
  // asserting one; other current ACTIVE subscriptions are independently protected by
  // tierEvidence, while this grace only preserves coverage when no PayPal tier was supplied.
  // Without it, a store grant, revocation or transfer arriving inside that window writes
  // NONE, and the reconcile deliberately never restores a cleared tier.
  const paypalGrace = (tier: FederalStatus) =>
    paypalStatus === "NONE" ? paidPaypalPeriodGrace(userId, tier) : sql`FALSE`;

  return await updateUserDataForSetFederalStatusWithStoreFloor(
    client,
    rankOf(paypalStatus),
    rankOf,
    (tier) => tierEvidence(userId, tier, sandboxRule),
    paypalGrace,
    userId,
  );
};

/**
 * Re-derive every non-NONE or currently subscribed player's tier in one correlated write.
 *
 * This is the bulk cleaner counterpart of `setFederalStatusWithStoreFloor`: GOLD wins over
 * SILVER, which wins over NORMAL, across active PayPal rows, paid Stripe periods and live store receipts.
 * It therefore performs downgrades as well as clearing or restoring a status.
 */
export const reconcileFederalStatuses = async (
  client: Pick<DrizzleClient, "select" | "execute">,
) => {
  const sandboxUserIds = sandboxGranteeUserIds();
  const sandboxRule = or(
    eq(storePurchase.isSandbox, false),
    sandboxUserIds.length ? inArray(storePurchase.userId, sandboxUserIds) : undefined,
  );
  const tierCases = FederalStatuses.slice(1)
    .reverse()
    .map(
      (tier) => sql`WHEN ${tierEvidence(userData.userId, tier, sandboxRule)}
        OR ${paidPaypalPeriodGrace(userData.userId, tier)} THEN ${tier}`,
    );
  const federalStatus = sql`CASE ${sql.join(tierCases, sql` `)} ELSE 'NONE' END`;
  const eligible = sql`(${userData.federalStatus} != 'NONE'
      OR EXISTS (SELECT 1 FROM ${stripePayment} WHERE ${liveStripePeriod(userData.userId)})
      OR EXISTS (SELECT 1 FROM ${paypalSubscription} WHERE ${activePaypalRow(userData.userId)})
      OR EXISTS (
        SELECT 1 FROM ${storePurchase}
        WHERE ${liveStoreReceipt(userData.userId, sandboxRule)}
          AND ${storePurchase.federalStatus} IS NOT NULL
      ))`;
  // Discover candidates with a consistent read, then evaluate the latest receipts
  // and tier in each bounded write so concurrent grants/revocations still win.
  const candidates = await selectUserDataForReconcileFederalStatuses(client, eligible);
  for (let offset = 0; offset < candidates.length; offset += 1000) {
    const ids = candidates.slice(offset, offset + 1000).map(({ userId }) => userId);
    await retryOnDeadlock(() =>
      executeRowsForReconcileFederalStatuses(client, federalStatus, ids, eligible),
    );
  }
};

/** Read the configured allowlist for sandbox-only federal-status grants. */
const sandboxGranteeUserIds = (): string[] =>
  (env.STORE_SANDBOX_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

/** How long an ACTIVE PayPal row vouches for its tier after its last payment. */
const PAYPAL_WINDOW_MS = PAYPAL_PAID_PERIOD_DAYS * DAY_S * 1000;

/** Select the strongest verified federal tier, defaulting to NONE when no grants apply. */
const highest = (statuses: FederalStatus[]): FederalStatus =>
  statuses.reduce<FederalStatus>(
    (best, status) => (rankOf(status) > rankOf(best) ? status : best),
    "NONE",
  );

/**
 * The tier PayPal still vouches for, or `NONE`.
 *
 * ACTIVE and inside the window, because `/api/subscriptions` writes the plan's tier onto a
 * row whatever PayPal says its status is, and refreshes `updatedAt` while doing it — so a
 * cancelled subscription still looks current if you go by the tier and the timestamp
 * alone.
 *
 * The maximum rather than an arbitrary row: a player can hold more than one subscription,
 * and picking whichever the database returned first could hand back the cheaper tier and
 * strip what they are paying for.
 */
const paypalFederalFloor = async (
  client: DrizzleClient,
  userId: string,
): Promise<FederalStatus> => {
  const rows = await listPaypalSubscriptionForPaypalFederalFloor(
    client,
    userId,
    PAYPAL_WINDOW_MS,
  );
  return highest(rows.map((row) => row.federalStatus));
};

/** The player a tier predicate is about: one bound id, or the row of the enclosing UPDATE. */
type UserReference = string | typeof userData.userId;

const databaseNow = sql`CURRENT_TIMESTAMP(3)`;
const paypalWindowStart = sql`${databaseNow} - INTERVAL ${PAYPAL_PAID_PERIOD_DAYS} DAY`;

/** Treat a recent active PayPal subscription row as tier evidence. */
const activePaypalRow = (user: UserReference) =>
  and(
    eq(paypalSubscription.affectedUserId, user),
    eq(paypalSubscription.status, "ACTIVE"),
    gte(paypalSubscription.updatedAt, paypalWindowStart),
  );

/** Match granted Stripe periods that entitle the account on the database clock. */
const liveStripePeriod = (user: UserReference) =>
  and(
    eq(stripePayment.affectedUserId, user),
    isNotNull(stripePayment.grantedAt),
    env.NODE_ENV === "production" ? eq(stripePayment.isSandbox, false) : undefined,
    lte(stripePayment.purchasedAt, databaseNow),
    gt(stripePayment.expiresAt, databaseNow),
  );

/**
 * A receipt with no expiry falls back to a window wider than PayPal's, because a receipt is
 * the only evidence there is and a subscription can go a long time without producing one. A
 * failed renewal opens a billing-retry grace period — up to 16 days on the App Store and 30
 * on Play — during which the player is still entitled and no RENEWAL arrives. A monthly
 * cycle plus that grace exceeds 31 days, so the narrower window would strip someone the
 * store still considers a subscriber. Revocation does not depend on this: EXPIRATION
 * revokes on the event, and this window is only the backstop for a webhook that never
 * arrived.
 */
const liveStoreReceipt = (user: UserReference, sandboxRule: SQL | undefined) =>
  and(
    eq(storePurchase.userId, user),
    isNotNull(storePurchase.acceptedAt),
    sandboxRule,
    isNull(storePurchase.revokedAt),
    or(
      gte(storePurchase.expiresAt, databaseNow),
      and(
        isNull(storePurchase.expiresAt),
        gte(
          storePurchase.createdAt,
          sql`${databaseNow} - INTERVAL ${STORE_RECEIPT_FALLBACK_DAYS} DAY`,
        ),
      ),
    ),
  );

/** Whether an active PayPal row, a live store receipt or a paid Stripe period vouches. */
const tierEvidence = (
  user: UserReference,
  tier: FederalStatus,
  sandboxRule: SQL | undefined,
) => sql`EXISTS (
    SELECT 1 FROM ${paypalSubscription}
    WHERE ${activePaypalRow(user)} AND ${paypalSubscription.federalStatus} = ${tier}
  ) OR EXISTS (
    SELECT 1 FROM ${storePurchase}
    WHERE ${liveStoreReceipt(user, sandboxRule)} AND ${storePurchase.federalStatus} = ${tier}
  ) OR EXISTS (
    SELECT 1 FROM ${stripePayment}
    WHERE ${liveStripePeriod(user)}
      AND COALESCE(${stripePayment.federalStatusOverride}, ${stripePayment.federalStatus}) = ${tier}
  )`;

/**
 * Cancelling on the web sets status without moving updatedAt, and the player has already
 * paid through the period. Bounded by the tier they currently hold, so it can only keep what
 * they have -- never hand a tier back to someone the reconcile has already cleared, which is
 * what the ACTIVE predicate above is guarding. "At least", not "exactly", so a store receipt
 * sitting above the PayPal tier does not hide the paid period underneath it when that
 * receipt ends.
 */
const paidPaypalPeriodGrace = (user: UserReference, tier: FederalStatus) =>
  sql`(${userFederalRankSql()} >= ${rankOf(tier) + 1} AND EXISTS (
    SELECT 1 FROM ${paypalSubscription}
    WHERE ${paypalSubscription.affectedUserId} = ${user}
      AND ${paypalSubscription.updatedAt} >= ${paypalWindowStart}
      AND ${paypalSubscription.federalStatus} = ${tier}
  ))`;
