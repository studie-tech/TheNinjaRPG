import { describe, expect, it } from "bun:test";
import { getPurchasedAllowances } from "@/deltas/item";
import { KESSEN_PACK_IDS } from "@/libs/kessen/packs";

const weekly = (itemId: string, purchased: number) => ({
  itemId,
  period: "WEEKLY" as const,
  periodStart: new Date("2026-11-16T00:00:00Z"),
  limit: 3,
  purchased,
  remaining: 3 - purchased,
});

describe("shop purchase allowances", () => {
  it("uses up the bought listing and every listing sharing its limit", () => {
    const hyorin = KESSEN_PACK_IDS.village("HYORIN");
    const akasumi = KESSEN_PACK_IDS.village("AKASUMI");
    const next = getPurchasedAllowances(
      [weekly(hyorin, 1), weekly(akasumi, 1), weekly(KESSEN_PACK_IDS.paper, 0)],
      hyorin,
      2,
    );
    expect(
      next.map((entry) => [entry.itemId, entry.purchased, entry.remaining]),
    ).toEqual([
      [hyorin, 3, 0],
      [akasumi, 3, 0],
      [KESSEN_PACK_IDS.paper, 0, 3],
    ]);
  });

  it("leaves allowances alone for a listing it does not hold", () => {
    const allowances = [weekly(KESSEN_PACK_IDS.paper, 1)];
    expect(getPurchasedAllowances(allowances, "other-item", 1)).toBe(allowances);
  });
});
