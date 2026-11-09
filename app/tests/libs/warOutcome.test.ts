import { describe, expect, it } from "bun:test";
import {
  FACTION_RAID_REWARD,
  OBJECTIVE_WAR_ATTACKER_COOLDOWN_DAYS,
  OBJECTIVE_WAR_DEFENDER_COOLDOWN_DAYS,
  WAR_ATTACKER_EXHAUSTION_MULTIPLIER,
  WAR_LOSING_COOLDOWN_DAYS,
  WAR_VICTORY_TOKEN_BONUS,
  WAR_WINNING_COOLDOWN_DAYS,
} from "@/drizzle/constants";
import { computeWarOutcome } from "@/libs/war";
import type { FetchActiveWarsReturnType } from "@/server/api/routers/war";
import { DAY_S, secondsFromDate } from "@/utils/time";
import { defaultWarRules } from "@/validators/war";

const endedAt = new Date("2026-10-12T12:00:00.000Z");
const ally = (villageId: string, supportVillageId: string) => ({
  villageId,
  supportVillageId,
});

const warFixture = (overrides: Record<string, unknown> = {}) =>
  ({
    type: "VILLAGE_WAR",
    rules: null,
    attackerVillageId: "attacker",
    defenderVillageId: "defender",
    attackerVillage: { tokens: 100 },
    defenderVillage: { tokens: 100 },
    attackerWarHealth: 50,
    defenderWarHealth: 40,
    warAllies: [],
    ...overrides,
  }) as unknown as FetchActiveWarsReturnType;

const outcome = (
  overrides: Record<string, unknown> = {},
  losingVillageId?: string,
  options: { shrineBuilderId?: string } = {},
) => computeWarOutcome(warFixture(overrides), losingVillageId, options, endedAt);

describe("computeWarOutcome", () => {
  it("names the side with more health when neither has lost", () => {
    expect(outcome()).toMatchObject({
      isDraw: false,
      status: "ATTACKER_VICTORY",
      winnerId: "attacker",
      loserId: "defender",
    });
    expect(outcome({ attackerWarHealth: 10 })).toMatchObject({
      status: "DEFENDER_VICTORY",
      winnerId: "defender",
      loserId: "attacker",
    });
  });

  it("calls equal health and a double defeat draws, with no winning villages", () => {
    for (const overrides of [
      { attackerWarHealth: 40 },
      { attackerWarHealth: 0, defenderWarHealth: 0 },
      { attackerVillage: { tokens: 0 }, defenderVillage: { tokens: 0 } },
    ]) {
      expect(outcome(overrides)).toMatchObject({
        isDraw: true,
        status: "DRAW",
        winningVillageIds: [],
        share: 0,
        winnerTokens: 0,
      });
    }
  });

  it("lets a surrender decide against the health totals", () => {
    expect(outcome({}, "attacker")).toMatchObject({
      status: "DEFENDER_VICTORY",
      winnerId: "defender",
    });
    expect(outcome({ attackerWarHealth: 10 }, "defender")).toMatchObject({
      status: "ATTACKER_VICTORY",
      winnerId: "attacker",
    });
  });

  it("treats an empty treasury as a defeat only in wars without rules", () => {
    const broke = { attackerVillage: { tokens: 0 } };
    expect(outcome(broke).winnerId).toBe("defender");
    expect(outcome({ ...broke, rules: defaultWarRules }).winnerId).toBe("attacker");
  });

  it("a shrine purchase defeats the defender", () => {
    expect(
      outcome({ type: "SECTOR_WAR", attackerWarHealth: 10 }, undefined, {
        shrineBuilderId: "kage",
      }),
    ).toMatchObject({ status: "ATTACKER_VICTORY", winnerId: "attacker" });
  });

  it("splits the bonus across allied winners and gives the remainder to the leader", () => {
    const result = outcome({
      warAllies: [
        ally("zeta", "attacker"),
        ally("beta", "attacker"),
        ally("x", "defender"),
      ],
    });
    const share = Math.floor(WAR_VICTORY_TOKEN_BONUS / 3);
    expect(result.winningVillageIds).toEqual(["attacker", "beta", "zeta"]);
    expect(result.share).toBe(share);
    expect(result.winnerTokens).toBe(share + (WAR_VICTORY_TOKEN_BONUS % 3));
  });

  describe("raids", () => {
    const raid = { type: "WAR_RAID", attackerVillage: { tokens: 0 } };

    it("pays only an attacking victory and never draws", () => {
      expect(outcome({ ...raid, defenderWarHealth: 0 })).toMatchObject({
        isDraw: false,
        status: "ATTACKER_VICTORY",
        winningVillageIds: ["attacker"],
        share: FACTION_RAID_REWARD,
        winnerTokens: FACTION_RAID_REWARD,
      });
      expect(outcome({ ...raid, attackerWarHealth: 0 })).toMatchObject({
        status: "DEFENDER_VICTORY",
        winningVillageIds: ["defender"],
        share: 0,
        winnerTokens: 0,
      });
    });

    it("gives a deadline raid to the defender, and a mutual defeat too", () => {
      expect(outcome(raid).winnerId).toBe("defender");
      expect(
        outcome({ ...raid, attackerWarHealth: 0, defenderWarHealth: 0 }).winnerId,
      ).toBe("defender");
    });
  });

  it("derives both cooldowns from the war's rules and the end date", () => {
    const days = (count: number) => secondsFromDate(count * DAY_S, endedAt);
    const cooldowns = (overrides: Record<string, unknown>) => {
      const { attackerCooldown, defenderCooldown } = outcome(overrides);
      return [attackerCooldown, defenderCooldown];
    };
    const exhausted = (count: number) =>
      days(count * WAR_ATTACKER_EXHAUSTION_MULTIPLIER);
    expect(cooldowns({})).toEqual([
      exhausted(WAR_WINNING_COOLDOWN_DAYS),
      days(WAR_LOSING_COOLDOWN_DAYS),
    ]);
    expect(cooldowns({ attackerWarHealth: 10 })).toEqual([
      exhausted(WAR_LOSING_COOLDOWN_DAYS),
      days(WAR_WINNING_COOLDOWN_DAYS),
    ]);
    expect(cooldowns({ rules: defaultWarRules })).toEqual([
      days(WAR_WINNING_COOLDOWN_DAYS),
      days(OBJECTIVE_WAR_DEFENDER_COOLDOWN_DAYS),
    ]);
    expect(cooldowns({ rules: defaultWarRules, attackerWarHealth: 10 })).toEqual([
      days(OBJECTIVE_WAR_ATTACKER_COOLDOWN_DAYS),
      days(WAR_WINNING_COOLDOWN_DAYS),
    ]);
  });
});
