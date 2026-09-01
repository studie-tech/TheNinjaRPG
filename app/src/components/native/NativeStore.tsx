"use client";

import { Loader2, RotateCcw, ShoppingCart } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { env } from "@/env/client.mjs";
import { useNativeShell } from "@/hooks/useNativeShell";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { platform, purchases } from "@/libs/native";
import {
  hasSettledNewPurchase,
  isPendingStorePurchase,
} from "@/libs/native/purchaseSettlement";
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
  const { data: userData, userId } = useUserData();
  // The profile query keeps its last result once it is disabled, so cached userData
  // outlives the session. Treating it as the current player would leave the store up and
  // buyable after a sign-out has already logged RevenueCat out, and the purchase would
  // reach a webhook with nobody to credit.
  const player = userId && userData?.userId === userId ? userData : undefined;
  const utils = api.useUtils();
  const [packageState, setPackageState] = useState<{
    userId: string;
    packages: purchases.StorePackage[];
    bound: boolean;
  } | null>(null);
  const bindingGeneration = useRef(0);
  const [busyProduct, setBusyProduct] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const { data: catalogue } = api.purchases.catalogue.useQuery(undefined, {
    enabled: isNativeShell === true,
  });
  const { data: recent, refetch: refetchRecent } = api.purchases.recent.useQuery(
    { limit: 5 },
    { enabled: isNativeShell === true },
  );
  const pendingProductIds = new Set(
    recent?.filter(isPendingStorePurchase).map((purchase) => purchase.productId),
  );
  const hasPendingPurchase = pendingProductIds.size > 0;

  const storePlatform = platform();
  const apiKey =
    storePlatform === "ios"
      ? env.NEXT_PUBLIC_REVENUECAT_IOS_KEY
      : env.NEXT_PUBLIC_REVENUECAT_ANDROID_KEY;

  // Binding the SDK to the player's own id is what lets the webhook know who to credit;
  // without it a purchase is validated and then dropped.
  useEffect(() => {
    const generation = ++bindingGeneration.current;
    const accountId = player?.userId;
    if (!isNativeShell || !accountId) return;
    if (!apiKey) {
      // isConfigured only reflects the server's webhook secret, so a build with that set
      // and the public SDK key missing would otherwise spin forever with no explanation.
      setPackageState({ userId: accountId, packages: [], bound: false });
      return;
    }
    // The native module owns the queue, so sign-out's logOut and another mounted store
    // participate in the same ordering rather than racing a component-local promise.
    const binding = purchases.bind(apiKey, accountId);
    void binding
      .then((packages) => {
        if (generation !== bindingGeneration.current) return;
        setPackageState({ userId: accountId, packages, bound: true });
      })
      .catch(() => {
        if (generation !== bindingGeneration.current) return;
        setPackageState({ userId: accountId, packages: [], bound: false });
      });
    return () => {
      if (generation === bindingGeneration.current) bindingGeneration.current += 1;
    };
  }, [apiKey, isNativeShell, player?.userId]);

  // Never expose packages fetched for the previous account, even for the render before
  // the new binding effect gets a chance to clear its state.
  const available =
    player && packageState?.userId === player.userId ? packageState : null;
  const packages = available?.packages ?? null;

  // A grant can be retried after the initial wait ends. Keep pending products disabled
  // and refresh both the receipt and profile when the retry finally settles.
  useEffect(() => {
    if (!hasPendingPurchase) return;
    const timer = window.setInterval(() => {
      void refetchRecent().then(({ data }) => {
        if (data && !data.some(isPendingStorePurchase)) {
          void utils.profile.getUser.invalidate();
        }
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [hasPendingPurchase, refetchRecent, utils]);

  /**
   * Wait for the webhook, then refetch the balance.
   *
   * The store confirming a purchase does not mean the player has been credited: the
   * grant is written by `/api/webhooks/revenuecat`, which arrives moments later.
   * Refetching immediately would read the pre-purchase balance and leave it on screen
   * until the next background poll — which is exactly what the toast promises will not
   * happen.
   *
   * A terminal purchase row is the signal that the webhook finished applying the grant.
   * Compared by id rather than by count, because `recent` is capped and a player at the
   * cap would never see the count grow.
   */
  const settleAfterPurchase = useCallback(
    async (previousNewestId: string | undefined) => {
      for (const delay of GRANT_POLL_DELAYS_MS) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        const { data } = await refetchRecent();
        if (hasSettledNewPurchase(data ?? [], previousNewestId)) break;
      }
      // Refetch regardless: if the webhook is slow or has failed, the player should still
      // see whatever the truth currently is rather than a frozen screen.
      await utils.profile.getUser.invalidate();
    },
    [refetchRecent, utils],
  );

  const buy = async (entry: purchases.StorePackage, productId: string) => {
    if (!available?.bound || available.userId !== player?.userId) return;
    const previousNewestId = recent?.[0]?.id;
    setBusyProduct(productId);
    try {
      const result = await purchases.purchase(entry);
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
    if (!available?.bound || available.userId !== player?.userId) return;
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
      if (info?.activeEntitlements.length) {
        // Restores replay transaction ids the server may already know, so a new recent-row
        // id is not a completion signal. Reconcile in the background without keeping the
        // restore control disabled for the full polling window.
        void settleAfterPurchase(previousNewestId).catch(() => undefined);
      } else {
        // There is no webhook to wait for. Refresh once and finish immediately.
        await Promise.all([refetchRecent(), utils.profile.getUser.invalidate()]);
      }
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
  if (!player) return <Loader explanation="Loading userdata" />;

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
      subtitle={`You have ${player.reputationPoints} reputation points`}
      alreadyHasH1
    >
      {packages === null ? (
        <Loader explanation="Loading store" />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="mb-1 font-medium text-sm">Reputation</p>
          {catalogue?.reputation.map((product) => {
            // The store's own localised price, so the player sees their currency.
            const listed = packages.find(
              (entry) =>
                purchases.productIdForPackage(entry, storePlatform) ===
                product.productId,
            );
            const isPending = pendingProductIds.has(product.productId);
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
                    {listed?.product.priceString ?? `$${product.usd.toFixed(2)}`}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={busyProduct !== null || isPending || !listed}
                  onClick={() => listed && void buy(listed, product.productId)}
                >
                  {busyProduct === product.productId || isPending ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <ShoppingCart className="mr-1 h-4 w-4" />
                  )}
                  {isPending ? "Crediting" : "Buy"}
                </Button>
              </div>
            );
          })}

          {catalogue?.federal && catalogue.federal.length > 0 && (
            <>
              <p className="mt-4 mb-1 font-medium text-sm">Federal support</p>
              {catalogue.federal.map((plan) => {
                const expectedProductId =
                  storePlatform === "android" ? plan.androidProductId : plan.productId;
                const listed = packages.find(
                  (entry) =>
                    purchases.productIdForPackage(entry, storePlatform) ===
                    expectedProductId,
                );
                const isCurrent = player.federalStatus === plan.federalStatus;
                const isPending = pendingProductIds.has(expectedProductId);
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
                        {listed?.product.priceString ?? "Monthly"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={isCurrent ? "outline" : "default"}
                      disabled={
                        busyProduct !== null || isPending || !listed || isCurrent
                      }
                      onClick={() => listed && void buy(listed, expectedProductId)}
                    >
                      {busyProduct === expectedProductId || isPending ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <ShoppingCart className="mr-1 h-4 w-4" />
                      )}
                      {isCurrent ? "Active" : isPending ? "Crediting" : "Subscribe"}
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

          {packages.length === 0 && (
            <p className="text-muted-foreground text-sm">
              The store is not responding right now. Please try again shortly.
            </p>
          )}

          {/* Apple rejects apps selling subscriptions or non-consumables without this. */}
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={isRestoring || !available?.bound}
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
