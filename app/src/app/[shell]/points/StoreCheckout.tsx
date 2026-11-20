"use client";

import { sendGTMEvent } from "@next/third-parties/google";
import { PayPalButtons, usePayPalScriptReducer } from "@paypal/react-paypal-js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
import { useStoreDeliveryRefresh } from "@/hooks/useStoreDeliveryRefresh";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserInfo } from "@/utils/UserContext";
import type { storeCheckoutSchema } from "@/validators/points";

/**
 * Drive server-priced checkout with recoverable feedback beside the payment controls.
 * Report pending work to the dialog and refresh buyer limits/inventory after delivery.
 * While the PayPal window is open the dialog counts as pending, so a click or focus change
 * outside it cannot dismiss the dialog and unmount the buttons (which closes the window).
 * A window closed without approval, or an unmount, releases the reserved checkout.
 */
export function StoreCheckout({
  selection,
  recipientId,
  disabled = false,
  onPendingChange,
}: {
  selection: z.infer<typeof storeCheckoutSchema>["selection"];
  recipientId?: string;
  disabled?: boolean;
  onPendingChange?: (isPending: boolean) => void;
}) {
  const [{ isResolved, isRejected }] = usePayPalScriptReducer();
  const [message, setMessage] = useState<string>();
  const refreshStoreDelivery = useStoreDeliveryRefresh();
  const { prepareUserUpdate, updateUser } = useRequiredUserInfo();
  const utils = api.useUtils();
  const prepare = api.paypal.createStoreOrder.useMutation();
  // Snapshot id of the checkout whose PayPal window is open and not yet approved.
  const openCheckout = useRef<string | undefined>(undefined);
  const [isWindowOpen, setIsWindowOpen] = useState(false);
  const release = useCallback(() => {
    const checkoutId = openCheckout.current;
    openCheckout.current = undefined;
    setIsWindowOpen(false);
    if (checkoutId)
      void utils.client.paypal.releaseStoreOrder
        .mutate({ checkoutId })
        .catch(() => undefined);
  }, [utils]);
  // Closing the dialog unmounts the buttons (and PayPal's window): free that checkout too.
  const releaseRef = useRef<() => void>(undefined);
  useEffect(() => {
    releaseRef.current = release;
  }, [release]);
  useEffect(() => () => releaseRef.current?.(), []);
  const resolve = api.paypal.captureStoreOrder.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (result, _variables, revision) => {
      setMessage(result.message);
      showMutationToast(result);
      if (result.success && result.purchase) {
        const purchase = result.purchase;
        sendGTMEvent({ ecommerce: null });
        sendGTMEvent({
          event: "purchase",
          ecommerce: {
            transaction_id: purchase.transactionId,
            value: purchase.value,
            currency: purchase.currency,
            items: [
              {
                item_id: purchase.snapshotId,
                item_name: purchase.name,
                price: purchase.value,
                quantity: 1,
              },
            ],
          },
        });
      }
      if (result.success)
        await Promise.all([
          updateUser(result, { revision, delta: result.userDelta }),
          refreshStoreDelivery(),
        ]);
    },
    onError: (error) =>
      setMessage(
        `${error.message} Use Lookup Transaction to retry delivery after payment.`,
      ),
  });
  const isPending = prepare.isPending || resolve.isPending || isWindowOpen;
  useEffect(() => {
    onPendingChange?.(isPending);
    return () => onPendingChange?.(false);
  }, [isPending, onPendingChange]);
  return (
    <div className="space-y-2">
      {message && (
        <p role="status" className="rounded border p-3 text-sm">
          {message}
        </p>
      )}
      {isWindowOpen && !resolve.isPending && (
        <p role="status" className="border-primary rounded border p-3 text-sm">
          Finish paying in the PayPal window. Closing that window cancels this checkout,
          and you can start again right away.
        </p>
      )}
      {!process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ? (
        <p>PayPal checkout is temporarily unavailable. Please try again later.</p>
      ) : isRejected ? (
        <p role="alert">PayPal could not load. Refresh the page to try again.</p>
      ) : !isResolved ? (
        <Loader explanation="Loading PayPal checkout" />
      ) : (
        <PayPalButtons
          style={{ layout: "horizontal", tagline: false }}
          disabled={disabled || !recipientId || resolve.isPending}
          forceReRender={[JSON.stringify(selection), recipientId, disabled]}
          createOrder={async () => {
            setMessage(undefined);
            if (!recipientId) throw new Error("Choose a recipient");
            setIsWindowOpen(true);
            const result = await prepare
              .mutateAsync({ selection, recipientId })
              .catch((error: unknown) => {
                setIsWindowOpen(false);
                throw error;
              });
            if (!result.success || !("orderId" in result)) {
              setIsWindowOpen(false);
              setMessage(result.message);
              throw new Error(result.message);
            }
            openCheckout.current = result.checkoutId;
            return result.orderId;
          }}
          onApprove={async (data) => {
            // Approved payments keep their slot; capture claims it under lock.
            openCheckout.current = undefined;
            await resolve
              .mutateAsync({ orderId: data.orderID })
              .finally(() => setIsWindowOpen(false));
          }}
          onCancel={() => {
            release();
            setMessage(
              "Checkout cancelled. No payment was taken, and you can try again right away.",
            );
          }}
          onError={() => {
            release();
            setMessage(
              (current) =>
                current ??
                "Checkout could not be completed. Try again, or use Lookup Transaction if you were charged.",
            );
          }}
        />
      )}
      {resolve.isPending && <Loader explanation="Delivering your purchase" />}
    </div>
  );
}
