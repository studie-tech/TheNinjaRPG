import { describe, expect, it } from "bun:test";
import { resourceSiloBattlePoints, rollResourceSiloRewards } from "@/libs/resourceSilos";
import { getResourceSiloWindow } from "@/utils/time";
import { ResourceSiloEntry, ResourceSiloSelection } from "@/validators/resourceSilos";
import { ObjectiveReward } from "@/validators/rewards";
import { makeBattleUser, makeCompleteBattle } from "../setup/combat";

const friday = new Date("2026-11-13T12:00:00Z");
const battle = () => makeCompleteBattle({
  battleType: "COMBAT",
  extraState: { resourceSiloWindowId: friday.toISOString() },
  usersState: [makeBattleUser("player", { sector: 335, isAi: false, direction: "left" }), makeBattleUser("foe", { sector: 335, isAi: false, direction: "right" })],
});

describe("resource silo UTC windows", () => {
  it.each([
    ["2026-11-12T23:59:59.999Z", false, "2026-11-13T00:00:00.000Z"],
    ["2026-11-13T00:00:00Z", true, "2026-11-13T00:00:00.000Z"],
    ["2026-11-13T00:59:59.999Z", true, "2026-11-13T00:00:00.000Z"],
    ["2026-11-13T01:00:00Z", false, "2026-11-13T03:00:00.000Z"],
    ["2026-11-14T12:00:00Z", true, "2026-11-14T12:00:00.000Z"],
    ["2026-11-15T21:00:00Z", true, "2026-11-15T21:00:00.000Z"],
    ["2026-11-15T22:00:00Z", false, "2026-11-20T00:00:00.000Z"],
    ["2026-11-16T00:00:00Z", false, "2026-11-20T00:00:00.000Z"],
  ] as const)("%s", (instant, active, next) => {
    const date = new Date(instant);
    const window = getResourceSiloWindow(date);
    expect(window.active).toBe(active);
    expect(window.next.toISOString()).toBe(next);
    expect(date.toISOString()).toBe(new Date(instant).toISOString());
    expect(window.end.getTime() - window.start.getTime()).toBe(3600000);
  });
});

describe("resource silo PvP points", () => {
  it.each([["Won", 10], ["Lost", 5], ["Fled", 5], ["Draw", 0]] as const)("%s gives %d", (outcome, points) => {
    expect(resourceSiloBattlePoints(battle(), "player", { outcome }, friday)).toBe(points);
  });
  it("credits human teammates individually, ignoring allied and summoned opponents", () => {
    const state = battle();
    state.usersState.push(makeBattleUser("ally", { sector: 335, isAi: false, direction: "left" }));
    expect(resourceSiloBattlePoints(state, "ally", { outcome: "Won" }, friday)).toBe(10);
    state.usersState[1]!.isSummon = true;
    expect(resourceSiloBattlePoints(state, "player", { outcome: "Won" }, friday)).toBe(0);
  });
  it("excludes AI, sparring, other sectors, exhibitions, closed windows and cross-window fights", () => {
    for (const alter of [
      (s: ReturnType<typeof battle>) => { s.usersState[1]!.isAi = true; },
      (s: ReturnType<typeof battle>) => { s.usersState[0]!.isAi = true; },
      (s: ReturnType<typeof battle>) => { s.usersState[0]!.sector = 334; },
      (s: ReturnType<typeof battle>) => { s.battleType = "SPARRING"; },
      (s: ReturnType<typeof battle>) => { s.extraState.tournamentGameId = "event"; },
      (s: ReturnType<typeof battle>) => { s.extraState.resourceSiloWindowId = "old"; },
    ]) {
      const state = battle(); alter(state);
      expect(resourceSiloBattlePoints(state, "player", { outcome: "Won" }, friday)).toBe(0);
    }
    expect(resourceSiloBattlePoints(battle(), "player", { outcome: "Won" }, new Date("2026-11-13T13:00:00Z"))).toBe(0);
  });
});

describe("independent silo drops", () => {
  const entry = (sourceId: string, chance: number) => ResourceSiloEntry.parse({ kind: "package", sourceId, name: sourceId, chance, rewards: ObjectiveReward.parse({ reward_money: 10 }) });
  it("allows multiple drops and zero drops without normalizing percentages", () => {
    const entries = [entry("a", 50), entry("b", 50), entry("c", 0)];
    expect(rollResourceSiloRewards(entries, () => 0).rewards.reward_money).toBe(20);
    expect(rollResourceSiloRewards(entries, () => 0.5).drops).toHaveLength(0);
    expect(rollResourceSiloRewards([entry("a", 100)], () => 0.999).drops).toHaveLength(1);
  });
  it("rejects invalid chances", () => {
    for (const chance of [-1, 101, NaN, Infinity]) expect(ResourceSiloSelection.safeParse({ kind: "cache", sourceId: "id", chance }).success).toBe(false);
  });
});
