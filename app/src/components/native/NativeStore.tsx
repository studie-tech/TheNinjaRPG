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
    if (!isNativeShell || !apiKey || !userData?.userId) return;
    void purchases
      .configure(apiKey, userData.userId)
      .then(() => purchases.getProducts())
      .then(setProducts)
      .catch(() => setProducts([]));
  }, [apiKey, isNativeShell, userData?.userId]);

  /**
   * The grant arrives by webhook moments later, so the balance is refetched rather than
   * assumed. Nothing on this screen writes to the player's account.
   *
   * `invalidate`, not the optimistic `updateUser`: the new balance is whatever the
   * webhook wrote, so there is nothing to write optimistically and every reason to go
   * and read it.
   */
  const settle = useCallback(async () => {
    await Promise.all([refetchRecent(), utils.profile.getUser.invalidate()]);
  }, [refetchRecent, utils]);

  const buy = async (productId: string) => {
    setBusyProduct(productId);
    const result = await purchases.purchase(productId);
    setBusyProduct(null);
    if (result.status === "cancelled") return;
    if (result.status === "error") {
      showMutationToast({ success: false, message: result.message });
      return;
    }
    showMutationToast({
      success: true,
      message: "Purchase complete. Your reputation will appear in a moment.",
    });
    await settle();
  };

  const restore = async () => {
    setIsRestoring(true);
    const info = await purchases.restore();
    setIsRestoring(false);
    showMutationToast({
      success: true,
      message: info?.activeEntitlements.length
        ? "Purchases restored."
        : "No previous purchases found for this store account.",
    });
    await settle();
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
      title="Reputation"
      subtitle={`You have ${userData.reputationPoints} reputation points`}
      alreadyHasH1
    >
      {products === null ? (
        <Loader explanation="Loading store" />
      ) : (
        <div className="flex flex-col gap-2">
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
                  onClick={() => void buy(product.productId)}
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
