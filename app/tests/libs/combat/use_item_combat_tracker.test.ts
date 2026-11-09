import { describe, expect, it } from "bun:test";
import {
  buildCombatTrackerTasks,
  hydrateUserForQuests,
} from "@/libs/combat/settlement";
import type { CombatResult, CompleteBattle } from "@/libs/combat/types";
import { getNewTrackers } from "@/libs/quest";
import { makeBattleUser, makeCompleteBattle } from "../../setup/combat";
import { trackerQuest as makeQuest } from "../../setup/quest";

// Exercise combat task construction, quest hydration and objective credit together.
const makeResult = (didWin: number): CombatResult =>
  ({
    didWin,
    outcome: didWin > 0 ? "Won" : "Lost",
    notifications: [],
  }) as unknown as CombatResult;

const runUpdateUserSeam = (
  battle: CompleteBattle,
  user: ReturnType<typeof makeBattleUser>,
  didWin: number,
) => {
  const tasks = buildCombatTrackerTasks(battle, user, makeResult(didWin));
  const hydratedUser = hydrateUserForQuests(battle, user);
  return getNewTrackers(hydratedUser, tasks, {
    inWarTornSector: false,
    isWarParticipant: false,
  });
};

const battleWith = (
  me: ReturnType<typeof makeBattleUser>,
  foe: ReturnType<typeof makeBattleUser>,
  quest: ReturnType<typeof makeQuest>,
): CompleteBattle =>
  makeCompleteBattle({
    round: 3,
    usersState: [me, foe],
    extraState: {
      userQuests: {
        [me.controllerId]: [{ id: "uq-q", questId: quest.id, completed: 0, quest }],
      },
      completedQuests: { [me.controllerId]: [] },
      questData: { [me.controllerId]: [] },
    } as unknown as CompleteBattle["extraState"],
  });

describe("use_specific_item_combat — updateUser seam", () => {
  const useItemObjective = {
    id: "o",
    task: "use_specific_item_combat" as const,
    value: 1,
    useItemIds: ["item-1"],
    description: "",
    successDescription: "",
  };

  it("advances and completes the objective when a listed item was used", () => {
    const quest = makeQuest("q", [useItemObjective]);
    const me = makeBattleUser("attacker", {
      usedActions: [{ id: "item-1", type: "item" }],
    });
    const result = runUpdateUserSeam(
      battleWith(me, makeBattleUser("foe"), quest),
      me,
      1,
    );
    const goal = result.trackers
      .find((t) => t.id === "q")
      ?.goals.find((g) => g.id === "o");
    expect(goal?.value).toBe(1);
    expect(goal?.done).toBe(true);
  });

  it("credits on a loss too (usage, not win, is the trigger)", () => {
    const quest = makeQuest("q", [useItemObjective]);
    const me = makeBattleUser("attacker", {
      usedActions: [{ id: "item-1", type: "item" }],
    });
    const result = runUpdateUserSeam(
      battleWith(me, makeBattleUser("foe"), quest),
      me,
      0,
    );
    const goal = result.trackers
      .find((t) => t.id === "q")
      ?.goals.find((g) => g.id === "o");
    expect(goal?.value).toBe(1);
  });

  it("does not credit an item that is not in the objective's id-list", () => {
    const quest = makeQuest("q", [useItemObjective]);
    const me = makeBattleUser("attacker", {
      usedActions: [{ id: "other-item", type: "item" }],
    });
    const result = runUpdateUserSeam(
      battleWith(me, makeBattleUser("foe"), quest),
      me,
      1,
    );
    const goal = result.trackers
      .find((t) => t.id === "q")
      ?.goals.find((g) => g.id === "o");
    expect(goal?.value).toBe(0);
  });
});
