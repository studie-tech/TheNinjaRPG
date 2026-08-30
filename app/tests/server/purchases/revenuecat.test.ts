import { describe, expect, it } from "vitest";
import {
  STORE_FEDERAL_PRODUCTS,
  STORE_REP_PRODUCTS,
} from "@/drizzle/constants";
import { dollars2reps } from "@/utils/paypal";
import {
  classifyEvent,
  idempotencyKey,
  isAuthorized,
  isSandbox,
  toStorePlatform,
} from "@/server/utils/purchases/revenuecat";

describe("store catalogue", () => {
  it("gives the same reputation per dollar as the web checkout", () => {
    // In-app and web must buy the same thing for the same money; the store's cut is
    // absorbed rather than passed on. If this fails, either the pricing formula moved or
    // a tier was edited without recomputing its reputation.
    for (const product of STORE_REP_PRODUCTS) {
      expect(product.reputationPoints).toBe(dollars2reps(product.usd));
    }
  });

  it("has unique, non-empty product ids across both catalogues", () => {
    const ids = [
      ...STORE_REP_PRODUCTS.map((p) => p.productId),
      ...STORE_FEDERAL_PRODUCTS.map((p) => p.productId),
    ];
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers tiers in ascending order, so the list reads as a ladder", () => {
    const prices = STORE_REP_PRODUCTS.map((p) => p.usd);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });
});

describe("revenuecat webhook classification", () => {
  it("grants on every event that means the player now owns something", () => {
    for (const type of [
      "INITIAL_PURCHASE",
      "NON_RENEWING_PURCHASE",
      "RENEWAL",
      "UNCANCELLATION",
      "PRODUCT_CHANGE",
    ]) {
      expect(classifyEvent(type)).toBe("grant");
    }
  });

  it("revokes only once access has actually ended", () => {
    expect(classifyEvent("EXPIRATION")).toBe("revoke");
    // CANCELLATION means auto-renew was switched off. The player keeps what they paid
    // for until it expires, so revoking here would cut a paid month short.
    expect(classifyEvent("CANCELLATION")).toBe("ignore");
    expect(classifyEvent("BILLING_ISSUE")).toBe("ignore");
    expect(classifyEvent("TEST")).toBe("ignore");
  });

  it("maps the store and environment", () => {
    expect(toStorePlatform("PLAY_STORE")).toBe("GOOGLE");
    expect(toStorePlatform("APP_STORE")).toBe("APPLE");
    expect(toStorePlatform(null)).toBe("APPLE");
    expect(isSandbox("SANDBOX")).toBe(true);
    expect(isSandbox("sandbox")).toBe(true);
    expect(isSandbox("PRODUCTION")).toBe(false);
    expect(isSandbox(undefined)).toBe(false);
  });

  it("falls back to the event id when an event carries no transaction", () => {
    const base = { type: "RENEWAL", id: "evt_1", app_user_id: "u1" };
    expect(idempotencyKey({ ...base, transaction_id: "txn_9" })).toBe("txn_9");
    expect(idempotencyKey({ ...base, transaction_id: null })).toBe("event:evt_1");
  });
});

describe("webhook authorization", () => {
  it("refuses when no secret is configured, rather than accepting anything", () => {
    expect(isAuthorized("anything", undefined)).toBe(false);
    expect(isAuthorized("anything", "")).toBe(false);
  });

  it("refuses a missing, wrong, or differently sized header", () => {
    expect(isAuthorized(null, "secret")).toBe(false);
    expect(isAuthorized("wrong!", "secret")).toBe(false);
    expect(isAuthorized("secret-but-longer", "secret")).toBe(false);
  });

  it("accepts the configured secret", () => {
    expect(isAuthorized("secret", "secret")).toBe(true);
  });
});
