import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import { cookies } from "next/headers";
import { paypalTransaction, userData } from "@/drizzle/schema";
import { handleEndpointError, lockWithGameTimer } from "@/libs/gamesettings";
import { updateReps } from "@/routers/paypal";
import {
  getPaypalAccessToken,
  getPaypalTransactions,
  syncTransactions,
} from "@/server/api/routers/paypal";
import { drizzleDB } from "@/server/db";
import { dollars2reps } from "@/utils/paypal";

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check timer
  const response = await lockWithGameTimer(drizzleDB, 1, "h", "transaction-sync");
  if (response) return response;

  try {
    // Get token
    const token = await getPaypalAccessToken();

    // Get latest transactions
    const transactions = await getPaypalTransactions(new Date(), token);

    // Sync transactions & get messages
    const msgs = await syncTransactions(drizzleDB, transactions, token);

    // Get transactions where refereal reputation points have not been added
    const mainTransaction = alias(paypalTransaction, "mainTransaction");
    const refTransaction = alias(paypalTransaction, "refTransaction");
    const buyerUser = alias(userData, "buyerUserData");
    const recruiterUser = alias(userData, "recruiterUserData");
    const unawardedTransactions = await drizzleDB
      .select({
        originalTransactionId: mainTransaction.transactionId,
        createdById: mainTransaction.createdById,
        transactionUpdatedDate: mainTransaction.transactionUpdatedDate,
        invoiceId: mainTransaction.invoiceId,
        amount: mainTransaction.amount,
        currency: mainTransaction.currency,
        recruiterId: recruiterUser.userId,
        referalTransactionId: refTransaction.transactionId,
      })
      .from(mainTransaction)
      .leftJoin(buyerUser, eq(mainTransaction.createdById, buyerUser.userId))
      .leftJoin(recruiterUser, eq(buyerUser.recruiterId, recruiterUser.userId))
      .leftJoin(
        refTransaction,
        and(
          eq(mainTransaction.invoiceId, refTransaction.invoiceId),
          eq(refTransaction.affectedUserId, buyerUser.recruiterId),
        ),
      )
      .where(
        and(
          gt(mainTransaction.reputationPoints, 0),
          gt(mainTransaction.amount, 0),
          eq(mainTransaction.type, "REP_PURCHASE"),
          isNotNull(mainTransaction.invoiceId),
          isNotNull(buyerUser.recruiterId),
          isNull(refTransaction.id),
        ),
      );
    for (const transaction of unawardedTransactions) {
      if (transaction.createdById && transaction.recruiterId) {
        const referralBonus = Math.floor(dollars2reps(transaction.amount) * 0.1);
        msgs.push(`Add ${referralBonus} ref reps - invoiceId ${transaction.invoiceId}`);
        await updateReps({
          client: drizzleDB,
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
