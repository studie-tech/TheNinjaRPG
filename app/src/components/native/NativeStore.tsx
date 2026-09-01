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
  fetchFreshStoreObservation,
  finalStorePurchaseResult,
  finalStoreRestoreResult,
  hasSettledStorePurchase,
  isPendingStorePurchase,
  releaseStorePurchaseLock,
  retainStorePurchaseLock,
  type StorePurchaseAttempt,
  type StorePurchaseLock,
  type StoreRestoreAttempt,
  storeRestoreReconciliation,
} from "@/libs/native/purchaseSettlement";
import { showMutationToast } from "@/libs/toast";
import { useUserData } from "@/utils/UserContext";

/**
 * Backoff while waiting for the grant webhook: roughly 21 seconds in total, which is
 * generous for a webhook that normally lands in one or two.
 */
const GRANT_POLL_DELAYS_MS = [1000, 2000, 3000, 5000, 5000, 5000];
const PURCHASE_ATTEMPT_STORAGE_KEY = "tnr:unsettled-store-purchases";

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
    activeSubscriptions: string[] | null;
    bound: boolean;
  } | null>(null);
  const [bindingError, setBindingError] = useState<string | null>(null);
  const [bindingRetry, setBindingRetry] = useState(0);
  const bindingGeneration = useRef(0);
  const recentGeneration = useRef(0);
  const [recentBaseline, setRecentBaseline] = useState<{
    userId: string;
    newestId: string | undefined;
  } | null>(null);
  const [busyProduct, setBusyProduct] = useState<string | null>(null);
  const [unsettledAttempts, setUnsettledAttempts] = useState<StorePurchaseLock[]>([]);
  const [attemptsHydrated, setAttemptsHydrated] = useState(false);
  const [retryingProduct, setRetryingProduct] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [recentBaselineError, setRecentBaselineError] = useState<string | null>(null);

  const { data: catalogue } = api.purchases.catalogue.useQuery(undefined, {
    enabled: isNativeShell === true,
  });
  const {
    data: recent,
    refetch: refetchRecent,
    isFetching: isRecentFetching,
  } = api.purchases.recent.useQuery({ limit: 5 }, { enabled: isNativeShell === true });
  const pendingProductIds = new Set(
    recent?.filter(isPendingStorePurchase).map((purchase) => purchase.productId),
  );
  const hasPendingPurchase = pendingProductIds.size > 0;
  const accountUnsettledAttempts = unsettledAttempts.filter(
    (entry) => entry.accountId === player?.userId,
  );
  const reconciliationLockedProductIds = new Set(
    accountUnsettledAttempts.map((entry) => entry.attempt.productId),
  );

  const storePlatform = platform();
  const apiKey =
    storePlatform === "ios"
      ? env.NEXT_PUBLIC_REVENUECAT_IOS_KEY
      : env.NEXT_PUBLIC_REVENUECAT_ANDROID_KEY;

  // A charged attempt must survive navigation and application restarts. Its exact
  // transaction/baseline correlation is persisted; only a terminal server receipt may
  // remove it and reopen checkout for that product.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PURCHASE_ATTEMPT_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        setUnsettledAttempts(
          parsed.filter((entry): entry is StorePurchaseLock => {
            if (!entry || typeof entry !== "object") return false;
            const value = entry as {
              accountId?: unknown;
              attempt?: {
                transactionId?: unknown;
                productId?: unknown;
                baselineReceiptIds?: unknown;
              };
            };
            return (
              typeof value.accountId === "string" &&
              typeof value.attempt?.productId === "string" &&
              (value.attempt.transactionId === undefined ||
                typeof value.attempt.transactionId === "string") &&
              Array.isArray(value.attempt.baselineReceiptIds) &&
              value.attempt.baselineReceiptIds.every(
                (receiptId) => typeof receiptId === "string",
              )
            );
          }),
        );
      }
    } catch {
      // Corrupt local state cannot identify a real checkout attempt, so ignore it.
    } finally {
      setAttemptsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!attemptsHydrated) return;
    try {
      window.localStorage.setItem(
        PURCHASE_ATTEMPT_STORAGE_KEY,
        JSON.stringify(unsettledAttempts),
      );
    } catch {
      // The in-memory lock still protects this mounted checkout if storage is unavailable.
    }
  }, [attemptsHydrated, unsettledAttempts]);

  // Binding the SDK to the player's own id is what lets the webhook know who to credit;
  // without it a purchase is validated and then dropped.
  useEffect(() => {
    const generation = ++bindingGeneration.current;
    const accountId = player?.userId;
    if (!isNativeShell || !accountId) return;
    setBindingError(null);
    if (!apiKey) {
      // isConfigured only reflects the server's webhook secret, so a build with that set
      // and the public SDK key missing would otherwise spin forever with no explanation.
      setPackageState({
        userId: accountId,
        packages: [],
        activeSubscriptions: null,
        bound: false,
      });
      return;
    }
    // The native module owns the queue, so sign-out's logOut and another mounted store
    // participate in the same ordering rather than racing a component-local promise.
    const binding = purchases.bind(apiKey, accountId);
    void binding
      .then(async (packages) => ({
        packages,
        customerInfo: await purchases.getCustomerInfo(),
      }))
      .then(({ packages, customerInfo }) => {
        if (generation !== bindingGeneration.current) return;
        if (!customerInfo) {
          throw new Error("Could not verify your current store subscriptions");
        }
        setPackageState({
          userId: accountId,
          packages,
          activeSubscriptions: customerInfo.activeSubscriptions,
          bound: true,
        });
      })
      .catch((error: unknown) => {
        if (generation !== bindingGeneration.current) return;
        setBindingError(
          error instanceof Error ? error.message : "Could not connect to the store",
        );
        setPackageState({
          userId: accountId,
          packages: [],
          activeSubscriptions: null,
          bound: false,
        });
      });
    return () => {
      if (generation === bindingGeneration.current) bindingGeneration.current += 1;
    };
  }, [apiKey, bindingRetry, isNativeShell, player?.userId]);

  // Never expose packages fetched for the previous account, even for the render before
  // the new binding effect gets a chance to clear its state.
  const available =
    player && packageState?.userId === player.userId ? packageState : null;
  const packages = available?.packages ?? null;
  const activeSubscriptions = available?.activeSubscriptions ?? null;

  // `recent` is the before-checkout watermark used to tell this attempt's receipt from a
  // terminal receipt already in the list. Refetch it for each signed-in account and keep
  // checkout closed until that account's baseline has actually completed.
  useEffect(() => {
    const generation = ++recentGeneration.current;
    const accountId = player?.userId;
    if (!isNativeShell || !accountId) return;
    setRecentBaselineError(null);
    void refetchRecent()
      .then(({ data, error }) => {
        if (generation !== recentGeneration.current) return;
        if (!data) throw error ?? new Error("Could not verify recent purchases");
        setRecentBaseline({ userId: accountId, newestId: data[0]?.id });
      })
      .catch((error: unknown) => {
        if (generation !== recentGeneration.current) return;
        setRecentBaselineError(
          error instanceof Error ? error.message : "Could not verify recent purchases",
        );
      });
    return () => {
      if (generation === recentGeneration.current) recentGeneration.current += 1;
    };
  }, [isNativeShell, player?.userId, refetchRecent]);
  const purchaseBaseline =
    recentBaseline?.userId === player?.userId ? recentBaseline : null;
  const hasRecentBaseline = purchaseBaseline !== null;

  /** QueryClient defaults may keep purchase data fresh forever; invalidate first. */
  const fetchRecentFresh = useCallback(
    async (input: { limit: number; transactionId?: string; productId?: string }) =>
      await fetchFreshStoreObservation(
        () => utils.purchases.recent.invalidate(input),
        () => utils.purchases.recent.fetch(input, { staleTime: 0 }),
      ),
    [utils],
  );

  const retryRecentBaseline = async () => {
    const accountId = player?.userId;
    if (!accountId) return;
    setRecentBaselineError(null);
    const { data, error } = await refetchRecent();
    if (!data) {
      setRecentBaselineError(
        error instanceof Error ? error.message : "Could not verify recent purchases",
      );
      return;
    }
    setRecentBaseline({ userId: accountId, newestId: data[0]?.id });
  };

  // A grant can be retried after the initial wait ends. Keep pending products disabled
  // and refresh both the receipt and profile when the retry finally settles.
  useEffect(() => {
    const accountId = player?.userId;
    if (!hasPendingPurchase || !accountId) return;
    const timer = window.setInterval(() => {
      void refetchRecent().then(({ data }) => {
        if (data) {
          setRecentBaseline((current) =>
            current?.userId === accountId
              ? { userId: accountId, newestId: data[0]?.id }
              : current,
          );
        }
        if (data && !data.some(isPendingStorePurchase)) {
          void utils.profile.getUser.invalidate();
        }
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [hasPendingPurchase, player?.userId, refetchRecent, utils]);

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
   * The SDK transaction id identifies it when available. On platforms that omit that id,
   * a fresh server baseline means only a newly-visible same-product receipt can release
   * this attempt's lock. No client clock is compared with a database timestamp.
   */
  const settleAfterPurchase = useCallback(
    async (attempt: StorePurchaseAttempt) => {
      let settled = false;
      for (const delay of GRANT_POLL_DELAYS_MS) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        const matching = await fetchRecentFresh({
          limit: 50,
          ...(attempt.transactionId
            ? { transactionId: attempt.transactionId }
            : { productId: attempt.productId }),
        });
        if (hasSettledStorePurchase(matching, attempt)) {
          settled = true;
          break;
        }
      }
      // Refetch regardless: if the webhook is slow or has failed, the player should still
      // see whatever the truth currently is rather than a frozen screen.
      const [{ data }] = await Promise.all([
        refetchRecent(),
        utils.profile.getUser.invalidate(),
      ]);
      settled ||= Boolean(data && hasSettledStorePurchase(data, attempt));
      return {
        newestId: data?.[0]?.id,
        status: finalStorePurchaseResult(settled),
      };
    },
    [fetchRecentFresh, refetchRecent, utils],
  );

  const verifyPurchaseAttempt = useCallback(
    async (accountId: string, attempt: StorePurchaseAttempt) => {
      const matching = await fetchRecentFresh({
        limit: 50,
        ...(attempt.transactionId
          ? { transactionId: attempt.transactionId }
          : { productId: attempt.productId }),
      });
      if (!hasSettledStorePurchase(matching, attempt)) return false;
      setUnsettledAttempts((current) =>
        releaseStorePurchaseLock(current, accountId, attempt.productId),
      );
      await Promise.all([refetchRecent(), utils.profile.getUser.invalidate()]);
      return true;
    },
    [fetchRecentFresh, refetchRecent, utils],
  );

  // A receipt may not exist yet when the initial wait expires. Keep checking the exact
  // checkout attempt while its product remains locked instead of reopening checkout.
  useEffect(() => {
    if (accountUnsettledAttempts.length === 0) return;
    const timer = window.setInterval(() => {
      for (const entry of accountUnsettledAttempts) {
        void verifyPurchaseAttempt(entry.accountId, entry.attempt);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [accountUnsettledAttempts, verifyPurchaseAttempt]);

  const refreshAfterRestore = useCallback(
    async (attempt: StoreRestoreAttempt) => {
      let newestId: string | undefined;
      let observation = storeRestoreReconciliation([], attempt);
      for (const delay of GRANT_POLL_DELAYS_MS) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        const matching = (
          await Promise.all(
            [...new Set(attempt.expectedProductIds)].map((productId) =>
              fetchRecentFresh({ limit: 10, productId }),
            ),
          )
        ).flat();
        newestId = matching[0]?.id ?? newestId;
        observation = storeRestoreReconciliation(matching, attempt);
        if (observation === "reconciled") break;
      }
      const [{ data }] = await Promise.all([
        refetchRecent(),
        utils.profile.getUser.invalidate(),
      ]);
      newestId = data?.[0]?.id ?? newestId;
      return { newestId, status: finalStoreRestoreResult(observation) };
    },
    [fetchRecentFresh, refetchRecent, utils],
  );

  const buy = async (
    entry: purchases.StorePackage,
    productId: string,
    isFederal = false,
  ) => {
    if (!available?.bound || available.userId !== player?.userId || !purchaseBaseline)
      return;
    const accountId = available.userId;
    setBusyProduct(productId);
    try {
      // Refresh again immediately before opening the store sheet. A webhook from an
      // earlier slow purchase may have landed since the screen's initial baseline.
      const [baselineRows, { data: visibleRows }] = await Promise.all([
        fetchRecentFresh({ limit: 50, productId }),
        refetchRecent(),
      ]);
      if (!visibleRows) throw new Error("Could not verify recent purchases");
      const previousNewestId = visibleRows[0]?.id;
      setRecentBaseline({ userId: accountId, newestId: previousNewestId });

      let storeProductChangeInfo: purchases.StoreProductChangeInfo | undefined;
      if (isFederal && catalogue?.federal) {
        const customerInfo = await purchases.getCustomerInfo();
        if (!customerInfo) {
          throw new Error("Could not verify your current store subscription");
        }
        setPackageState((current) =>
          current?.userId === accountId
            ? { ...current, activeSubscriptions: customerInfo.activeSubscriptions }
            : current,
        );
        if (storePlatform !== "android") {
          if (customerInfo.activeSubscriptions.includes(productId)) {
            showMutationToast({
              success: false,
              message: "This subscription is already active in your App Store account.",
            });
            return;
          }
        } else {
          const change = purchases.androidSubscriptionChange(
            customerInfo.activeSubscriptions,
            productId,
            catalogue.federal,
          );
          if (change.status === "active") {
            showMutationToast({
              success: false,
              message: "This subscription is already active in your Play account.",
            });
            return;
          }
          if (change.status === "change") {
            storeProductChangeInfo = change.storeProductChangeInfo;
          }
        }
      }
      const result = await purchases.purchase(entry, storeProductChangeInfo);
      if (result.status === "cancelled") return;
      if (result.status === "error") {
        showMutationToast({ success: false, message: result.message });
        return;
      }
      showMutationToast({
        success: true,
        message: "Purchase complete. Crediting your account...",
      });
      if (isFederal) {
        const customerInfo = await purchases.getCustomerInfo();
        if (customerInfo) {
          setPackageState((current) =>
            current?.userId === accountId
              ? { ...current, activeSubscriptions: customerInfo.activeSubscriptions }
              : current,
          );
        }
      }
      // Held busy across the wait so the player cannot buy the same tier twice while the
      // first grant is still in flight.
      const attempt = {
        transactionId: result.transactionId,
        productId,
        baselineReceiptIds: baselineRows.map((purchase) => purchase.id),
      };
      const settlement = await settleAfterPurchase(attempt);
      if (settlement.status === "timed-out") {
        setUnsettledAttempts((current) =>
          retainStorePurchaseLock(current, { accountId, attempt }),
        );
        showMutationToast({
          success: false,
          message:
            "The charge is still being verified. This item will stay locked until reconciliation finishes.",
        });
      }
      setRecentBaseline((current) =>
        current?.userId === accountId
          ? { userId: accountId, newestId: settlement.newestId }
          : current,
      );
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
    const accountId = available.userId;
    setIsRestoring(true);
    try {
      const { data: visibleRows, error: baselineError } = await refetchRecent();
      if (!visibleRows) {
        throw baselineError ?? new Error("Could not verify recent purchases");
      }
      const info = await purchases.restore();
      if (!info) {
        throw new Error("Could not verify restored purchases with the store");
      }
      setPackageState((current) =>
        current?.userId === accountId
          ? { ...current, activeSubscriptions: info.activeSubscriptions }
          : current,
      );
      if (info.activeSubscriptions.length) {
        // A TRANSFER can arrive after the first poll and may have no pending row before it
        // moves the receipt. Wait for each restored subscription to have a live server
        // entitlement; absence of pending rows is not completion.
        const result = await refreshAfterRestore({
          expectedProductIds: info.activeSubscriptions,
        });
        setRecentBaseline((current) =>
          current?.userId === accountId
            ? { userId: accountId, newestId: result.newestId }
            : current,
        );
        showMutationToast({
          success: result.status === "reconciled",
          message:
            result.status === "reconciled"
              ? "Purchases restored."
              : result.status === "rejected"
                ? "The store restored a subscription, but the server rejected its receipt. Please contact support."
                : "The store restored a subscription, but the server is still processing it. Please try again shortly.",
        });
      } else {
        // There is no webhook to wait for. Refresh once and finish immediately.
        const [{ data }] = await Promise.all([
          refetchRecent(),
          utils.profile.getUser.invalidate(),
        ]);
        if (data) {
          setRecentBaseline((current) =>
            current?.userId === accountId
              ? { userId: accountId, newestId: data[0]?.id }
              : current,
          );
        }
        showMutationToast({
          success: true,
          message: "No previous purchases found for this store account.",
        });
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
          {!hasRecentBaseline && (
            <div className="rounded-lg border p-3 text-sm">
              <p>{recentBaselineError ?? "Verifying your recent purchases..."}</p>
              {recentBaselineError && (
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  disabled={isRecentFetching}
                  onClick={() => void retryRecentBaseline()}
                >
                  {isRecentFetching && (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  )}
                  Retry verification
                </Button>
              )}
            </div>
          )}
          {bindingError && (
            <div className="rounded-lg border p-3 text-sm">
              <p>{bindingError}</p>
              <Button
                className="mt-2"
                size="sm"
                variant="outline"
                onClick={() => {
                  setPackageState(null);
                  setBindingRetry((attempt) => attempt + 1);
                }}
              >
                Retry store connection
              </Button>
            </div>
          )}
          {accountUnsettledAttempts.map(({ accountId, attempt }) => (
            <div
              key={attempt.productId}
              className="rounded-lg border border-amber-500/50 p-3 text-sm"
            >
              <p>
                {attempt.productId} was charged and is still being verified. Checkout is
                locked for this item.
              </p>
              <Button
                className="mt-2"
                size="sm"
                variant="outline"
                disabled={retryingProduct === attempt.productId}
                onClick={() => {
                  setRetryingProduct(attempt.productId);
                  void verifyPurchaseAttempt(accountId, attempt)
                    .then((settled) => {
                      showMutationToast({
                        success: settled,
                        message: settled
                          ? "Purchase verification finished."
                          : "The server is still processing this purchase.",
                      });
                    })
                    .finally(() => setRetryingProduct(null));
                }}
              >
                {retryingProduct === attempt.productId && (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                )}
                Retry verification
              </Button>
            </div>
          ))}
          <p className="mb-1 font-medium text-sm">Reputation</p>
          {catalogue?.reputation.map((product) => {
            // The store's own localised price, so the player sees their currency.
            const listed = packages.find(
              (entry) =>
                purchases.productIdForPackage(entry, storePlatform) ===
                product.productId,
            );
            const isPending = pendingProductIds.has(product.productId);
            const isReconciliationLocked = reconciliationLockedProductIds.has(
              product.productId,
            );
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
                  disabled={
                    busyProduct !== null ||
                    isPending ||
                    isReconciliationLocked ||
                    !listed ||
                    !hasRecentBaseline
                  }
                  onClick={() => listed && void buy(listed, product.productId)}
                >
                  {busyProduct === product.productId ||
                  isPending ||
                  isReconciliationLocked ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <ShoppingCart className="mr-1 h-4 w-4" />
                  )}
                  {isPending || isReconciliationLocked ? "Verifying" : "Buy"}
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
                const isCurrent =
                  activeSubscriptions?.includes(expectedProductId) ?? false;
                const isPending = pendingProductIds.has(expectedProductId);
                const isReconciliationLocked =
                  reconciliationLockedProductIds.has(expectedProductId);
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
                        busyProduct !== null ||
                        isPending ||
                        isReconciliationLocked ||
                        !listed ||
                        isCurrent ||
                        activeSubscriptions === null ||
                        !hasRecentBaseline
                      }
                      onClick={() =>
                        listed && void buy(listed, expectedProductId, true)
                      }
                    >
                      {busyProduct === expectedProductId ||
                      isPending ||
                      isReconciliationLocked ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <ShoppingCart className="mr-1 h-4 w-4" />
                      )}
                      {isCurrent
                        ? "Active"
                        : isPending || isReconciliationLocked
                          ? "Verifying"
                          : "Subscribe"}
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

          {packages.length === 0 && !bindingError && (
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
