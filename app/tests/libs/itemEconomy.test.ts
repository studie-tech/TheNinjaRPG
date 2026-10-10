import { describe, expect, it } from "bun:test";
import { getAuctionPriceError, getItemPurchaseAllowance } from "@/libs/itemEconomy";
import { getItemPurchasePeriodStart } from "@/utils/time";

describe("UTC purchase calendar", () => {
  const now = new Date("2026-10-06T23:59:59.999Z");
  it.each([
    ["DAILY", "2026-10-06T00:00:00.000Z"],
    ["WEEKLY", "2026-10-05T00:00:00.000Z"],
    ["MONTHLY", "2026-10-01T00:00:00.000Z"],
  ] as const)("starts %s at %s", (period, start) => {
    expect(getItemPurchasePeriodStart(period, now)?.toISOString()).toBe(start);
  });
  it.each([
    ["DAILY", "2026-10-07T00:00:00Z"],
    ["WEEKLY", "2026-10-12T00:00:00Z"],
    ["MONTHLY", "2026-11-01T00:00:00Z"],
  ] as const)(
    "resets %s only at the next calendar boundary",
    (purchaseLimitPeriod, rollover) => {
      const item = { purchaseLimit: 10, purchaseLimitPeriod };
      const counters = [
        {
          period: purchaseLimitPeriod,
          periodStart: getItemPurchasePeriodStart(purchaseLimitPeriod, now)!,
          quantity: 7,
        },
      ];
      expect(getItemPurchaseAllowance(item, counters, now)).toMatchObject({
        purchased: 7,
        remaining: 3,
      });
      expect(
        getItemPurchaseAllowance(
          item,
          counters,
          new Date(new Date(rollover).getTime() - 1),
        ).remaining,
      ).toBe(3);
      expect(
        getItemPurchaseAllowance(item, counters, new Date(rollover)),
      ).toMatchObject({ purchased: 0, remaining: 10 });
    },
  );
  it("handles week and month boundaries across years and leap days", () => {
    expect(
      getItemPurchasePeriodStart(
        "WEEKLY",
        new Date("2027-01-01T12:00:00Z"),
      )?.toISOString(),
    ).toBe("2026-12-28T00:00:00.000Z");
    expect(
      getItemPurchasePeriodStart(
        "MONTHLY",
        new Date("2028-02-29T12:00:00Z"),
      )?.toISOString(),
    ).toBe("2028-02-01T00:00:00.000Z");
  });
  it("keeps allowances separate when calendar period starts coincide", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    const counters = [
      { period: "DAILY" as const, periodStart: getItemPurchasePeriodStart("DAILY", now)!, quantity: 1 },
      { period: "WEEKLY" as const, periodStart: getItemPurchasePeriodStart("WEEKLY", now)!, quantity: 3 },
    ];
    expect(getItemPurchaseAllowance({ purchaseLimit: 5, purchaseLimitPeriod: "MONTHLY" }, counters, now).remaining).toBe(5);
    expect(getItemPurchaseAllowance({ purchaseLimit: 5, purchaseLimitPeriod: "WEEKLY" }, counters, now).remaining).toBe(2);
    expect(getItemPurchaseAllowance({ purchaseLimit: 5, purchaseLimitPeriod: "DAILY" }, counters, now).remaining).toBe(4);
  });
  it("NONE ignores any stored quantity", () => {
    expect(
      getItemPurchaseAllowance(
        { purchaseLimit: 1, purchaseLimitPeriod: "NONE" },
        [{ period: "DAILY", periodStart: now, quantity: 10 }],
        now,
      ),
    ).toMatchObject({ limit: null, remaining: null, purchased: 0 });
  });
  it("clamps remaining when staff lower the configured limit", () => {
    expect(
      getItemPurchaseAllowance(
        { purchaseLimit: 1, purchaseLimitPeriod: "DAILY" },
        [{ period: "DAILY", periodStart: getItemPurchasePeriodStart("DAILY", now)!, quantity: 10 }],
        now,
      ).remaining,
    ).toBe(0);
  });
});

describe("auction server price guard", () => {
  it.each([
    [null, null, 1, null],
    [10, null, 9, "at least"],
    [10, null, 10, null],
    [null, 20, 20, null],
    [null, 20, 21, "at most"],
    [0, 0, 1, "at most"],
  ])(
    "checks optional bounds %s to %s at %s",
    (auctionMinPrice, auctionMaxPrice, price, message) => {
      const result = getAuctionPriceError(
        {
          canBeTraded: true,
          auctionMinPrice: auctionMinPrice as number | null,
          auctionMaxPrice: auctionMaxPrice as number | null,
        },
        "AUCTION",
        price as number,
        1,
        "MONEY",
      );
      if (message) expect(result).toContain(message);
      else expect(result).toBeNull();
    },
  );
  it("ignores configured bounds when trading is disabled", () => {
    expect(
      getAuctionPriceError(
        { canBeTraded: false, auctionMinPrice: 10, auctionMaxPrice: 20 },
        "AUCTION",
        1,
        1,
        "MONEY",
      ),
    ).toBeNull();
  });
});
