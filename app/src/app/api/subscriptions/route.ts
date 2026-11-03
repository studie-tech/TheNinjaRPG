import { handleEndpointError } from "@/libs/gamesettings";
import {
  listPaypalSubscriptionForGET,
  listPaypalSubscriptionForGET2,
  updatePaypalSubscriptionForGET,
} from "@/queries/paypal";
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

  // Create context and caller
  try {
    // PayPal subscriptions have orderIds; reputation subscriptions do not.
    const [paypalSubscriptions, repSubscriptions] = await Promise.all([
      listPaypalSubscriptionForGET(drizzleDB),
      listPaypalSubscriptionForGET2(drizzleDB),
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
      await updatePaypalSubscriptionForGET(drizzleDB, isDone, subscription);
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
    return handleEndpointError(cause, { endpoint: "/api/subscriptions" });
  }
}
