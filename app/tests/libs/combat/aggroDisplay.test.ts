import { describe, expect, it } from "bun:test";
import { getAggroDisplay } from "@/libs/combat/aggroDisplay";
import type { ReturnedUserState } from "@/libs/combat/types";

const user = (overrides: Partial<ReturnedUserState>): ReturnedUserState =>
  ({
    userId: "tank",
    direction: "left",
    isAi: false,
    curHealth: 100,
    fledBattle: false,
    leftBattle: false,
    enmity: 1600,
    ...overrides,
  }) as ReturnedUserState;

const boss = user({ userId: "boss", direction: "right", isAi: true, enmity: 8000 });
const pveDisplay = (users: ReturnedUserState[]) => getAggroDisplay([...users, boss]);

describe("battlefield aggro comparison", () => {
  it("shows party threat against an NPC and counts player-controlled summons", () => {
    const display = pveDisplay([
      user({}),
      user({
        userId: "summon",
        isSummon: true,
        isAi: true,
        isPiloted: true,
        enmity: 800,
      }),
    ]);
    expect(display.get("tank")).toEqual({ enmity: 1600, ratio: 1, isHighest: true });
    expect(display.get("summon")).toEqual({
      enmity: 800,
      ratio: 0.5,
      isHighest: false,
    });
    expect(display.has("boss")).toBe(false);
  });

  it("excludes hidden, defeated, fled and departed combatants from the maximum", () => {
    const display = pveDisplay([
      user({}),
      user({ userId: "hidden", hidden: true, enmity: 8000 }),
      user({ userId: "dead", curHealth: 0, enmity: 8000 }),
      user({ userId: "fled", fledBattle: true, enmity: 8000 }),
      user({ userId: "left", leftBattle: true, enmity: 8000 }),
    ]);
    expect([...display.keys()]).toEqual(["tank"]);
    expect(display.get("tank")?.ratio).toBe(1);
  });

  it("leaves empty rings for zero or unset enmity and shows tied leaders equally", () => {
    const empty = pveDisplay([
      user({ enmity: undefined }),
      user({ userId: "zero", enmity: 0 }),
    ]);
    expect(empty.get("tank")).toEqual({ enmity: 0, ratio: 0, isHighest: false });
    expect(empty.get("zero")?.ratio).toBe(0);
    const tied = pveDisplay([user({}), user({ userId: "tie" })]);
    expect(tied.get("tie")).toEqual(tied.get("tank"));
  });

  it("recomputes relative fill when a different player becomes the leader", () => {
    const display = pveDisplay([user({}), user({ userId: "dps", enmity: 3200 })]);
    expect(display.get("tank")?.ratio).toBe(0.5);
    expect(display.get("tank")?.isHighest).toBe(false);
    expect(display.get("dps")?.ratio).toBe(1);
  });

  it("hides threat in PvP, including players using auto combat", () => {
    expect(
      getAggroDisplay([
        user({ isAutoCombat: true }),
        user({ userId: "opponent", direction: "right", isAutoCombat: true }),
      ]).size,
    ).toBe(0);
  });

  it("does not treat a player-piloted opposing summon as an NPC", () => {
    expect(
      getAggroDisplay([
        user({}),
        user({
          userId: "summon",
          direction: "right",
          isAi: true,
          isSummon: true,
          isPiloted: true,
        }),
      ]).size,
    ).toBe(0);
  });

  it("hides a side's threat after its last opposing NPC leaves active combat", () => {
    for (const state of [
      { hidden: true },
      { curHealth: 0 },
      { fledBattle: true },
      { leftBattle: true },
    ]) {
      expect(getAggroDisplay([user({}), { ...boss, ...state }]).size).toBe(0);
    }
  });

  it("compares both sides independently when each faces an autonomous NPC", () => {
    const display = pveDisplay([
      user({}),
      user({ userId: "ally-npc", isAi: true, isSummon: true, enmity: 800 }),
    ]);
    expect(display.get("tank")?.ratio).toBe(1);
    expect(display.get("ally-npc")?.ratio).toBe(0.5);
    expect(display.get("boss")?.ratio).toBe(1);
  });
});
