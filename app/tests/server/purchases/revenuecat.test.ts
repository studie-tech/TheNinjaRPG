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
  isRefund,
  isSandbox,
  occurredAt,
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
    ]) {
      expect(classifyEvent(type)).toBe("grant");
    }
  });

  it("ignores a product change, which only announces a switch that has not happened", () => {
    // On the App Store its product_id is the tier being left; the switch arrives as its
    // own RENEWAL or INITIAL_PURCHASE once it actually takes effect.
    expect(classifyEvent("PRODUCT_CHANGE")).toBe("ignore");
  });

  it("revokes only once access has actually ended", () => {
    expect(classifyEvent("EXPIRATION")).toBe("revoke");
    // A plain CANCELLATION means auto-renew was switched off. The player keeps what they
    // paid for until it expires, so revoking here would cut a paid month short. A refund
    // also arrives as a CANCELLATION and is picked out separately by isRefund.
    expect(classifyEvent("CANCELLATION")).toBe("ignore");
    expect(classifyEvent("BILLING_ISSUE")).toBe("ignore");
    expect(classifyEvent("TEST")).toBe("ignore");
  });

  it("dates an event by when the store says it happened, not when we hear it", () => {
    // RevenueCat retries for days: using arrival time would let a late expiry retire a
    // receipt for a subscription the player has since bought back.
    const at = 1_700_000_000_000;
    expect(
      occurredAt({ type: "EXPIRATION", id: "e", app_user_id: "u", event_timestamp_ms: at } as Parameters<typeof occurredAt>[0]).getTime(),
    ).toBe(at);
    // Absent only in hand-made payloads; falling back to now keeps the caller simple.
    const fallback = occurredAt({ type: "EXPIRATION", id: "e", app_user_id: "u" } as Parameters<typeof occurredAt>[0]);
    expect(Math.abs(fallback.getTime() - Date.now())).toBeLessThan(5000);
  });

  it("tells a refund apart from an ordinary cancellation", () => {
    const event = (type: string, reason?: string) =>
      ({ type, id: "e", app_user_id: "u", cancel_reason: reason }) as Parameters<
        typeof isRefund
      >[0];
    expect(isRefund(event("CANCELLATION", "CUSTOMER_SUPPORT"))).toBe(true);
    expect(isRefund(event("CANCELLATION", "UNSUBSCRIBE"))).toBe(false);
    expect(isRefund(event("CANCELLATION"))).toBe(false);
    // Only a cancellation can be a refund; an expiry is a lapse.
    expect(isRefund(event("EXPIRATION", "CUSTOMER_SUPPORT"))).toBe(false);
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
