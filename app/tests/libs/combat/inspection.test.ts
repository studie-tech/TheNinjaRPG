import { describe, expect, it } from "bun:test";
import {
  holdsPin,
  inspectsBattlefieldTap,
  resolveCombatInspection,
} from "@/libs/combat/inspection";
import type { ReturnedBattle } from "@/libs/combat/types";

const snapshot = () =>
  ({
    id: "battle",
    usersState: [
      { userId: "me", direction: "left", curHealth: 100 },
      { userId: "ally", direction: "left", curHealth: 90 },
      { userId: "dead", direction: "right", curHealth: 0 },
      { userId: "enemy", direction: "right", curHealth: 80 },
      { userId: "pet", direction: "left", curHealth: 40, isSummon: true },
    ],
  }) as ReturnedBattle;

describe("combat inspection", () => {
  it("defaults to a living enemy even when allies precede enemies", () => {
    expect(resolveCombatInspection(snapshot(), "me", null)?.userId).toBe("enemy");
  });
  it.each(["ally", "pet", "dead", "me"])(
    "allows explicit inspection of %s",
    (userId) => {
      expect(
        resolveCombatInspection(snapshot(), "me", { battleId: "battle", userId })
          ?.userId,
      ).toBe(userId);
    },
  );
  it("uses the displayed snapshot and its current resource values", () => {
    const shown = snapshot();
    const selection = { battleId: shown.id, userId: "enemy" };
    shown.usersState[3]!.curHealth = 12;
    expect(resolveCombatInspection(shown, "me", selection)?.curHealth).toBe(12);
    shown.usersState = shown.usersState.filter((user) => user.userId !== "enemy");
    expect(resolveCombatInspection(shown, "me", selection)?.userId).toBe("dead");
  });
  it("falls back for a different battle or participants who leave or flee", () => {
    const shown = snapshot();
    expect(
      resolveCombatInspection(shown, "me", { battleId: "old", userId: "ally" })?.userId,
    ).toBe("enemy");
    for (const flag of ["leftBattle", "fledBattle"] as const) {
      const next = snapshot();
      next.usersState[1]![flag] = true;
      expect(
        resolveCombatInspection(next, "me", { battleId: next.id, userId: "ally" })
          ?.userId,
      ).toBe("enemy");
    }
  });
  it("handles absent battles and a roster without enemies", () => {
    expect(resolveCombatInspection(null, "me", null)).toBeUndefined();
    const shown = snapshot();
    shown.usersState = shown.usersState.filter((user) => user.direction === "left");
    expect(resolveCombatInspection(shown, "me", null)).toBeUndefined();
  });
});

describe("battlefield tap inspection", () => {
  it.each([
    ["me", false, true],
    ["ally", false, true],
    ["pet", false, true],
    ["enemy", false, true],
    ["me", true, false],
    ["ally", true, false],
    ["pet", true, false],
    ["enemy", true, true],
  ] as const)("tapping %s, aiming: %p, inspects: %p", (userId, aims, inspects) => {
    expect(inspectsBattlefieldTap(snapshot(), "me", userId, aims)).toBe(inspects);
  });
  it("inspects when the viewer is not a fighter", () => {
    expect(inspectsBattlefieldTap(snapshot(), "spectator", "ally", true)).toBe(true);
  });
});

describe("pinned inspection", () => {
  const pin = (userId: string) => ({ battleId: "battle", userId, pinned: true });
  it("holds a pin on a living fighter of the shown battle", () => {
    expect(holdsPin(snapshot(), pin("enemy"))).toBe(true);
  });
  it.each([
    ["a defeated fighter", snapshot(), pin("dead")],
    ["a fighter who is gone", snapshot(), pin("nobody")],
    [
      "a fighter who fled",
      (() => {
        const shown = snapshot();
        shown.usersState[3]!.fledBattle = true;
        return shown;
      })(),
      pin("enemy"),
    ],
    ["another battle", snapshot(), { ...pin("enemy"), battleId: "old" }],
    ["a followed tap", snapshot(), { battleId: "battle", userId: "enemy" }],
    ["no selection", snapshot(), null],
  ] as const)("releases %s", (_, shown, selection) => {
    expect(holdsPin(shown, selection)).toBe(false);
  });
});
