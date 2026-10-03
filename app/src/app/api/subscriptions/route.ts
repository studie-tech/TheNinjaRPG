import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { cookies } from "next/headers";
import { paypalSubscription } from "@/drizzle/schema";
import {
  getPaypalAccessToken,
  getPaypalSubscription,
  reconcilePaypalSubscription,
} from "@/server/api/routers/paypal";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { setFederalStatusWithStoreFloor } from "@/server/utils/purchases/grant";

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Create context and caller
  try {
    // PayPal subscriptions have orderIds; reputation subscriptions do not.
    const [paypalSubscriptions, repSubscriptions] = await Promise.all([
      drizzleDB.query.paypalSubscription.findMany({
        where: and(
          eq(paypalSubscription.status, "ACTIVE"),
          isNotNull(paypalSubscription.orderId),
          lte(
            paypalSubscription.updatedAt,
            new Date(Date.now() - 1000 * 60 * 60 * 24 * 31),
          ),
        ),
      }),
      drizzleDB.query.paypalSubscription.findMany({
        where: and(
          eq(paypalSubscription.status, "ACTIVE"),
          isNull(paypalSubscription.orderId),
          lte(
            paypalSubscription.updatedAt,
            new Date(Date.now() - 1000 * 60 * 60 * 24 * 31),
          ),
        ),
      }),
    ]);
    const token = paypalSubscriptions.length
      ? getPaypalAccessToken()
      : Promise.resolve("");
    const paypalUpdates = paypalSubscriptions.map(async (subscription) => {
      const paypalSub = await getPaypalSubscription(
        subscription.subscriptionId,
        await token,
      );
      const result = await reconcilePaypalSubscription({
        client: drizzleDB,
        subscription: paypalSub,
        subscriptionId: subscription.subscriptionId,
        orderId: subscription.orderId,
        expected: {
          createdById: subscription.createdById,
          affectedUserId: subscription.affectedUserId,
        },
      });
      if (!result.success) {
        // The recorded paid period is already expired. Clear only unsupported coverage;
        // another valid PayPal/Stripe/native period remains protected by the shared floor.
        await setFederalStatusWithStoreFloor(
          drizzleDB,
          subscription.affectedUserId,
          "NONE",
        );
        throw new Error(result.message);
      }
    });

    // Subscriptions without orderIds are from Reputation points
    const repUpdates = repSubscriptions.map(async (subscription) => {
      const isDone =
        new Date(subscription.updatedAt) <
        new Date(Date.now() - 1000 * 60 * 60 * 24 * 31);
      await drizzleDB
        .update(paypalSubscription)
        .set({
          status: isDone ? "CANCELLED" : "ACTIVE",
          // As above: the reputation-funded row's last-payment marker has to survive being
          // cancelled, or the tier outlives what was paid for.
          ...(isDone ? {} : { updatedAt: new Date() }),
        })
        .where(eq(paypalSubscription.id, subscription.id));
      await setFederalStatusWithStoreFloor(
        drizzleDB,
        subscription.affectedUserId,
        isDone ? "NONE" : subscription.federalStatus,
      );
    });
    const results = await Promise.allSettled([...paypalUpdates, ...repUpdates]);
    const failedUpdate = results.find((result) => result.status === "rejected");
    if (failedUpdate?.status === "rejected") throw failedUpdate.reason;
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
