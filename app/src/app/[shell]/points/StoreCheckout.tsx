"use client";

import { sendGTMEvent } from "@next/third-parties/google";
import { PayPalButtons, usePayPalScriptReducer } from "@paypal/react-paypal-js";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
import { STORE_ORDER_RESERVATION_MINUTES } from "@/drizzle/constants";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";
import type { storeCheckoutSchema } from "@/validators/points";

/**
 * Drive server-priced checkout with recoverable feedback beside the payment controls.
 * Report pending work to the dialog and refresh buyer limits/inventory after delivery.
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
  const utils = api.useUtils();
  const { prepareUserUpdate, updateUser } = useRequiredUserData();
  const prepare = api.paypal.createStoreOrder.useMutation();
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
          updateUser(result.userPatch, { revision, delta: result.userDelta }),
          utils.paypal.getRecentRepsCount.invalidate(),
          utils.paypal.getPaypalTransactions.invalidate(),
          utils.paypal.getStoreBundles.invalidate(),
          utils.item.getUserItems.invalidate(),
          utils.item.getUserItemsWithVariants.invalidate(),
        ]);
    },
    onError: (error) =>
      setMessage(
        `${error.message} Use Lookup Transaction to retry delivery after payment.`,
      ),
  });
  const isPending = prepare.isPending || resolve.isPending;
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
            const result = await prepare.mutateAsync({ selection, recipientId });
            if (!result.success || !("orderId" in result)) {
              setMessage(result.message);
              throw new Error(result.message);
            }
            return result.orderId;
          }}
          onApprove={async (data) => {
            await resolve.mutateAsync({ orderId: data.orderID });
          }}
          onCancel={() =>
            setMessage(
              `Checkout cancelled. No purchase was delivered. Unused reservations for bundle slots or monthly allowance expire within ${STORE_ORDER_RESERVATION_MINUTES} minutes; retry then if blocked.`,
            )
          }
          onError={() =>
            setMessage(
              (current) =>
                current ??
                "Checkout could not be completed. Try again, or use Lookup Transaction if you were charged.",
            )
          }
        />
      )}
      {resolve.isPending && <Loader explanation="Delivering your purchase" />}
    </div>
  );
}
