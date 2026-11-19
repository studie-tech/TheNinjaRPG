import { beforeEach, describe, expect, it, vi } from "bun:test";
import {
  BALANCE_EXCLUSION_IDS,
  BALANCE_MIN_ROUNDS,
  type BattleType,
} from "@/drizzle/constants";
import { dataBattleAction } from "@/drizzle/schema";
import { getBalanceExclusion, hasActiveBalanceAction } from "@/libs/combat/balance";
import { saveUsage } from "@/libs/combat/database";
import type { BattleUserState, CombatResult } from "@/libs/combat/types";
import { dataRouter } from "@/server/api/routers/data";
import { makeBattleUser, makeCompleteBattle } from "../../setup/combat";
import { stubRateLimitTransport } from "../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

type Action = BattleUserState["usedActions"][number];
const fire: Action = { id: "fire", type: "jutsu" };
const wait: Action = { id: "wait", type: "basic" };
const flee: Action = { id: "flee", type: "basic" };

/** A 1v1 between two humans (or a human and an AI) that reached `round`. */
const duel = ({
  round = BALANCE_MIN_ROUNDS,
  battleType = "COMBAT" as BattleType,
  winner = [fire] as Action[],
  loser = [fire] as Action[],
  loserIsAi = false,
} = {}) =>
  makeCompleteBattle({
    battleType,
    round,
    usersState: [
      makeBattleUser("winner", {
        direction: "left",
        bloodlineId: "blood",
        usedActions: winner,
      }),
      makeBattleUser("loser", {
        direction: "right",
        isAi: loserIsAi,
        controllerId: loserIsAi ? "npc" : "loser",
        bloodlineId: loserIsAi ? null : "blood",
        usedActions: loser,
      }),
    ],
    extraState: {
      balanceParticipants: {
        winner: { level: 50, rank: "JONIN", turnOrder: 1 },
        loser: { level: 50, rank: "JONIN", turnOrder: 2 },
      },
    },
  });

describe("balance activity filter", () => {
  it("only treats End Turn and Flee as idle actions", () => {
    expect(hasActiveBalanceAction({ usedActions: [] })).toBe(false);
    expect(hasActiveBalanceAction({ usedActions: [wait, flee, wait] })).toBe(false);
    expect(
      hasActiveBalanceAction({ usedActions: [wait, { id: "move", type: "basic" }] }),
    ).toBe(true);
    expect(hasActiveBalanceAction({ usedActions: [fire] })).toBe(true);
  });

  it("counts a battle that reached the minimum round with both sides acting", () => {
    const battle = duel();
    expect(getBalanceExclusion(battle, "winner")).toBeNull();
    expect(getBalanceExclusion(battle, "loser")).toBeNull();
  });

  it("excludes battles that ended before the minimum round", () => {
    const battle = duel({ round: BALANCE_MIN_ROUNDS - 1 });
    expect(getBalanceExclusion(battle, "winner")).toBe("short");
    expect(getBalanceExclusion(battle, "loser")).toBe("short");
  });

  it("excludes both players when the opponent only waited, fled or timed out", () => {
    for (const loser of [[], [wait], [wait, flee]]) {
      const battle = duel({ loser });
      expect(getBalanceExclusion(battle, "winner")).toBe("idle");
      expect(getBalanceExclusion(battle, "loser")).toBe("idle");
    }
  });

  it("treats AI opponents as active, so PvE only depends on the human", () => {
    expect(getBalanceExclusion(duel({ loserIsAi: true, loser: [] }), "winner")).toBe(
      null,
    );
    expect(
      getBalanceExclusion(duel({ loserIsAi: true, winner: [wait] }), "winner"),
    ).toBe("idle");
  });

  it("keeps an active side's members but drops an idle teammate", () => {
    const battle = duel();
    battle.usersState.push(
      makeBattleUser("afk", { direction: "left", usedActions: [] }),
      makeBattleUser("summon", { direction: "right", isSummon: true, usedActions: [] }),
    );
    expect(getBalanceExclusion(battle, "winner")).toBeNull();
    expect(getBalanceExclusion(battle, "loser")).toBeNull();
    expect(getBalanceExclusion(battle, "afk")).toBe("idle");
  });
});

describeWithDatabase("balance usage with the activity filter", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    stubRateLimitTransport();
    await resetTables(dataBattleAction);
  });

  const settle = async (battle: ReturnType<typeof duel>) => {
    const db = await getTestDatabase();
    await saveUsage(db, battle, { outcome: "Won" } as CombatResult, "winner");
    if (!battle.usersState[1]!.isAi)
      await saveUsage(db, battle, { outcome: "Lost" } as CombatResult, "loser");
    return db.query.dataBattleAction.findMany();
  };

  it("records content, bloodline and head-to-head samples for a normal PvP battle", async () => {
    const rows = await settle(duel());
    expect(rows.filter((r) => r.type === "jutsu").map((r) => r.battleWon)).toEqual(
      expect.arrayContaining([0, 1]),
    );
    expect(rows.filter((r) => r.type === "bloodline")).toHaveLength(2);
    expect(
      rows.filter((r) => r.type === "participant").map((r) => r.turnOrder),
    ).toEqual(expect.arrayContaining([1, 2]));
    expect(rows.some((r) => r.contentId.startsWith("excluded"))).toBe(false);
  });

  it("records only exclusion counters against an AFK opponent", async () => {
    const rows = await settle(duel({ loser: [wait] }));
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "participant",
          contentId: BALANCE_EXCLUSION_IDS.idle,
          battleWon: 1,
          turnOrder: 0,
        }),
        expect.objectContaining({
          type: "participant",
          contentId: BALANCE_EXCLUSION_IDS.idle,
          battleWon: 0,
          turnOrder: 0,
        }),
      ]),
    );
  });

  it("records only exclusion counters for a short battle", async () => {
    const rows = await settle(duel({ round: 1 }));
    expect(rows.map((r) => r.contentId)).toEqual([
      BALANCE_EXCLUSION_IDS.short,
      BALANCE_EXCLUSION_IDS.short,
    ]);
  });

  it("records PvE usage and AI samples when the player fought, but not when idle", async () => {
    const active = await settle(duel({ battleType: "ARENA", loserIsAi: true }));
    expect(active.filter((r) => r.type === "ai")).toMatchObject([
      { contentId: "npc", battleWon: 0 },
    ]);
    expect(active.filter((r) => r.type === "jutsu")).toHaveLength(1);
    await resetTables(dataBattleAction);
    const idle = await settle(
      duel({ battleType: "ARENA", loserIsAi: true, winner: [wait] }),
    );
    expect(idle).toMatchObject([
      { type: "participant", contentId: BALANCE_EXCLUSION_IDS.idle },
    ]);
  });

  it("reports excluded results in the balance overview, respecting its filters", async () => {
    await settle(duel({ round: 1 }));
    await settle(duel({ loser: [] }));
    await settle(duel());
    const caller = await callerFor(dataRouter, "viewer");
    const report = await caller.getBalanceOverview({});
    expect(report.exclusions).toEqual({ short: 2, idle: 2 });
    expect(report.participants.reduce((sum, r) => sum + r.count, 0)).toBe(2);
    expect(
      (await caller.getBalanceOverview({ battleTypes: ["ARENA"] })).exclusions,
    ).toEqual({ short: 0, idle: 0 });
  });
});
