import { describe, expect, it } from "vitest";
import { buildCombatTrackerTasks } from "@/libs/combat/util";
import { makeBattleUser } from "./helpers/battleScenario";
import type { CombatResult, CompleteBattle } from "@/libs/combat/types";

const makeResult = (didWin: number): CombatResult =>
  ({ didWin, outcome: didWin > 0 ? "Won" : "Lost" }) as unknown as CombatResult;

const makeBattle = (
  usersState: ReturnType<typeof makeBattleUser>[],
): CompleteBattle =>
  ({
    battleType: "COMBAT",
    usersState,
    usersEffects: [],
  }) as unknown as CompleteBattle;

describe("buildCombatTrackerTasks — creatures_hunted (#3)", () => {
  it("emits +1 per defeated non-self, non-summon opponent on a win", () => {
    const me = makeBattleUser("attacker");
    const foeA = makeBattleUser("foe-a", { curHealth: 0 });
    const foeB = makeBattleUser("foe-b", { curHealth: 0 });

    const tasks = buildCombatTrackerTasks(makeBattle([me, foeA, foeB]), me, makeResult(1));

    expect(tasks.filter((t) => t.task === "creatures_hunted")).toEqual([
      { task: "creatures_hunted", increment: 1 },
      { task: "creatures_hunted", increment: 1 },
    ]);
  });

  it("excludes fled opponents; counts defeated ones that already left the battle", () => {
    const me = makeBattleUser("attacker");
    // Fled with full health: the win must not credit an opponent that escaped.
    const fledFoe = makeBattleUser("foe-fled", { fledBattle: true });
    // Killed earlier in the battle: their own calcBattleResult already set
    // leftBattle=true, which must NOT disqualify them from being counted.
    const deadFoe = makeBattleUser("foe-dead", { curHealth: 0, leftBattle: true });

    const hunted = buildCombatTrackerTasks(
      makeBattle([me, fledFoe, deadFoe]),
      me,
      makeResult(1),
    ).filter((t) => t.task === "creatures_hunted");

    expect(hunted).toEqual([{ task: "creatures_hunted", increment: 1 }]);
  });

  it("excludes self and summons, and emits nothing on a loss", () => {
    const me = makeBattleUser("attacker");
    const realFoe = makeBattleUser("foe", { curHealth: 0 });
    const summon = makeBattleUser("summon", { isSummon: true, curHealth: 0 });
    const battle = makeBattle([me, realFoe, summon]);

    expect(
      buildCombatTrackerTasks(battle, me, makeResult(1)).filter(
        (t) => t.task === "creatures_hunted",
      ),
    ).toHaveLength(1);
    expect(
      buildCombatTrackerTasks(battle, me, makeResult(0)).filter(
        (t) => t.task === "creatures_hunted",
      ),
    ).toHaveLength(0);
  });

  it("excludes same-side allies — only opposing-direction users count", () => {
    // me is direction "left" (attacker id); opponent is direction "right" (non-attacker id);
    // ally is explicitly set to "left" (same side as me).
    const me = makeBattleUser("attacker");
    const opponent = makeBattleUser("foe", { curHealth: 0 });
    const ally = makeBattleUser("ally", { direction: "left", curHealth: 0 });
    const battle = makeBattle([me, opponent, ally]);

    const hunted = buildCombatTrackerTasks(battle, me, makeResult(1)).filter(
      (t) => t.task === "creatures_hunted",
    );
    // Only the opposing-side opponent counts; the same-side ally must be excluded.
    expect(hunted).toHaveLength(1);
    expect(hunted).toEqual([{ task: "creatures_hunted", increment: 1 }]);
  });
});

describe("buildCombatTrackerTasks — use_specific item/jutsu (#11/#12)", () => {
  it("emits one tick per distinct used jutsu and item id, regardless of outcome", () => {
    const me = makeBattleUser("attacker", {
      usedActions: [
        { id: "jutsu-1", type: "jutsu" },
        { id: "jutsu-1", type: "jutsu" },
        { id: "jutsu-2", type: "jutsu" },
        { id: "item-1", type: "item" },
        { id: "basic-1", type: "basic" },
      ],
    });
    const battle = makeBattle([me, makeBattleUser("foe")]);

    const tasks = buildCombatTrackerTasks(battle, me, makeResult(0)); // lost: any outcome

    expect(tasks.filter((t) => t.task === "use_specific_jutsu_combat")).toEqual([
      { task: "use_specific_jutsu_combat", increment: 1, contentId: "jutsu-1" },
      { task: "use_specific_jutsu_combat", increment: 1, contentId: "jutsu-2" },
    ]);
    expect(tasks.filter((t) => t.task === "use_specific_item_combat")).toEqual([
      { task: "use_specific_item_combat", increment: 1, contentId: "item-1" },
    ]);
  });
});

describe("buildCombatTrackerTasks — tag_usage_win (#9)", () => {
  it("emits one tick per distinct applied tag, win only", () => {
    const me = makeBattleUser("attacker", { usedTagTypes: ["stun", "stun", "poison"] });
    const battle = makeBattle([me, makeBattleUser("foe")]);

    expect(buildCombatTrackerTasks(battle, me, makeResult(1)).filter(
      (t) => t.task === "tag_usage_win",
    )).toEqual([
      { task: "tag_usage_win", increment: 1, contentId: "stun" },
      { task: "tag_usage_win", increment: 1, contentId: "poison" },
    ]);

    expect(buildCombatTrackerTasks(battle, me, makeResult(0)).filter(
      (t) => t.task === "tag_usage_win",
    )).toHaveLength(0);
  });
});

describe("buildCombatTrackerTasks — damage_dealt (#13)", () => {
  it("emits the accumulated damage on any outcome and skips a zero emit", () => {
    const me = makeBattleUser("attacker", { damageDealt: 1500 });
    expect(
      buildCombatTrackerTasks(makeBattle([me, makeBattleUser("foe")]), me, makeResult(0)),
    ).toContainEqual({ task: "damage_dealt", increment: 1500 });

    const zero = makeBattleUser("attacker", { damageDealt: 0 });
    expect(
      buildCombatTrackerTasks(makeBattle([zero]), zero, makeResult(1)).filter(
        (t) => t.task === "damage_dealt",
      ),
    ).toHaveLength(0);
  });
});
