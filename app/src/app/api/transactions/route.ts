import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { REFERRAL_REPUTATION_SHARE } from "@/drizzle/constants";
import { stripePayment } from "@/drizzle/schema";
import { handleEndpointError, lockWithGameTimer } from "@/libs/gamesettings";
import {
  creditPaypalReputation,
  insertPaypalTransactionForAwardPaypalReferral,
  insertRecruitmentRewardsForAwardPaypalReferral,
} from "@/queries/paypal";
import {
  executePaidForAwardStripeReferralReputation,
  insertRecruitmentRewardsForAwardStripeReferralReputation,
  selectMainTransactionForGET,
  selectStripePaymentForAwardStripeReferralReputation,
} from "@/queries/recruitment";
import { type DrizzleClient, drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import {
  getPaypalAccessToken,
  getPaypalTransactions,
} from "@/server/utils/paypal/client";
import { syncTransactions } from "@/server/utils/paypal/fulfillment";

/** Reconcile PayPal payments and award delivered PayPal/Stripe referrals on the hourly schedule. */
export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Check timer
  const response = await lockWithGameTimer(
    drizzleDB,
    "transaction-sync-1h",
    60 * 60_000,
  );
  if (response) return response;

  try {
    // Get token
    const token = await getPaypalAccessToken();

    // Get latest transactions
    const transactions = await getPaypalTransactions(new Date(), token);

    // Sync transactions & get messages
    const results = await syncTransactions(drizzleDB, transactions, token);
    const msgs = results.map((result) => result.message);

    // Get transactions where refereal reputation points have not been added

    const [unawardedTransactions, stripeMessages] = await Promise.all([
      selectMainTransactionForGET(drizzleDB),
      awardStripeReferralReputation(drizzleDB),
    ]);
    msgs.push(...stripeMessages);
    for (const transaction of unawardedTransactions) {
      if (transaction.createdById && transaction.recruiterId) {
        // Bundles can include ryo/items, so referral rewards use the reputation actually purchased.
        const referralBonus = Math.floor(
          transaction.reputationPoints * REFERRAL_REPUTATION_SHARE,
        );
        msgs.push(`Add ${referralBonus} ref reps - invoiceId ${transaction.invoiceId}`);
        await awardPaypalReferral(drizzleDB, {
          createdById: transaction.createdById,
          transactionId: transaction.originalTransactionId,
          transactionUpdatedDate: transaction.transactionUpdatedDate,
          orderId: nanoid(),
          affectedUserId: transaction.recruiterId,
          invoiceId: transaction.invoiceId,
          value: 0,
          currency: transaction.currency,
          status: "COMPLETED",
          reps: referralBonus,
          type: "REFERRAL",
          raw: {},
        });
      }
    }

    // Return information
    return Response.json(`OK. ${msgs.join(", ")}`);
  } catch (cause) {
    return await handleEndpointError(cause);
  }
}

/**
 * Record a recruiter's PayPal referral reward and credit it. Nothing here deduplicates: the
 * unawarded-transaction join, run under the cron's game timer, prevents double awards.
 */
const awardPaypalReferral = async (
  client: DrizzleClient,
  input: Parameters<typeof insertPaypalTransactionForAwardPaypalReferral>[1],
) => {
  await insertPaypalTransactionForAwardPaypalReferral(client, input);
  await insertRecruitmentRewardsForAwardPaypalReferral(client, input);
  await creditPaypalReputation(client, input);
};

/** Pay the buyer's recruiter once for each delivered Stripe reputation receipt. */
const awardStripeReferralReputation = async (client: DrizzleClient) => {
  const rewardId = sql<string>`CONCAT('stripe-referral:', SHA2(${stripePayment.id}, 256))`;
  const receipts = await selectStripePaymentForAwardStripeReferralReputation(
    client,
    rewardId,
  );
  const messages: string[] = [];
  for (const receipt of receipts) {
    const amount = Math.floor(receipt.reputationPoints * REFERRAL_REPUTATION_SHARE);
    if (amount === 0) continue;
    // The unique audit INSERT and balance increment must commit together; a guarded UPDATE
    // alone cannot create the durable reward claim without a schema change.
    const awarded = await retryOnDeadlock(() =>
      client.transaction(async (tx) => {
        const claim = await insertRecruitmentRewardsForAwardStripeReferralReputation(
          tx,
          receipt,
          amount,
        );
        if (claim.rowsAffected === 0) return false;
        const paid = await executePaidForAwardStripeReferralReputation(
          tx,
          amount,
          receipt,
        );
        if (paid.rowsAffected !== 1)
          throw new Error("Referral account changed while awarding Stripe reputation");
        return true;
      }),
    );
    if (awarded) messages.push(`Add ${amount} ref reps - Stripe ${receipt.rewardId}`);
  }
  return messages;
};
