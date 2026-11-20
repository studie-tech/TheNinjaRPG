import { beforeEach, describe, expect, it, vi } from "bun:test";
import {
  BALANCE_EXCLUSION_IDS,
  BALANCE_MIN_ROUNDS,
  type BattleType,
} from "@/drizzle/constants";
import { dataBattleAction, dataBattleTurnOrder } from "@/drizzle/schema";
import { getBalanceExclusion, hasActiveBalanceAction } from "@/libs/combat/balance";
import { saveUsage } from "@/libs/combat/database";
import type { BattleUserState, CombatResult } from "@/libs/combat/types";
import { summarizePlayerTurnOrder, summarizeTurnOrderBattles } from "@/libs/statistics";
import { selectPlayerTurnOrder } from "@/queries/balance";
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
    await resetTables(dataBattleAction, dataBattleTurnOrder);
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

  it("records each counted 1v1 once, naming the winner's starting order", async () => {
    await settle(duel());
    const db = await getTestDatabase();
    expect(await db.query.dataBattleTurnOrder.findMany()).toMatchObject([
      {
        battleType: "COMBAT",
        firstUserId: "winner",
        secondUserId: "loser",
        firstLevel: 50,
        firstRank: "JONIN",
        winner: 1,
      },
    ]);
    // A flee settled first is later upgraded by the opponent's win.
    await resetTables(dataBattleTurnOrder);
    const battle = duel();
    await saveUsage(db, battle, { outcome: "Fled" } as CombatResult, "loser");
    await saveUsage(db, battle, { outcome: "Won" } as CombatResult, "winner");
    expect((await db.query.dataBattleTurnOrder.findMany())[0]?.winner).toBe(1);
  });

  it("skips excluded and PvE battles in the per-battle record", async () => {
    await settle(duel({ round: 1 }));
    await settle(duel({ loser: [wait] }));
    await settle(duel({ battleType: "ARENA", loserIsAi: true }));
    const db = await getTestDatabase();
    expect(await db.query.dataBattleTurnOrder.findMany()).toHaveLength(0);
  });

  it("serves battle-level and staff per-player splits", async () => {
    const battle = duel();
    battle.extraState.balanceParticipants!.loser!.rank = "CHUNIN";
    await settle(battle);
    const caller = await callerFor(dataRouter, "viewer");
    const report = await caller.getBalanceOverview({});
    expect(summarizeTurnOrderBattles(report.turnOrderBattles)).toMatchObject({
      battles: 1,
      firstWins: 1,
      secondWins: 0,
    });
    // Both fighters must match a rank filter.
    for (const rank of ["CHUNIN", "JONIN"] as const)
      expect(
        (await caller.getBalanceOverview({ userRanks: [rank] })).turnOrderBattles,
      ).toEqual([]);
    expect(
      (await caller.getBalanceOverview({ userRanks: ["CHUNIN", "JONIN"] }))
        .turnOrderBattles,
    ).toHaveLength(1);
    await expect(caller.getPlayerTurnOrder({ userId: "winner" })).rejects.toThrow();
  });

  it("groups a player's wins, losses and draws in both starting positions", async () => {
    const db = await getTestDatabase();
    await db.insert(dataBattleTurnOrder).values(
      (
        [
          [1, 1],
          [1, 1],
          [1, 2],
          [2, 1],
          [2, 2],
          [2, 0],
        ] as const
      ).map(([turnOrder, winner], index) => ({
        battleId: `player-order-${index}`,
        periodStart: 1,
        battleType: "COMBAT" as const,
        firstUserId: turnOrder === 1 ? "player" : "opponent",
        secondUserId: turnOrder === 2 ? "player" : "opponent",
        winner,
      })),
    );
    const rows = await selectPlayerTurnOrder(db, "player");
    expect(
      rows.sort((a, b) => a.turnOrder - b.turnOrder || a.winner - b.winner),
    ).toEqual([
      { turnOrder: 1, winner: 1, count: 2 },
      { turnOrder: 1, winner: 2, count: 1 },
      { turnOrder: 2, winner: 0, count: 1 },
      { turnOrder: 2, winner: 1, count: 1 },
      { turnOrder: 2, winner: 2, count: 1 },
    ]);
    expect(await selectPlayerTurnOrder(db, "missing")).toEqual([]);
  });
});

describe("starting-turn summaries", () => {
  it("splits battles by the winner's starting order", () => {
    expect(
      summarizeTurnOrderBattles([
        { winner: 1, count: 6 },
        { winner: 2, count: 3 },
        { winner: 0, count: 1 },
      ]),
    ).toEqual({
      battles: 10,
      firstWins: 6,
      secondWins: 3,
      noWinner: 1,
      firstRate: "60.0%",
      secondRate: "30.0%",
    });
    expect(summarizeTurnOrderBattles([]).firstRate).toBe("—");
  });

  it("gives a player's share of first and second starts and the win rate in each", () => {
    expect(
      summarizePlayerTurnOrder([
        { turnOrder: 1, winner: 1, count: 3 },
        { turnOrder: 1, winner: 2, count: 1 },
        { turnOrder: 2, winner: 1, count: 1 },
      ]),
    ).toEqual([
      { turnOrder: 1, battles: 4, wins: 3, share: "80.0%", winRate: "75.0%" },
      { turnOrder: 2, battles: 1, wins: 0, share: "20.0%", winRate: "0.0%" },
    ]);
  });
});
