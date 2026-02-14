import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { cookies } from "next/headers";
import { paypalSubscription, userData } from "@/drizzle/schema";
import {
  getPaypalAccessToken,
  getPaypalSubscription,
} from "@/server/api/routers/paypal";
import { drizzleDB } from "@/server/db";
import { plan2FedStatus } from "@/utils/paypal";

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Create context and caller
  try {
    const token = await getPaypalAccessToken();

    // Subscriptions with orderId are from PayPal
    const paypalSubscriptions = await drizzleDB.query.paypalSubscription.findMany({
      where: and(
        eq(paypalSubscription.status, "ACTIVE"),
        isNotNull(paypalSubscription.orderId),
        lte(
          paypalSubscription.updatedAt,
          new Date(Date.now() - 1000 * 60 * 60 * 24 * 31),
        ),
      ),
    });
    void paypalSubscriptions.map(async (subscription) => {
      const paypalSub = await getPaypalSubscription(subscription.subscriptionId, token);
      if (paypalSub) {
        const paypalStatus = paypalSub.status;
        const newFedStatus = plan2FedStatus(paypalSub.plan_id);
        const isDone = !["CREATED", "ACTIVE"].includes(paypalStatus);
        // Update database
        await drizzleDB
          .update(paypalSubscription)
          .set({
            status: paypalStatus,
            federalStatus: newFedStatus,
            updatedAt: new Date(),
          })
          .where(eq(paypalSubscription.id, subscription.id));
        await drizzleDB
          .update(userData)
          .set({ federalStatus: isDone ? "NONE" : newFedStatus })
          .where(eq(userData.userId, subscription.affectedUserId));
      }
    });

    // Subscriptions without orderIds are from Reputation points
    const repSubscriptions = await drizzleDB.query.paypalSubscription.findMany({
      where: and(
        eq(paypalSubscription.status, "ACTIVE"),
        isNull(paypalSubscription.orderId),
        lte(
          paypalSubscription.updatedAt,
          new Date(Date.now() - 1000 * 60 * 60 * 24 * 31),
        ),
      ),
    });
    void repSubscriptions.map(async (subscription) => {
      const isDone =
        new Date(subscription.updatedAt) <
        new Date(Date.now() - 1000 * 60 * 60 * 24 * 31);
      await drizzleDB
        .update(paypalSubscription)
        .set({
          status: isDone ? "CANCELLED" : "ACTIVE",
          updatedAt: new Date(),
        })
        .where(eq(paypalSubscription.id, subscription.id));
      await drizzleDB
        .update(userData)
        .set({ federalStatus: isDone ? "NONE" : subscription.federalStatus })
        .where(eq(userData.userId, subscription.affectedUserId));
    });
    return Response.json(`OK`);
  } catch (cause) {
    console.error(cause);
    if (cause instanceof TRPCError) {
      const httpCode = getHTTPStatusCodeFromError(cause);
      return Response.json(cause, { status: httpCode });
    }
    return Response.json("Internal server error", { status: 500 });
  }
}
