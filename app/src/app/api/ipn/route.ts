import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { nanoid } from "nanoid";
import { headers } from "next/headers";
import { paypalWebhookMessage } from "@/drizzle/schema";
import { getPaypalAccessToken } from "@/routers/paypal";
import { drizzleDB } from "@/server/db";

type IBody = {
  event_type: string;
  resource: {
    id: string;
    state: string;
    amount: {
      total: string;
      currency: string;
    };
  };
};

export async function GET(req: Request) {
  // Create context
  const body = (await req.json()) as IBody;

  // Verification of the webhook message
  const headersList = await headers();
  const token = await getPaypalAccessToken();
  const verification = {
    auth_algo: headersList.get("paypal-auth-algo"),
    cert_url: headersList.get("paypal-cert-url"),
    transmission_id: headersList.get("paypal-transmission-id"),
    transmission_sig: headersList.get("paypal-transmission-sig"),
    transmission_time: headersList.get("paypal-transmission-time"),
    webhook_id: "1EV68140AN4888416",
    webhook_event: body,
  };
  const verified = await verifyWebhookEvent({
    body: verification,
    token: token,
  });
  if (verified.verification_status !== "SUCCESS") {
    console.error(verified);
    return Response.json("Error with verification of event", { status: 500 });
  }

  // Handle the different events
  try {
    switch (body.event_type) {
      case "PAYMENT.SALE.COMPLETED":
        break;
      default:
        break;
    }
    await drizzleDB.insert(paypalWebhookMessage).values({
      id: nanoid(),
      rawData: body,
      eventType: body.event_type,
      handled: false,
    });
    return Response.json(`OK`);
  } catch (cause) {
    console.error(cause);
    if (cause instanceof TRPCError) {
      // An error from tRPC occured
      const httpCode = getHTTPStatusCodeFromError(cause);
      return Response.json(cause, { status: httpCode });
    }
    // Another error occured
    return Response.json("Internal server error", { status: 500 });
  }
}

/**
 * Fetch a paypal order
 */
export const verifyWebhookEvent = async (input: { body: unknown; token: string }) => {
  const order = await fetch(
    `${process.env.NEXT_PUBLIC_PAYPAL_URL}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.body),
    },
  )
    .then((response) => {
      return response.json();
    })
    .then((data: { verification_status: string }) => {
      return data;
    });
  return order;
};
