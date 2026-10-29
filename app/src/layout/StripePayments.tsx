"use client";

import { CreditCard, LoaderCircle, Wallet } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { useRequiredUserData } from "@/utils/UserContext";
import type { stripePurchaseSchema } from "@/validators/stripe";

/** Open hosted checkout with a stable request identity across uncertain responses. */
export const StripeCheckoutButton = ({
  userId,
  purchase,
  disabled = false,
}: {
  userId: string;
  purchase: Purchase;
  disabled?: boolean;
}) => {
  const utils = api.useUtils();
  const { data: user } = useRequiredUserData();
  const { data: availability } = api.stripe.availability.useQuery();
  const [message, setMessage] = useState("");
  // A transport failure may hide a created session; retry its key instead of charging anew.
  const request = useRef({ key: "", id: nanoid() });
  const checkout = api.stripe.createCheckout.useMutation({
    onSuccess: (result) => {
      if (result.success && "url" in result && result.url)
        window.location.assign(result.url);
      else {
        setMessage(result.message);
        request.current = { key: "", id: nanoid() };
        void utils.stripe.getPendingCheckouts.invalidate();
      }
    },
    onError: () => {
      setMessage("Could not open Stripe checkout. Please try again.");
      void utils.stripe.getPendingCheckouts.invalidate();
    },
  });
  if (!availability?.enabled || !user) return null;
  return (
    <div className="my-2 text-center">
      <Button
        className="h-auto min-h-16 w-full flex-col gap-1 rounded-lg bg-[#635bff] px-3 py-2.5 text-white hover:bg-[#5145e5] focus-visible:ring-[#635bff]"
        aria-label="Pay with Stripe — cards, wallets and Link"
        aria-busy={checkout.isPending}
        title="Available payment methods depend on your device and location."
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
        {checkout.isPending ? (
          <span className="inline-flex items-center gap-2">
            <LoaderCircle
              className="h-4 w-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Opening checkout…
          </span>
        ) : (
          <>
            <span className="font-semibold">Pay with Stripe</span>
            <span
              className="inline-flex items-center gap-3 text-[10px] text-white/90"
              aria-hidden="true"
            >
              <span className="inline-flex items-center gap-1">
                <CreditCard className="h-3 w-3" />
                Cards
              </span>
              <span className="inline-flex items-center gap-1">
                <Wallet className="h-3 w-3" />
                Wallets
              </span>
              <span className="font-semibold italic">Link</span>
            </span>
          </>
        )}
      </Button>
      {message && (
        <p role="alert" className="mt-2 text-sm">
          {message}
        </p>
      )}
    </div>
  );
};

/** Resolve redirect status with visible retry and refresh receipts even for held payments. */
export const StripePaymentReturn = () => {
  const { prepareUserUpdate, updateUser } = useRequiredUserData();
  const utils = api.useUtils();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const started = useRef(false);
  const cancelCheckout = api.stripe.cancelCheckout.useMutation({
    onSuccess: async (result) => {
      setMessage(result.message);
      if (result.success)
        await Promise.all([
          utils.paypal.getRecentRepsCount.invalidate(),
          utils.stripe.getPendingCheckouts.invalidate(),
        ]);
    },
    onError: () =>
      setMessage("Could not close checkout yet. Please reload to try again."),
  });
  const resolve = api.stripe.resolveSession.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (result, _variables, revision) => {
      setMessage(result.message);
      // Held payments write receipts too; only successful delivery clears the retry URL.
      await Promise.all([
        utils.stripe.getPayments.invalidate(),
        utils.stripe.getPendingCheckouts.invalidate(),
        ...(result.success
          ? [
              updateUser(result.userPatch, { revision, delta: result.userDelta }),
              utils.paypal.getRecentRepsCount.invalidate(),
              utils.stripe.getSubscriptions.invalidate(),
            ]
          : []),
      ]);
      if (result.success) {
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

/** Resume or cancel saved payer reservations without changing their purchase terms. */
export const StripePendingCheckouts = () => {
  const utils = api.useUtils();
  const { data: user } = useRequiredUserData();
  const pending = api.stripe.getPendingCheckouts.useQuery();
  const [message, setMessage] = useState("");
  const resume = api.stripe.createCheckout.useMutation({
    onSuccess: (result) => {
      if (result.success && "url" in result && result.url)
        window.location.assign(result.url);
      else setMessage(result.message);
    },
    onError: () => setMessage("Could not open Stripe checkout. Please try again."),
  });
  const cancel = api.stripe.cancelCheckout.useMutation({
    onSuccess: async (result) => {
      setMessage(result.message);
      if (result.success)
        await Promise.all([
          utils.stripe.getPendingCheckouts.invalidate(),
          utils.paypal.getRecentRepsCount.invalidate(),
        ]);
    },
    onError: () => setMessage("Could not cancel checkout. Please try again."),
  });
  if (pending.isError)
    return (
      <p role="alert">
        Unfinished Stripe checkouts could not be loaded. Please reload to try again.
      </p>
    );
  if (!pending.data?.length || !user) return null;
  return (
    <ContentBox title="Unfinished Stripe checkouts" initialBreak={true}>
      {pending.data.map((checkout) => (
        <div
          className="my-2 flex flex-wrap items-center justify-between gap-2 rounded border p-2"
          key={checkout.id}
        >
          <p className="text-sm">
            {checkout.federalStatus === "NONE"
              ? `${checkout.reputationPoints} reputation points`
              : `${checkout.federalStatus} support`}
            {" · "}
            {checkout.recipientUsername ?? "Deleted character"}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={resume.isPending || cancel.isPending}
              onClick={() => {
                setMessage("");
                resume.mutate({
                  requestId: checkout.id,
                  expectedUserId: user.userId,
                  userId: checkout.affectedUserId,
                  purchase:
                    checkout.federalStatus === "NONE"
                      ? {
                          type: "reputation",
                          reputationPoints: checkout.reputationPoints,
                        }
                      : { type: "federal", federalStatus: checkout.federalStatus },
                });
              }}
            >
              Continue
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={resume.isPending || cancel.isPending}
              onClick={() => {
                setMessage("");
                cancel.mutate({ checkoutId: checkout.id });
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ))}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </ContentBox>
  );
};

/** Manage renewal separately from the paid support period and current recipient tier. */
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
            {subscription.federalStatus} —{" "}
            {subscription.status === "unavailable"
              ? "Status unavailable"
              : subscription.status}
            {subscription.cancelAtPeriodEnd ? " (renewal cancelled)" : ""}
          </p>
          <p className="text-xs">
            Recipient: {subscription.recipientUsername ?? "Deleted character"}
          </p>
          {subscription.status === "unavailable" && (
            <p role="alert" className="text-xs">
              Renewal status could not be checked. You can still try cancelling below.{" "}
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-xs"
                disabled={subscriptions.isFetching}
                onClick={() => void subscriptions.refetch()}
              >
                Retry
              </Button>
            </p>
          )}
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

/** Show a compact, progressively revealed receipt ledger with support references. */
export const StripePaymentHistory = () => {
  const [visibleCount, setVisibleCount] = useState(5);
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
      {payments.data.slice(0, visibleCount).map((payment) => (
        <div className="my-2 rounded border p-2" key={payment.id}>
          <p>
            ${(payment.amountCents / 100).toFixed(2)} USD —{" "}
            {payment.federalStatus === "NONE"
              ? `${payment.reputationPoints} reputation points`
              : `${payment.federalStatusOverride ?? payment.federalStatus} support`}
          </p>
          <p className="text-xs">
            {payment.id} ·{" "}
            {payment.grantedAt
              ? "Delivered"
              : payment.reviewRequired
                ? "Contact support for review or refund; no points delivered"
                : "Processing"}
            {payment.expiresAt
              ? ` · Paid through ${payment.expiresAt.toLocaleDateString()}`
              : ""}
          </p>
        </div>
      ))}
      {visibleCount < payments.data.length && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setVisibleCount((count) => count + 5)}
        >
          Show more
        </Button>
      )}
    </ContentBox>
  );
};

type Purchase = z.infer<typeof stripePurchaseSchema>;
