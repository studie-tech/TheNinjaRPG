import { afterEach, describe, expect, it } from "bun:test";
import { createPurchaseIdentityScope, restoreForBoundIdentity } from "@/libs/native/purchases";
import { ensureDom } from "../setup-dom.mjs";

ensureDom();
const capacitorWindow = window as typeof window & { Capacitor?: unknown };
afterEach(() => { delete capacitorWindow.Capacitor; });

const installCustomer = (platform: string, activeSubscriptions: unknown[], subscriptionsByProductIdentifier: Record<string, unknown>) => {
  const customerInfo = { activeSubscriptions, subscriptionsByProductIdentifier, originalAppUserId: "player-a" };
  capacitorWindow.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => platform,
    Plugins: { Purchases: {
      isConfigured: async () => ({ isConfigured: true }),
      logIn: async () => undefined,
      getOfferings: async () => ({ current: { availablePackages: [] } }),
      getCustomerInfo: async () => ({ customerInfo }),
      restorePurchases: async () => ({ customerInfo }),
    } },
  };
};

const appleSubscription = {
  store: "APP_STORE", productPlanIdentifier: "monthly", storeTransactionId: "apple-transaction",
};

describe("cross-store Apple customer products", () => {
  it("uses the canonical App Store product for both binding and restore", async () => {
    installCustomer("ios", ["tnr_federal_normal:monthly", "tnr_federal_normal"], { tnr_federal_normal: appleSubscription });
    const bound = await createPurchaseIdentityScope().bind("ios-key", "player-a");
    const restored = await restoreForBoundIdentity();
    for (const info of [bound.customerInfo, restored]) {
      expect(info?.activeSubscriptions).toEqual(["tnr_federal_normal"]);
      expect(info?.transactions).toEqual([{ transactionId: "apple-transaction", productId: "tnr_federal_normal", transactionIdSource: "store" }]);
    }
  });

  it("preserves Android base plans even when customer history contains Apple metadata", async () => {
    installCustomer("android", ["tnr_federal_normal:monthly"], { tnr_federal_normal: appleSubscription });
    expect((await restoreForBoundIdentity())?.activeSubscriptions).toEqual(["tnr_federal_normal:monthly"]);
  });

  it("does not guess aliases from other stores, absent metadata or mismatched plans", async () => {
    const products = ["google:monthly", "unknown:monthly", "apple:annual", "missing:monthly", "canonical", 123];
    installCustomer("ios", products, {
      google: { ...appleSubscription, store: "PLAY_STORE" },
      apple: appleSubscription,
      missing: null,
    });
    expect((await restoreForBoundIdentity())?.activeSubscriptions).toEqual(products.filter((product): product is string => typeof product === "string"));
  });
});
