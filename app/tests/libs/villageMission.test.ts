import { expect, it } from "bun:test";
import type { Quest } from "@/drizzle/schema";
import { applyEffects } from "@/libs/combat/process";
import { alignBattle } from "@/libs/combat/turn";
import type { CombatResult } from "@/libs/combat/types";
import { claimVillageMissionPvpKills } from "@/libs/combat/villageMission";
import {
  isVillageMissionAvailable,
  villageMissionCompletionEvents,
} from "@/libs/villageMission";
import { villageMissionContentError } from "@/validators/villageMission";
import { makeBattleUser, makeCompleteBattle } from "../setup/combat";

it.each([
  ["D", 1],
  ["C", 3],
  ["B", 7],
  ["A", 14],
] as const)("credits %s missions with %s shared points", (questRank, points) => {
  expect(villageMissionCompletionEvents({ questType: "mission", questRank })).toEqual({
    [`${questRank.toLowerCase()}_missions_total`]: 1,
    combined_mission_effort: points,
  });
});

it("counts defeated human opponents while excluding escapees, allies, summons and AI", () => {
  const battle = makeCompleteBattle({
    usersState: [
      makeBattleUser("winner", { villageId: "v1", direction: "left" }),
      makeBattleUser("dead", { direction: "right", curHealth: 0, leftBattle: true }),
      makeBattleUser("fled", { direction: "right", curHealth: 0, fledBattle: true }),
      makeBattleUser("alive", { direction: "right", curHealth: 100 }),
      makeBattleUser("ally", { direction: "left", curHealth: 0 }),
      makeBattleUser("ai", { direction: "right", curHealth: 0, isAi: true }),
      makeBattleUser("summon", { direction: "right", curHealth: 0, isSummon: true }),
    ],
  });
  const result = { didWin: 1 } as CombatResult;
  expect(claimVillageMissionPvpKills(battle, "winner", result)).toBe(1);
  expect(
    claimVillageMissionPvpKills(
      { ...battle, battleType: "SPARRING" },
      "winner",
      result,
    ),
  ).toBe(0);
  expect(claimVillageMissionPvpKills(battle, "winner", { ...result, didWin: 0 })).toBe(
    0,
  );
});

it.each([
  ["2026-10-18T23:59:59.999Z", true],
  ["2026-10-19T00:00:00.000Z", false],
  ["2026-10-19T17:17:00.000Z", false],
])(
  "stops offering a mission at midnight UTC of its end date (%s)",
  (now, available) => {
    const mission = {
      questType: "village_mission",
      hidden: false,
      consecutiveObjectives: false,
      endsAt: "2026-10-19",
      content: {
        reward: { reward_tokens: 100 },
        objectives: [
          { id: "x", task: "siege_operation", description: "Siege", value: 1 },
        ],
      },
    } as unknown as Quest;
    expect(isVillageMissionAvailable(mission, "v1", new Date(now))).toBe(available);
  },
);

it("rejects story objectives and sequential village missions", () => {
  const content = {
    reward: { reward_tokens: 100 },
    objectives: [{ id: "x", task: "siege_operation", description: "Siege", value: 1 }],
  };
  expect(villageMissionContentError(content, false)).toBeNull();
  expect(villageMissionContentError(content, true)).not.toBeNull();
  expect(
    villageMissionContentError({ ...content, reward: { reward_tokens: 0 } }, false),
  ).not.toBeNull();
  expect(
    villageMissionContentError(
      { ...content, objectives: [{ id: "x", task: "dialog" }] },
      false,
    ),
  ).not.toBeNull();
  expect(
    villageMissionContentError(
      {
        ...content,
        objectives: [{ ...content.objectives[0], attackers: [{ id: "ai" }] }],
      },
      false,
    ),
  ).not.toBeNull();
  expect(
    villageMissionCompletionEvents({ questType: "crime", questRank: "A" }),
  ).toEqual({});
});

it.each([false, true])(
  "counts group PvP defeats once per village regardless of settlement order (reversed: %s)",
  (reversed) => {
    const usersState = [
      makeBattleUser("winner-a", {
        villageId: "v1",
        direction: "left",
        leftBattle: true,
      }),
      makeBattleUser("winner-b", { villageId: "v1", direction: "left" }),
      makeBattleUser("opponent-a", {
        villageId: "v2",
        direction: "right",
        curHealth: 0,
      }),
      makeBattleUser("opponent-b", {
        villageId: "v2",
        direction: "right",
        curHealth: 0,
        leftBattle: true,
      }),
    ];
    const battle = makeCompleteBattle({
      usersState: reversed ? usersState.reverse() : usersState,
    });
    const result = { didWin: 1 } as CombatResult;
    const winnerIds = reversed ? ["winner-b", "winner-a"] : ["winner-a", "winner-b"];
    expect(claimVillageMissionPvpKills(battle, winnerIds[0]!, result)).toBe(2);
    expect(claimVillageMissionPvpKills(battle, winnerIds[1]!, result)).toBe(0);
  },
);

it.each([{ curHealth: 0 }, { fledBattle: true }, { isAi: true }, { isSummon: true }])(
  "does not reserve group PvP credit for an ineligible participant (%j)",
  (overrides) => {
    const battle = makeCompleteBattle({
      usersState: [
        makeBattleUser("ally-a", { villageId: "v1", direction: "left", ...overrides }),
        makeBattleUser("winner", { villageId: "v1", direction: "left" }),
        makeBattleUser("opponent", {
          villageId: "v2",
          direction: "right",
          curHealth: 0,
        }),
      ],
    });
    expect(
      claimVillageMissionPvpKills(battle, "ally-a", {
        didWin: overrides.curHealth === 0 || overrides.fledBattle ? 0 : 1,
      } as CombatResult),
    ).toBe(0);
    expect(
      claimVillageMissionPvpKills(battle, "winner", { didWin: 1 } as CombatResult),
    ).toBe(1);
  },
);

it("keeps shared PvP credit reserved after lethal deferred damage to the settled winner", () => {
  const battle = makeCompleteBattle({
    battleType: "COMBAT",
    round: 3,
    activeUserId: "winner-a",
    roundStartAt: new Date(),
    usersState: [
      makeBattleUser("winner-a", {
        villageId: "v1",
        direction: "left",
        curHealth: 20,
        leftBattle: true,
        round: 3,
        diffuseDamage: [
          {
            attackerId: "opponent",
            sourceUserId: "opponent",
            remainingDamage: 30,
            remainingTurns: 1,
            lastAppliedRound: 3,
            creditDamage: true,
          },
        ],
      }),
      makeBattleUser("winner-b", { villageId: "v1", direction: "left", round: 3 }),
      makeBattleUser("opponent", {
        villageId: "v2",
        direction: "right",
        curHealth: 0,
        leftBattle: true,
      }),
    ],
    usersEffects: [],
  });
  expect(
    claimVillageMissionPvpKills(battle, "winner-a", { didWin: 1 } as CombatResult),
  ).toBe(1);
  const actId = battle.activeUserId;
  if (!actId) throw new Error("Missing active battle user");
  expect(alignBattle(battle, [], "winner-b").progressRound).toBe(true);
  const after = applyEffects(battle, actId).newBattle;
  expect(after.usersState.find((entry) => entry.userId === "winner-a")?.curHealth).toBe(
    0,
  );
  expect(
    claimVillageMissionPvpKills(after, "winner-b", { didWin: 1 } as CombatResult),
  ).toBe(0);
});
