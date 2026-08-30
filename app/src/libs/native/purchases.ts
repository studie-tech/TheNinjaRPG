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

/**
 * A product as RevenueCat returned it. Passed back to `purchase` unchanged rather than
 * reconstructed from its identifier: the Android SDK also reads `productCategory` off it
 * and rejects a partial object before the purchase sheet opens.
 */
export interface StoreProduct {
  identifier: string;
  /** Localised, with the player's own currency symbol. Never format this yourself. */
  priceString: string;
  title: string;
  description: string;
  [key: string]: unknown;
}

export interface CustomerInfo {
  /** Entitlement ids currently active, e.g. `["federal"]`. */
  activeEntitlements: string[];
  originalAppUserId: string;
}

export const isSupported = (): boolean => isNative() && hasPlugin(PLUGIN);

/**
 * Configure the SDK with the public key for this platform and bind purchases to the
 * player's account, so the webhook knows who to credit.
 */
export const configure = async (apiKey: string, appUserId: string): Promise<void> => {
  await invoke(PLUGIN, "configure", { apiKey, appUserID: appUserId });
};

/** Rebind after a sign-in on the same device. */
export const logIn = async (appUserId: string): Promise<void> => {
  await invokeSafe(PLUGIN, "logIn", { appUserID: appUserId });
};

/** Unbind on sign-out so the next player's purchases are not credited to the last one. */
export const logOut = async (): Promise<void> => {
  await invokeSafe(PLUGIN, "logOut");
};

/**
 * Products in the current offering, with store-localised prices. Returns an empty list
 * off-device or when the offering has not been configured in RevenueCat.
 */
export const getProducts = async (): Promise<StoreProduct[]> => {
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
  return packages
    .map((entry) => (entry as { product?: StoreProduct }).product)
    .filter((product): product is StoreProduct => Boolean(product?.identifier));
};

export type PurchaseOutcome =
  | { status: "purchased"; transactionId?: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

/**
 * Present the store's purchase sheet. Cancellation is reported separately because it is
 * the player changing their mind, not something to show an error for.
 */
export const purchase = async (product: StoreProduct): Promise<PurchaseOutcome> => {
  try {
    const result = await invoke<{
      transaction?: { transactionIdentifier?: string };
      userCancelled?: boolean;
    }>(PLUGIN, "purchaseStoreProduct", { product });
    if (result.userCancelled) return { status: "cancelled" };
    return {
      status: "purchased",
      transactionId: result.transaction?.transactionIdentifier,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Purchase failed";
    // Both SDKs surface a cancellation as an error rather than a flag on some paths.
    if (/cancel/i.test(message)) return { status: "cancelled" };
    return { status: "error", message };
  }
};

/**
 * Restore Purchases. Apple requires this control in any app selling non-consumables or
 * subscriptions, and rejects apps that omit it.
 */
export const restore = async (): Promise<CustomerInfo | undefined> => {
  const result = await invokeSafe<{ customerInfo?: unknown }>(
    PLUGIN,
    "restorePurchases",
  );
  return toCustomerInfo(result?.customerInfo);
};

export const getCustomerInfo = async (): Promise<CustomerInfo | undefined> => {
  const result = await invokeSafe<{ customerInfo?: unknown }>(
    PLUGIN,
    "getCustomerInfo",
  );
  return toCustomerInfo(result?.customerInfo);
};

const toCustomerInfo = (raw: unknown): CustomerInfo | undefined => {
  const info = raw as
    | {
        entitlements?: { active?: Record<string, unknown> };
        originalAppUserId?: string;
      }
    | undefined;
  if (!info) return undefined;
  return {
    activeEntitlements: Object.keys(info.entitlements?.active ?? {}),
    originalAppUserId: info.originalAppUserId ?? "",
  };
};
