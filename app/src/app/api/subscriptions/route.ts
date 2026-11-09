import { PAYPAL_PAID_PERIOD_DAYS } from "@/drizzle/constants";
import { handleEndpointError } from "@/libs/gamesettings";
import {
  listPaypalSubscriptionForGET,
  updatePaypalSubscriptionForGET,
} from "@/queries/paypal";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import {
  getPaypalAccessToken,
  getPaypalSubscription,
} from "@/server/utils/paypal/client";
import { reconcilePaypalSubscription } from "@/server/utils/paypal/fulfillment";
import { setFederalStatusWithStoreFloor } from "@/server/utils/purchases/federalStatus";
import { DAY_S, secondsFromNow } from "@/utils/time";

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  try {
    // Rows whose last payment is older than one billing period. PayPal subscriptions
    // have orderIds; reputation subscriptions do not.
    const due = await listPaypalSubscriptionForGET(
      drizzleDB,
      secondsFromNow(-PAYPAL_PAID_PERIOD_DAYS * DAY_S),
    );
    const paypalSubscriptions = due.filter(
      (subscription) => subscription.orderId !== null,
    );
    const repSubscriptions = due.filter(
      (subscription) => subscription.orderId === null,
    );
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
      await updatePaypalSubscriptionForGET(drizzleDB, subscription);
      await setFederalStatusWithStoreFloor(
        drizzleDB,
        subscription.affectedUserId,
        "NONE",
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
