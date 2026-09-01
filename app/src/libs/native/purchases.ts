/**
 * In-app purchases, through RevenueCat.
 *
 * One integration covers both stores, receipt validation, subscription state and the
 * webhook that grants entitlements server-side. Nothing here credits anything: the client
 * completes the purchase, RevenueCat validates the receipt with Apple or Google, and the
 * webhook is what moves the balance. A client that could grant its own reputation would be
 * trivially exploitable.
 */

import { hasPlugin, invoke, invokeSafe, isNative } from "./bridge";

const PLUGIN = "Purchases";
let identityQueue: Promise<void> = Promise.resolve();

export const runPurchaseIdentityOperation = <T>(
  operation: () => Promise<T>,
): Promise<T> => {
  const pending = identityQueue.catch(() => undefined).then(operation);
  identityQueue = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
};

/**
 * A product as RevenueCat returned it. It remains nested in its package so Android keeps
 * the selected base plan and offering context when the purchase sheet opens.
 */
export interface StoreProduct {
  identifier: string;
  /** Localised, with the player's own currency symbol. Never format this yourself. */
  priceString: string;
  title: string;
  description: string;
  defaultOption?: { basePlanId?: string | null } | null;
  [key: string]: unknown;
}

/** RevenueCat offering package. Keep it intact so Android retains its selected base plan. */
export interface StorePackage {
  identifier: string;
  product: StoreProduct;
  [key: string]: unknown;
}

export interface CustomerInfo {
  /** Entitlement ids currently active, e.g. `["federal"]`. */
  activeEntitlements: string[];
  /** Store product ids for subscriptions currently active on this account. */
  activeSubscriptions: string[];
  originalAppUserId: string;
  /** Store transactions used to reconcile a sheet whose JS callback was lost. */
  transactions: { transactionId: string; productId: string }[];
}

export type StoreReplacementMode =
  | "WITHOUT_PRORATION"
  | "WITH_TIME_PRORATION"
  | "CHARGE_FULL_PRICE"
  | "CHARGE_PRORATED_PRICE"
  | "DEFERRED";

export interface StoreProductChangeInfo {
  oldProductIdentifier: string;
  replacementMode: StoreReplacementMode;
}

interface FederalPlan {
  androidProductId: string;
}

export type AndroidSubscriptionChange =
  | { status: "new" }
  | { status: "active" }
  | { status: "change"; storeProductChangeInfo: StoreProductChangeInfo };

/**
 * Describe a Play subscription replacement from the catalogue's tier order.
 *
 * Play requires the old product id when changing base plans. Upgrades take effect now
 * with a prorated charge; downgrades are deferred so already-paid access is not shortened.
 */
export const androidSubscriptionChange = (
  activeSubscriptions: string[],
  targetProductId: string,
  plans: readonly FederalPlan[],
): AndroidSubscriptionChange => {
  const targetIndex = plans.findIndex(
    (plan) => plan.androidProductId === targetProductId,
  );
  const activeProductId = activeSubscriptions.find((productId) =>
    plans.some((plan) => plan.androidProductId === productId),
  );
  if (!activeProductId || targetIndex < 0) return { status: "new" };
  if (activeProductId === targetProductId) return { status: "active" };

  const activeIndex = plans.findIndex(
    (plan) => plan.androidProductId === activeProductId,
  );
  return {
    status: "change",
    storeProductChangeInfo: {
      oldProductIdentifier: activeProductId,
      replacementMode: targetIndex > activeIndex ? "CHARGE_PRORATED_PRICE" : "DEFERRED",
    },
  };
};

export const isSupported = (): boolean => isNative() && hasPlugin(PLUGIN);

/**
 * Configure the SDK with the public key for this platform and bind purchases to the
 * player's account, so the webhook knows who to credit.
 */
export const configure = async (apiKey: string, appUserId: string): Promise<void> => {
  await invoke(PLUGIN, "configure", { apiKey, appUserID: appUserId });
};

/**
 * Rebind after a sign-in on the same device.
 *
 * Throws rather than reporting success, unlike the cleanup calls around it. A rebind that
 * quietly failed would leave the SDK on the previous id -- or anonymous after a sign-out --
 * while the store went on offering products, so the player could buy something the webhook
 * then had nobody to credit. The caller shows no products instead.
 */
export const logIn = async (appUserId: string): Promise<void> => {
  await invoke(PLUGIN, "logIn", { appUserID: appUserId });
};

/** Unbind on sign-out so the next player's purchases are not credited to the last one. */
export const logOut = async (): Promise<void> => {
  await runPurchaseIdentityOperation(async () => {
    await invokeSafe(PLUGIN, "logOut");
  });
};

/**
 * Packages in the current offering, with store-localised prices. Returns an empty list
 * off-device or when the offering has not been configured in RevenueCat.
 */
export const getPackages = async (): Promise<StorePackage[]> => {
  const result = await invokeSafe<{ all?: Record<string, unknown> }>(
    PLUGIN,
    "getOfferings",
  );
  const current = (
    result as { current?: { availablePackages?: unknown[] } } | undefined
  )?.current;
  const packages = Array.isArray(current?.availablePackages)
    ? current.availablePackages
    : [];
  return packages.filter(
    (entry): entry is StorePackage =>
      typeof (entry as StorePackage)?.identifier === "string" &&
      typeof (entry as StorePackage)?.product?.identifier === "string",
  );
};

/** Bind the singleton SDK and fetch offerings without allowing another session to interleave. */
export const bind = async (
  apiKey: string,
  appUserId: string,
): Promise<StorePackage[]> =>
  await runPurchaseIdentityOperation(async () => {
    await configure(apiKey, appUserId);
    await logIn(appUserId);
    return await getPackages();
  });

/** RevenueCat's canonical product id, including the Play base-plan suffix. */
export const productIdForPackage = (
  entry: StorePackage,
  store: "ios" | "android" | "web",
): string => {
  const identifier = entry.product.identifier;
  const basePlanId = entry.product.defaultOption?.basePlanId;
  return store === "android" && basePlanId && !identifier.includes(":")
    ? `${identifier}:${basePlanId}`
    : identifier;
};

export type PurchaseOutcome =
  | { status: "purchased"; transactionId?: string }
  | { status: "cancelled" }
  | {
      status: "error";
      message: string;
      code?: string;
      /** False only when the SDK proves checkout could not have charged. */
      mayHaveCharged: boolean;
    };

// PRODUCT_ALREADY_PURCHASED (6) means the store rejected a duplicate checkout against
// an entitlement it already owns; this invocation cannot have created a new charge. The
// existing transaction will arrive through restore/sync, so permanently locking a fresh
// attempt here would leave the product impossible to settle.
const DEFINITE_PRECHARGE_ERROR_CODES = new Set(["3", "4", "5", "6", "14", "23", "24"]);

export const purchaseErrorOutcome = (error: unknown): PurchaseOutcome => {
  const candidate =
    error && typeof error === "object"
      ? (error as { code?: unknown; message?: unknown; userCancelled?: unknown })
      : undefined;
  const code =
    typeof candidate?.code === "string" || typeof candidate?.code === "number"
      ? String(candidate.code)
      : undefined;
  const message =
    typeof candidate?.message === "string" ? candidate.message : "Purchase failed";
  if (code === "1" || candidate?.userCancelled === true) {
    return { status: "cancelled" };
  }
  return {
    status: "error",
    message,
    code,
    mayHaveCharged: !code || !DEFINITE_PRECHARGE_ERROR_CODES.has(code),
  };
};

/**
 * Present the store's purchase sheet. Cancellation is reported separately because it is
 * the player changing their mind, not something to show an error for.
 */
export const purchase = async (
  aPackage: StorePackage,
  storeProductChangeInfo?: StoreProductChangeInfo,
): Promise<PurchaseOutcome> => {
  try {
    const result = await invoke<{
      transaction?: { transactionIdentifier?: string };
      userCancelled?: boolean;
    }>(PLUGIN, "purchasePackage", {
      aPackage,
      ...(storeProductChangeInfo ? { storeProductChangeInfo } : {}),
    });
    if (result.userCancelled) return { status: "cancelled" };
    return {
      status: "purchased",
      transactionId: result.transaction?.transactionIdentifier,
    };
  } catch (error) {
    return purchaseErrorOutcome(error);
  }
};

/**
 * Restore Purchases. Apple requires this control in any app selling non-consumables or
 * subscriptions, and rejects apps that omit it.
 */
export const restore = async (): Promise<CustomerInfo | undefined> => {
  const result = await invoke<{ customerInfo?: unknown }>(PLUGIN, "restorePurchases");
  return toCustomerInfo(result?.customerInfo);
};

export const getCustomerInfo = async (): Promise<CustomerInfo | undefined> => {
  const result = await invokeSafe<{ customerInfo?: unknown }>(
    PLUGIN,
    "getCustomerInfo",
  );
  return toCustomerInfo(result?.customerInfo);
};

/** Keep a singleton-SDK synchronization and its confirming snapshot in one queue slot. */
export const syncPurchaseIdentitySnapshot = async <T>(
  sync: () => Promise<void>,
  readSnapshot: () => Promise<T>,
): Promise<T> =>
  await runPurchaseIdentityOperation(async () => {
    await sync();
    return await readSnapshot();
  });

/** Force RevenueCat to reconcile the device store queue before restart recovery. */
export const syncCustomerInfo = async (): Promise<CustomerInfo | undefined> =>
  await syncPurchaseIdentitySnapshot(
    async () => await invoke(PLUGIN, "syncPurchases"),
    getCustomerInfo,
  );

const toCustomerInfo = (raw: unknown): CustomerInfo | undefined => {
  const info = raw as
    | {
        entitlements?: { active?: Record<string, unknown> };
        activeSubscriptions?: unknown;
        originalAppUserId?: string;
        nonSubscriptionTransactions?: unknown;
        subscriptionsByProductIdentifier?: unknown;
      }
    | undefined;
  if (!info) return undefined;
  const nonSubscriptions = Array.isArray(info.nonSubscriptionTransactions)
    ? info.nonSubscriptionTransactions.flatMap((entry) => {
        const transaction = entry as {
          transactionIdentifier?: unknown;
          productIdentifier?: unknown;
        };
        return typeof transaction.transactionIdentifier === "string" &&
          typeof transaction.productIdentifier === "string"
          ? [
              {
                transactionId: transaction.transactionIdentifier,
                productId: transaction.productIdentifier,
              },
            ]
          : [];
      })
    : [];
  const subscriptions =
    info.subscriptionsByProductIdentifier &&
    typeof info.subscriptionsByProductIdentifier === "object"
      ? Object.entries(info.subscriptionsByProductIdentifier).flatMap(
          ([productId, value]) => {
            const subscription = value as { storeTransactionId?: unknown };
            return typeof subscription.storeTransactionId === "string"
              ? [{ transactionId: subscription.storeTransactionId, productId }]
              : [];
          },
        )
      : [];
  return {
    activeEntitlements: Object.keys(info.entitlements?.active ?? {}),
    activeSubscriptions: Array.isArray(info.activeSubscriptions)
      ? info.activeSubscriptions.filter(
          (subscription): subscription is string => typeof subscription === "string",
        )
      : [],
    originalAppUserId: info.originalAppUserId ?? "",
    transactions: [...nonSubscriptions, ...subscriptions],
  };
};
