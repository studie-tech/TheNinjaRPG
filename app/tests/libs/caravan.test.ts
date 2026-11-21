import { describe, expect, it } from "bun:test";
import {
  BANDIT_REQUIRED_EXP,
  CARAVAN_CHECKPOINTS,
  CARAVAN_GUARD_DELIVERY_RYO,
  CARAVAN_GUARD_OBJECTIVE_RYO,
  CARAVAN_MAX_DELAY_MINUTES,
  CARAVAN_MAX_GUARD_OBJECTIVES,
  CARAVAN_MAX_LOSS_BP,
  CARAVAN_STEALTH_BASE_CHANCE,
  CARAVAN_STEALTH_MAX_CHANCE,
  TRADE_ROUTE_BASE_TRAVEL_MINUTES,
  TRADE_ROUTE_MAX_MARKERS,
} from "@/drizzle/constants";
import type { VillageAlliance } from "@/drizzle/schema";
import {
  findSectorPath,
  getAllowedDelay,
  getAllowedLoss,
  getAttackerRole,
  getBanditRank,
  getCaravanSector,
  getGuardReward,
  getJourneyProgress,
  getOperationChance,
  getOperationMinutes,
  getReachedCheckpoints,
  getRemainingCargo,
  getRouteTravelMinutes,
  getStealBp,
  getStealthChance,
  getTradeBlock,
  planRouteMarkers,
  splitLoot,
} from "@/libs/caravan";
import { sectorGridNeighbors } from "@/libs/sector-map/world-grid";

const relation = (status: VillageAlliance["status"]): VillageAlliance => ({
  id: "r",
  villageIdA: "a",
  villageIdB: "b",
  status,
  createdAt: null,
  updatedAt: null,
});

describe("findSectorPath", () => {
  it("returns a contiguous shortest path including both ends", () => {
    const path = findSectorPath(100, 105);
    expect(path).toEqual([100, 101, 102, 103, 104, 105]);
  });

  it("only steps between grid neighbours", () => {
    const path = findSectorPath(150, 600) ?? [];
    expect(path[0]).toBe(150);
    expect(path.at(-1)).toBe(600);
    for (let i = 1; i < path.length; i++)
      expect(sectorGridNeighbors(path[i - 1] as number)).toContain(path[i] as number);
  });

  it("treats a village trading with its own sector as a single step", () => {
    expect(findSectorPath(42, 42)).toEqual([42]);
  });
});

describe("trade route rules", () => {
  it("travels 2 hours at level 1 and 5% faster each level", () => {
    expect(getRouteTravelMinutes(1)).toBe(TRADE_ROUTE_BASE_TRAVEL_MINUTES);
    expect(getRouteTravelMinutes(2)).toBe(114);
    expect(getRouteTravelMinutes(10)).toBe(66);
  });

  it("places between one and the maximum markers on interior sectors only", () => {
    const path = Array.from({ length: 40 }, (_, i) => 200 + i);
    const markers = planRouteMarkers(path, () => 0.5);
    expect(markers.length).toBe(TRADE_ROUTE_MAX_MARKERS);
    for (const marker of markers) {
      expect(path.slice(1, -1)).toContain(marker.sector);
      expect(marker.longitude).toBeGreaterThanOrEqual(3);
    }
    expect(new Set(markers.map((m) => m.sector)).size).toBe(markers.length);
    expect(planRouteMarkers([1, 2])).toEqual([]);
  });

  it("blocks enemies and warring villages but lets allies and neutrals trade", () => {
    expect(getTradeBlock([relation("ENEMY")], "a", "b", false)).toBeString();
    expect(getTradeBlock([relation("ALLY")], "a", "b", true)).toBeString();
    expect(getTradeBlock([relation("ALLY")], "a", "b", false)).toBeNull();
    expect(getTradeBlock([relation("NEUTRAL")], "a", "b", false)).toBeNull();
    expect(getTradeBlock([], "a", "a", false)).toBeString();
  });
});

describe("journey progress", () => {
  const departedAt = new Date("2026-01-01T00:00:00Z");
  const arrivesAt = new Date("2026-01-01T01:40:00Z");
  const journey = {
    departedAt,
    arrivesAt,
    status: "TRAVELLING" as const,
    path: [10, 11, 12, 13, 14],
  };
  const at = (minutes: number) => new Date(departedAt.getTime() + minutes * 60_000);

  it("moves along the frozen path as time passes", () => {
    expect(getJourneyProgress(journey, at(50))).toBe(0.5);
    expect(getCaravanSector(journey, at(0))).toBe(10);
    expect(getCaravanSector(journey, at(50))).toBe(12);
    expect(getCaravanSector(journey, at(99))).toBe(14);
    expect(getCaravanSector({ ...journey, status: "PREPARING" }, at(50))).toBe(10);
  });

  it("passes evenly spaced checkpoints before arrival", () => {
    expect(getReachedCheckpoints(journey, at(19))).toBe(0);
    expect(getReachedCheckpoints(journey, at(21))).toBe(1);
    expect(getReachedCheckpoints(journey, at(100))).toBe(CARAVAN_CHECKPOINTS);
  });
});

describe("cargo losses", () => {
  const cargo = [
    { itemId: "ore", quantity: 300 },
    { itemId: "herb", quantity: 7 },
  ];

  it("removes a share of every line, rounding down", () => {
    expect(getRemainingCargo(cargo, 1000)).toEqual([
      { itemId: "ore", quantity: 270 },
      { itemId: "herb", quantity: 6 },
    ]);
  });

  it("shares one loss and delay cap between every attacker", () => {
    expect(getAllowedLoss(0, 1000)).toBe(1000);
    expect(getAllowedLoss(CARAVAN_MAX_LOSS_BP - 200, 1000)).toBe(200);
    expect(getAllowedLoss(CARAVAN_MAX_LOSS_BP, 1000)).toBe(0);
    expect(getAllowedDelay(CARAVAN_MAX_DELAY_MINUTES - 5, 10)).toBe(5);
    expect(getAllowedDelay(CARAVAN_MAX_DELAY_MINUTES, 10)).toBe(0);
  });

  it("splits stolen goods evenly, giving the remainder to the leader", () => {
    const loot = splitLoot(cargo, 2000, ["leader", "second", "third"]);
    expect(loot.get("leader")).toEqual([
      { itemId: "ore", quantity: 20 },
      { itemId: "herb", quantity: 1 },
    ]);
    expect(loot.get("second")).toEqual([{ itemId: "ore", quantity: 20 }]);
    expect(loot.get("third")).toEqual([{ itemId: "ore", quantity: 20 }]);
  });
});

describe("roles and rewards", () => {
  const villager = { isOutlaw: false, isBandit: false, villageId: "a" };

  it("pays escorts only for completed objectives, up to a cap", () => {
    expect(getGuardReward(0)).toBe(0);
    expect(getGuardReward(CARAVAN_MAX_GUARD_OBJECTIVES + 20)).toBe(
      CARAVAN_GUARD_DELIVERY_RYO +
        CARAVAN_MAX_GUARD_OBJECTIVES * CARAVAN_GUARD_OBJECTIVE_RYO,
    );
    expect(getGuardReward(2)).toBe(
      CARAVAN_GUARD_DELIVERY_RYO + 2 * CARAVAN_GUARD_OBJECTIVE_RYO,
    );
  });

  it("decides sides from village relations and the bandit profession", () => {
    expect(getAttackerRole(villager, "b", [relation("ENEMY")], false)).toBe("ENEMY");
    expect(getAttackerRole(villager, "b", [relation("NEUTRAL")], true)).toBe("ENEMY");
    expect(getAttackerRole(villager, "b", [relation("ALLY")], false)).toBeNull();
    expect(getAttackerRole(villager, "a", [], true)).toBeNull();
    const outlaw = { isOutlaw: true, isBandit: false, villageId: "s" };
    expect(getAttackerRole(outlaw, "b", [], false)).toBeNull();
    expect(getAttackerRole({ ...outlaw, isBandit: true }, "b", [], false)).toBe(
      "BANDIT",
    );
  });

  it("ranks bandits by experience with faster scouting and bigger hauls", () => {
    expect(getBanditRank(0)).toBe("HIGHWAYMAN");
    expect(getBanditRank(BANDIT_REQUIRED_EXP.MARAUDER)).toBe("MARAUDER");
    expect(getBanditRank(BANDIT_REQUIRED_EXP["BANDIT CHIEF"])).toBe("BANDIT CHIEF");
    expect(getOperationChance("BANDIT", { stealth: 0, banditExperience: 0 })).toBe(20);
    expect(getOperationMinutes("SEARCH", "BANDIT", 0)).toBe(10);
    expect(
      getOperationMinutes("SEARCH", "BANDIT", BANDIT_REQUIRED_EXP["BANDIT CHIEF"]),
    ).toBe(3);
    expect(getOperationMinutes("DELAY", "ENEMY", 0)).toBe(5);
    expect(getStealBp(BANDIT_REQUIRED_EXP.MARAUDER)).toBe(1000);
  });

  it("scales covert chance with stealth up to the cap", () => {
    expect(getStealthChance(1000)).toBe(CARAVAN_STEALTH_BASE_CHANCE);
    expect(getStealthChance(6000)).toBe(CARAVAN_STEALTH_BASE_CHANCE + 10);
    expect(getStealthChance(1_000_000)).toBe(CARAVAN_STEALTH_MAX_CHANCE);
  });
});
