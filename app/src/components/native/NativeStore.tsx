"use client";

import { Loader2, RotateCcw, ShoppingCart } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { env } from "@/env/client.mjs";
import { useNativeShell } from "@/hooks/useNativeShell";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { platform, purchases } from "@/libs/native";
import { showMutationToast } from "@/libs/toast";
import { useUserData } from "@/utils/UserContext";

/**
 * Backoff while waiting for the grant webhook: roughly 21 seconds in total, which is
 * generous for a webhook that normally lands in one or two.
 */
const GRANT_POLL_DELAYS_MS = [1000, 2000, 3000, 5000, 5000, 5000];

/**
 * The in-app store.
 *
 * App Store guideline 3.1.1 requires digital goods to be sold through in-app purchase, so
 * the PayPal flow is not offered here at all. Nothing on this screen credits anything:
 * RevenueCat validates the receipt and the webhook moves the balance, which is why a
 * purchase shows as pending until the server catches up.
 */
export default function NativeStore() {
  const isNativeShell = useNativeShell();
  const { data: userData } = useUserData();
  const utils = api.useUtils();
  const [products, setProducts] = useState<purchases.StoreProduct[] | null>(null);
  const [busyProduct, setBusyProduct] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const { data: catalogue } = api.purchases.catalogue.useQuery(undefined, {
    enabled: isNativeShell,
  });
  const { data: recent, refetch: refetchRecent } = api.purchases.recent.useQuery(
    { limit: 5 },
    { enabled: isNativeShell },
  );

  const apiKey =
    platform() === "ios"
      ? env.NEXT_PUBLIC_REVENUECAT_IOS_KEY
      : env.NEXT_PUBLIC_REVENUECAT_ANDROID_KEY;

  // Binding the SDK to the player's own id is what lets the webhook know who to credit;
  // without it a purchase is validated and then dropped.
  useEffect(() => {
    if (!isNativeShell || !userData?.userId) return;
    if (!apiKey) {
      // isConfigured only reflects the server's webhook secret, so a build with that set
      // and the public SDK key missing would otherwise spin forever with no explanation.
      setProducts([]);
      return;
    }
    void purchases
      .configure(apiKey, userData.userId)
      .then(() => purchases.getProducts())
      .then(setProducts)
      .catch(() => setProducts([]));
  }, [apiKey, isNativeShell, userData?.userId]);

  /**
   * Wait for the webhook, then refetch the balance.
   *
   * The store confirming a purchase does not mean the player has been credited: the
   * grant is written by `/api/webhooks/revenuecat`, which arrives moments later.
   * Refetching immediately would read the pre-purchase balance and leave it on screen
   * until the next background poll — which is exactly what the toast promises will not
   * happen.
   *
   * The purchase row appearing is the signal that the webhook ran, so that is what is
   * polled. Compared by id rather than by count, because `recent` is capped and a player
   * at the cap would never see the count grow.
   */
  const settleAfterPurchase = useCallback(
    async (previousNewestId: string | undefined) => {
      for (const delay of GRANT_POLL_DELAYS_MS) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        const { data } = await refetchRecent();
        if (data?.[0]?.id && data[0].id !== previousNewestId) break;
      }
      // Refetch regardless: if the webhook is slow or has failed, the player should still
      // see whatever the truth currently is rather than a frozen screen.
      await utils.profile.getUser.invalidate();
    },
    [refetchRecent, utils],
  );

  const buy = async (product: purchases.StoreProduct) => {
    const previousNewestId = recent?.[0]?.id;
    setBusyProduct(product.identifier);
    try {
      const result = await purchases.purchase(product);
      if (result.status === "cancelled") return;
      if (result.status === "error") {
        showMutationToast({ success: false, message: result.message });
        return;
      }
      showMutationToast({
        success: true,
        message: "Purchase complete. Crediting your account...",
      });
      // Held busy across the wait so the player cannot buy the same tier twice while the
      // first grant is still in flight.
      await settleAfterPurchase(previousNewestId);
    } catch (error) {
      showMutationToast({
        success: false,
        message: error instanceof Error ? error.message : "The purchase failed",
      });
    } finally {
      // In `finally` because anything that escapes above would otherwise leave the button
      // disabled until the component remounts.
      setBusyProduct(null);
    }
  };

  const restore = async () => {
    const previousNewestId = recent?.[0]?.id;
    setIsRestoring(true);
    try {
      const info = await purchases.restore();
      showMutationToast({
        success: true,
        message: info?.activeEntitlements.length
          ? "Purchases restored."
          : "No previous purchases found for this store account.",
      });
      // A restore replays the same webhooks, so it waits on the same signal. When there
      // was nothing to restore the poll simply runs out and refetches anyway.
      await settleAfterPurchase(previousNewestId);
    } catch (error) {
      showMutationToast({
        success: false,
        message: error instanceof Error ? error.message : "The restore failed",
      });
    } finally {
      setIsRestoring(false);
    }
  };

  if (!isNativeShell) return null;
  if (!userData) return <Loader explanation="Loading userdata" />;

  if (catalogue && !catalogue.isConfigured) {
    return (
      <ContentBox title="Store" subtitle="Temporarily unavailable" alreadyHasH1>
        <p className="text-sm">
          In-app purchases are not set up on this build yet. Nothing will be charged.
        </p>
      </ContentBox>
    );
  }

  return (
    <ContentBox
      title="Store"
      subtitle={`You have ${userData.reputationPoints} reputation points`}
      alreadyHasH1
    >
      {products === null ? (
        <Loader explanation="Loading store" />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="mb-1 font-medium text-sm">Reputation</p>
          {catalogue?.reputation.map((product) => {
            // The store's own localised price, so the player sees their currency.
            const listed = products.find((p) => p.identifier === product.productId);
            return (
              <div
                key={product.productId}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div>
                  <p className="font-semibold text-sm">
                    {product.reputationPoints} reputation points
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {listed?.priceString ?? `$${product.usd.toFixed(2)}`}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={busyProduct !== null || !listed}
                  onClick={() => listed && void buy(listed)}
                >
                  {busyProduct === product.productId ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <ShoppingCart className="mr-1 h-4 w-4" />
                  )}
                  Buy
                </Button>
              </div>
            );
          })}

          {catalogue?.federal && catalogue.federal.length > 0 && (
            <>
              <p className="mt-4 mb-1 font-medium text-sm">Federal support</p>
              {catalogue.federal.map((plan) => {
                const listed = products.find((p) => p.identifier === plan.productId);
                const isCurrent = userData.federalStatus === plan.federalStatus;
                return (
                  <div
                    key={plan.productId}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div>
                      <p className="font-semibold text-sm">
                        {plan.federalStatus.charAt(0)}
                        {plan.federalStatus.slice(1).toLowerCase()}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {listed?.priceString ?? "Monthly"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={isCurrent ? "outline" : "default"}
                      disabled={busyProduct !== null || !listed || isCurrent}
                      onClick={() => listed && void buy(listed)}
                    >
                      {busyProduct === plan.productId ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <ShoppingCart className="mr-1 h-4 w-4" />
                      )}
                      {isCurrent ? "Active" : "Subscribe"}
                    </Button>
                  </div>
                );
              })}
              <p className="text-muted-foreground text-xs">
                Changing or cancelling a subscription is done in your store account,
                which is where it is billed.
              </p>
            </>
          )}

          {products.length === 0 && (
            <p className="text-muted-foreground text-sm">
              The store is not responding right now. Please try again shortly.
            </p>
          )}

          {/* Apple rejects apps selling subscriptions or non-consumables without this. */}
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={isRestoring}
            onClick={() => void restore()}
          >
            {isRestoring ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="mr-1 h-4 w-4" />
            )}
            Restore purchases
          </Button>

          {recent && recent.length > 0 && (
            <div className="mt-4">
              <p className="mb-1 font-medium text-sm">Recent purchases</p>
              <ul className="text-muted-foreground text-xs">
                {recent.map((purchase) => (
                  <li key={purchase.id} className="flex justify-between py-0.5">
                    <span>{purchase.productId}</span>
                    <span>
                      {purchase.federalStatus ?? `${purchase.reputationPoints} reps`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </ContentBox>
  );
}
