"use client";

import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { useRequiredUserData } from "@/utils/UserContext";
import type { stripeCheckoutSchema } from "@/validators/stripe";

type Purchase = z.infer<typeof stripeCheckoutSchema>["purchase"];

export const StripeCheckoutButton = ({
  userId,
  purchase,
  disabled = false,
}: {
  userId: string;
  purchase: Purchase;
  disabled?: boolean;
}) => {
  const { data: user } = useRequiredUserData();
  const { data: availability } = api.stripe.availability.useQuery();
  const [message, setMessage] = useState("");
  const request = useRef({ key: "", id: nanoid() });
  const checkout = api.stripe.createCheckout.useMutation({
    onSuccess: (result) => {
      if (result.success && "url" in result && result.url)
        window.location.assign(result.url);
      else {
        setMessage(result.message);
        request.current = { key: "", id: nanoid() };
      }
    },
    onError: () => setMessage("Could not open Stripe checkout. Please try again."),
  });
  if (!availability?.enabled || !user) return null;
  return (
    <div className="my-2 text-center">
      <Button
        className="w-full"
        disabled={disabled || checkout.isPending}
        onClick={() => {
          setMessage("");
          const key = JSON.stringify([user.userId, userId, purchase]);
          if (request.current.key !== key) request.current = { key, id: nanoid() };
          checkout.mutate({
            requestId: request.current.id,
            expectedUserId: user.userId,
            userId,
            purchase,
          });
        }}
      >
        {checkout.isPending ? "Opening checkout…" : "Pay by card with Stripe"}
      </Button>
      {purchase.type === "federal" && (
        <p className="mt-1 text-xs">
          Monthly subscription in USD. Renews until cancelled.
        </p>
      )}
      {message && (
        <p role="alert" className="mt-2 text-sm">
          {message}
        </p>
      )}
    </div>
  );
};

export const StripePaymentReturn = () => {
  const utils = api.useUtils();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const started = useRef(false);
  const cancelCheckout = api.stripe.cancelCheckout.useMutation({
    onSuccess: (result) => setMessage(result.message),
    onError: () =>
      setMessage("Could not close checkout yet. Please reload to try again."),
  });
  const resolve = api.stripe.resolveSession.useMutation({
    onSuccess: async (result) => {
      setMessage(result.message);
      if (result.success) {
        await Promise.all([
          utils.profile.getUser.invalidate(),
          utils.paypal.getRecentRepsCount.invalidate(),
          utils.stripe.getSubscriptions.invalidate(),
          utils.stripe.getPayments.invalidate(),
        ]);
        setSessionId(null);
        const url = new URL(window.location.href);
        url.searchParams.delete("stripe_session");
        window.history.replaceState(null, "", url.toString());
      }
    },
    onError: () =>
      setMessage(
        "We could not check your payment yet. Try again below. Confirmed payments are also delivered automatically.",
      ),
  });
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("stripe_session");
    if (id) {
      setSessionId(id);
      resolve.mutate({ sessionId: id });
    } else if (params.get("stripe_cancelled")) {
      setMessage("Closing cancelled checkout…");
      cancelCheckout.mutate({ checkoutId: params.get("stripe_cancelled") as string });
    }
  }, [resolve.mutate, cancelCheckout.mutate]);
  if (!sessionId && !message) return null;
  return (
    <ContentBox title="Stripe payment" initialBreak={true}>
      <p role="status">{resolve.isPending ? "Checking your payment…" : message}</p>
      {sessionId && (
        <Button
          className="mt-2"
          disabled={resolve.isPending}
          onClick={() => resolve.mutate({ sessionId })}
        >
          Check payment again
        </Button>
      )}
    </ContentBox>
  );
};

export const StripeSubscriptions = () => {
  const utils = api.useUtils();
  const subscriptions = api.stripe.getSubscriptions.useQuery();
  const [message, setMessage] = useState("");
  const cancel = api.stripe.cancelSubscription.useMutation({
    onSuccess: async (result) => {
      setMessage(result.message);
      if (result.success) await utils.stripe.getSubscriptions.invalidate();
    },
    onError: () => setMessage("Could not cancel renewal. Please try again."),
  });
  if (subscriptions.isError)
    return (
      <p role="alert">
        Stripe subscriptions could not be loaded. Please reload to manage renewal.
      </p>
    );
  if (subscriptions.isPending)
    return <Loader explanation="Loading Stripe subscriptions…" />;
  if (!subscriptions.data.length) return null;
  return (
    <ContentBox
      title="Stripe subscriptions"
      subtitle="Support you pay for or receive. Cancellation keeps the paid period."
      initialBreak={true}
    >
      {subscriptions.data.map((subscription) => (
        <div className="my-2 rounded border p-3" key={subscription.checkoutId}>
          <p>
            {subscription.federalStatus} — {subscription.status}
            {subscription.cancelAtPeriodEnd ? " (renewal cancelled)" : ""}
          </p>
          <p className="text-xs">Recipient: {subscription.affectedUserId}</p>
          {!subscription.cancelAtPeriodEnd &&
            !["canceled", "incomplete_expired"].includes(subscription.status) && (
              <Button
                className="mt-2"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate({ checkoutId: subscription.checkoutId })}
              >
                Cancel renewal
              </Button>
            )}
        </div>
      ))}
      {message && <p role="status">{message}</p>}
    </ContentBox>
  );
};

export const StripePaymentHistory = () => {
  const payments = api.stripe.getPayments.useQuery();
  if (payments.isError)
    return (
      <p role="alert">
        Stripe payment history could not be loaded. Please reload to try again.
      </p>
    );
  if (!payments.data?.length) return null;
  return (
    <ContentBox
      title="Stripe payment history"
      subtitle="Your most recent card payments, in USD."
      initialBreak={true}
    >
      {payments.data.map((payment) => (
        <div className="my-2 rounded border p-2" key={payment.id}>
          <p>
            ${(payment.amountCents / 100).toFixed(2)} USD —{" "}
            {payment.federalStatus === "NONE"
              ? `${payment.reputationPoints} reputation points`
              : `${payment.federalStatusOverride ?? payment.federalStatus} support`}
          </p>
          <p className="text-xs">
            {payment.id} · {payment.grantedAt ? "Delivered" : "Processing"}
            {payment.expiresAt
              ? ` · Paid through ${payment.expiresAt.toLocaleDateString()}`
              : ""}
          </p>
        </div>
      ))}
    </ContentBox>
  );
};
