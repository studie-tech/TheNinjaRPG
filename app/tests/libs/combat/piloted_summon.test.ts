import { describe, it, expect } from "vitest";
import { shouldPilotSummon } from "@/libs/combat/summon";
import { maskBattle } from "@/libs/combat/util";
import type { Battle } from "@/drizzle/schema";
import type { BattleUserState } from "@/libs/combat/types";

describe("shouldPilotSummon", () => {
  const pveBattle = { battleType: "COMBAT" } as const;
  const kageBattle = { battleType: "KAGE_AI" } as const;
  const clanBattle = { battleType: "CLAN_CHALLENGE" } as const;

  it("pilots when the jutsu opts in, controller is a human, and battle is interactive", () => {
    expect(shouldPilotSummon({ isAi: false }, pveBattle, true)).toBe(true);
  });

  it("does NOT pilot when the jutsu is not playerControlled (flag off / absent)", () => {
    expect(shouldPilotSummon({ isAi: false }, pveBattle, false)).toBe(false);
    expect(shouldPilotSummon({ isAi: false }, pveBattle, undefined)).toBe(false);
  });

  it("does NOT pilot when controller is AI, even if the jutsu opts in", () => {
    expect(shouldPilotSummon({ isAi: true }, pveBattle, true)).toBe(false);
  });

  it("does NOT pilot when controller is missing, even if the jutsu opts in", () => {
    expect(shouldPilotSummon(undefined, pveBattle, true)).toBe(false);
  });

  it("does NOT pilot a human controller in KAGE_AI (AutoBattleTypes), even if opted in", () => {
    expect(shouldPilotSummon({ isAi: false }, kageBattle, true)).toBe(false);
  });

  it("does NOT pilot a human controller in CLAN_CHALLENGE (AutoBattleTypes), even if opted in", () => {
    expect(shouldPilotSummon({ isAi: false }, clanBattle, true)).toBe(false);
  });
});

describe("isPiloted masking round-trip", () => {
  const mkUser = (): BattleUserState =>
    ({
      userId: "u0",
      username: "x",
      controllerId: "u0",
      isAi: false,
      isSummon: false,
      isPiloted: false,
      curHealth: 100,
      fledBattle: false,
      leftBattle: false,
    }) as unknown as BattleUserState;

  it("keeps isPiloted in the public-masked state for an opponent viewer", () => {
    const summon = mkUser();
    summon.userId = "summon1";
    summon.controllerId = "player1";
    summon.isSummon = true;
    summon.isAi = true;
    summon.isPiloted = true;
    const battle = { usersState: [summon] } as unknown as Battle;
    const masked = maskBattle(battle, "opponentX");
    expect(masked.usersState[0]).toHaveProperty("isPiloted", true);
  });

  it("strips a private (non-allow-listed) field but retains isPiloted", () => {
    const summon = mkUser();
    summon.userId = "summon1";
    summon.controllerId = "player1";
    summon.isPiloted = true;
    summon.strength = 50; // privateState -> must be stripped for an opponent
    const battle = { usersState: [summon] } as unknown as Battle;
    const masked = maskBattle(battle, "opponentX");
    expect(masked.usersState[0]).not.toHaveProperty("strength");
    expect(masked.usersState[0]).toHaveProperty("isPiloted", true);
  });
});
