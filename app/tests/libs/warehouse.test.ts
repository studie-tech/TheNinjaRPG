import { describe, expect, it } from "bun:test";
import {
  VILLAGE_SYNDICATE_ID,
  WAREHOUSE_ANBU_DAILY_ALLOWANCE,
  WAREHOUSE_APPROVED_DAILY_ALLOWANCE,
  WAREHOUSE_CONSTRUCTION_COST,
  WAREHOUSE_DAILY_ALLOWANCE,
  WAREHOUSE_LOYALTY_BONUS,
  WAREHOUSE_PRODUCTION_BASE_QUANTITY,
  WAREHOUSE_PRODUCTION_INTERVAL_HOURS,
  WAREHOUSE_PRODUCTION_MAX_CYCLES,
  WAREHOUSE_UPGRADE_COST,
} from "@/drizzle/constants";
import type { WarehouseMember } from "@/drizzle/schema";
import {
  canProduceItem,
  getCycleQuantity,
  getDepositAvailableAt,
  getDepositCredit,
  getDueProduction,
  getWithdrawalAllowance,
  isWarehouseStorable,
} from "@/libs/warehouse";
import { calcStructureUpgrade } from "@/utils/village";

const HOUR = 3_600_000;
const now = new Date("2026-06-15T12:00:00Z");

describe("production", () => {
  it("adds the level and raid bonus to each cycle and rounds it down", () => {
    expect(getCycleQuantity(0)).toBe(0);
    expect(getCycleQuantity(1)).toBe(WAREHOUSE_PRODUCTION_BASE_QUANTITY + 1);
    expect(getCycleQuantity(10)).toBe(110);
    expect(getCycleQuantity(5, 1.2)).toBe(106);
  });

  it("credits elapsed cycles up to the cap and moves the clock past all of them", () => {
    const interval = WAREHOUSE_PRODUCTION_INTERVAL_HOURS * HOUR;
    const settledAt = new Date(now.getTime() - interval * 2.5);
    const due = getDueProduction(settledAt, now);
    expect(due.cycles).toBe(2);
    expect(due.nextSettledAt.getTime()).toBe(settledAt.getTime() + 2 * interval);
    const idle = getDueProduction(new Date(now.getTime() - interval * 20), now);
    expect(idle.cycles).toBe(WAREHOUSE_PRODUCTION_MAX_CYCLES);
    expect(idle.nextSettledAt.getTime()).toBe(now.getTime());
  });

  it("lets faction settlements produce Syndicate goods only", () => {
    const item = {
      warehouseItem: true,
      canStack: true,
      itemType: "MATERIAL" as const,
      hidden: false,
      villageId: VILLAGE_SYNDICATE_ID,
    };
    expect(canProduceItem(item, { id: "hideout", type: "HIDEOUT" })).toBe(true);
    expect(canProduceItem(item, { id: "leaf", type: "VILLAGE" })).toBe(false);
    expect(
      canProduceItem({ ...item, villageId: "leaf" }, { id: "leaf", type: "VILLAGE" }),
    ).toBe(true);
    expect(isWarehouseStorable({ ...item, canStack: false })).toBe(false);
    expect(isWarehouseStorable({ ...item, itemType: "WEAPON" as const })).toBe(false);
  });
});

describe("deposits", () => {
  it("carries fractional bonuses so split deposits never round up", () => {
    const first = getDepositCredit(50, 3, undefined);
    expect(first).toEqual({
      bonus: 1,
      credited: 51,
      withdrawnUnits: 0,
      bonusCarry: 500,
    });
    const second = getDepositCredit(50, 3, first);
    expect(second.bonus).toBe(2);
    expect(second.bonusCarry).toBe(0);
    expect(first.bonus + second.bonus).toBe(Math.floor((100 * 3) / 100));
  });

  it("gives no bonus on units the player withdrew", () => {
    const credit = getDepositCredit(60, 20, { withdrawnUnits: 50, bonusCarry: 0 });
    expect(credit.bonus).toBe(2);
    expect(credit.credited).toBe(62);
    expect(credit.withdrawnUnits).toBe(0);
    const partial = getDepositCredit(50, 20, { withdrawnUnits: 80, bonusCarry: 0 });
    expect(partial.bonus).toBe(0);
    expect(partial.withdrawnUnits).toBe(30);
  });

  it("blocks the same item for two hours", () => {
    const ledger = { lastDepositAt: new Date(now.getTime() - HOUR) };
    expect(getDepositAvailableAt(ledger, now)?.getTime()).toBe(now.getTime() + HOUR);
    expect(
      getDepositAvailableAt({ lastDepositAt: new Date(now.getTime() - 3 * HOUR) }, now),
    ).toBeNull();
    expect(getDepositAvailableAt(undefined, now)).toBeNull();
  });
});

describe("withdrawal allowance", () => {
  const joinedVillageAt = new Date(now.getTime() - 10 * 24 * HOUR);
  const villager = {
    villageId: "leaf",
    joinedVillageAt,
    anbuId: null,
    isOutlaw: false,
  };
  const member = (values: Partial<WarehouseMember>): WarehouseMember => ({
    userId: "u",
    allowanceDay: null,
    allowanceUsed: 0,
    approvedVillageId: null,
    approvedAt: null,
    approvedWarId: null,
    ...values,
  });

  it("gives villagers 30, ANBU 40 and approved players 50", () => {
    expect(getWithdrawalAllowance(villager, undefined, [], now).total).toBe(
      WAREHOUSE_DAILY_ALLOWANCE,
    );
    expect(
      getWithdrawalAllowance({ ...villager, anbuId: "squad" }, undefined, [], now)
        .total,
    ).toBe(WAREHOUSE_ANBU_DAILY_ALLOWANCE);
    const approved = member({ approvedVillageId: "leaf", approvedAt: now });
    expect(
      getWithdrawalAllowance({ ...villager, anbuId: "squad" }, approved, [], now).total,
    ).toBe(WAREHOUSE_APPROVED_DAILY_ALLOWANCE);
  });

  it("adds the loyalty bonus after 60 days", () => {
    const loyal = {
      ...villager,
      joinedVillageAt: new Date(now.getTime() - 61 * 24 * HOUR),
    };
    const allowance = getWithdrawalAllowance(loyal, undefined, [], now);
    expect(allowance.loyaltyBonus).toBe(WAREHOUSE_LOYALTY_BONUS);
    expect(allowance.total).toBe(WAREHOUSE_DAILY_ALLOWANCE + WAREHOUSE_LOYALTY_BONUS);
  });

  it("keeps the day's usage across villages and resets it on a new UTC day", () => {
    const used = member({ allowanceDay: "2026-06-15", allowanceUsed: 25 });
    expect(getWithdrawalAllowance(villager, used, [], now).remaining).toBe(5);
    expect(
      getWithdrawalAllowance({ ...villager, villageId: "sand" }, used, [], now)
        .remaining,
    ).toBe(5);
    const yesterday = member({ allowanceDay: "2026-06-14", allowanceUsed: 30 });
    expect(getWithdrawalAllowance(villager, yesterday, [], now).remaining).toBe(30);
  });

  it("drops approvals after leaving the village and wartime ones after the war", () => {
    const before = member({
      approvedVillageId: "leaf",
      approvedAt: new Date(joinedVillageAt.getTime() - HOUR),
    });
    expect(getWithdrawalAllowance(villager, before, [], now).approved).toBe(false);
    const wartime = member({
      approvedVillageId: "leaf",
      approvedAt: now,
      approvedWarId: "war",
    });
    expect(getWithdrawalAllowance(villager, wartime, ["war"], now).approved).toBe(true);
    expect(getWithdrawalAllowance(villager, wartime, [], now).approved).toBe(false);
  });
});

describe("Warehouse construction cost", () => {
  it("charges fixed, untaxed prices to build and upgrade", () => {
    const village = {
      type: "VILLAGE",
      populationCount: 5000,
      structures: [],
    } as unknown as Parameters<typeof calcStructureUpgrade>[1];
    const structure = { route: "/warehouse", level: 0 } as Parameters<
      typeof calcStructureUpgrade
    >[0];
    expect(calcStructureUpgrade(structure, village).total).toBe(
      WAREHOUSE_CONSTRUCTION_COST,
    );
    expect(calcStructureUpgrade({ ...structure, level: 4 }, village).total).toBe(
      WAREHOUSE_UPGRADE_COST,
    );
  });
});
