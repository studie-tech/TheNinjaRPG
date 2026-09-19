import { describe, expect, it } from "vitest";
import type { UserData } from "@/drizzle/schema";
import {
  getVillageLoyaltyBonuses,
  getVillageLoyaltyDays,
  getVillageLoyaltyShopCost,
} from "@/libs/villageLoyalty";

const NOW = new Date("2026-09-19T12:00:00.000Z");

const villageMember = (days: number) =>
  ({
    isOutlaw: false,
    villageId: "village-1",
    joinedVillageAt: new Date(NOW.getTime() - days * 86_400_000),
  }) as UserData;

describe("village loyalty", () => {
  it("unlocks tiers only after each full membership day threshold", () => {
    expect(getVillageLoyaltyDays(villageMember(6.99), NOW)).toBe(6);
    expect(getVillageLoyaltyBonuses(villageMember(6.99), NOW).regen).toBe(0);
    expect(getVillageLoyaltyBonuses(villageMember(7), NOW).regen).toBe(5);
  });

  it("stacks repeated bonus categories", () => {
    const bonuses = getVillageLoyaltyBonuses(villageMember(100), NOW);
    expect(bonuses).toEqual({
      regen: 15,
      villageRewards: 13,
      statGains: 15,
      pvpRewards: 5,
      shopDiscount: 5,
      missionRewards: 5,
      masteryTraining: 30,
    });
  });

  it("grants no loyalty to outlaws or users without a village", () => {
    const outlaw = { ...villageMember(100), isOutlaw: true };
    const villageLess = { ...villageMember(100), villageId: null };
    expect(getVillageLoyaltyDays(outlaw, NOW)).toBe(0);
    expect(getVillageLoyaltyBonuses(outlaw, NOW).regen).toBe(0);
    expect(getVillageLoyaltyBonuses(villageLess, NOW).statGains).toBe(0);
  });

  it("applies the 40-day shop discount with currency-safe rounding", () => {
    expect(getVillageLoyaltyShopCost(101, villageMember(39), NOW)).toBe(101);
    expect(getVillageLoyaltyShopCost(101, villageMember(40), NOW)).toBe(96);
  });
});
