import { describe, expect, it } from "bun:test";
import { getNewTrackers, getUserQuests } from "@/libs/quest";
import { isAvailableUserQuests } from "@/libs/quest/availability";
import { trackerGoal, trackerQuest, trackerUser } from "../../setup/quest";

const objective = (id: string, value = 5) => ({
  id,
  task: "pvp_kills" as const,
  description: "",
  successDescription: "",
  value,
});

const tower = (questType: "battlepyramid" | "mission" = "battlepyramid") => ({
  ...trackerQuest("tower", [objective("floor")], questType),
  requiredLevel: 30,
  maxLevel: 50,
  retryDelay: "none" as const,
});

/** A player at `level` with the given history row for the tower. */
const climber = (
  level: number,
  quest: ReturnType<typeof tower>,
  attempt: { endAt: Date | null; completed: number },
  questData: unknown[] = [],
) => {
  const user = trackerUser([quest as never], questData);
  user.level = level;
  user.userQuests = user.userQuests.map((entry) => ({ ...entry, ...attempt }));
  return user;
};

/** Availability of a quest definition merged with the fields of its history row. */
const available = (quest: object, user: ReturnType<typeof trackerUser>) =>
  isAvailableUserQuests(
    quest as Parameters<typeof isAvailableUserQuests>[0],
    user as unknown as Parameters<typeof isAvailableUserQuests>[1],
  );

const open = { endAt: null, completed: 0 };
const savedFloor = { id: "tower", goals: [{ id: "floor", done: false, value: 3 }] };

describe("Battle Pyramid level cap", () => {
  it("gates entering a tower above its cap", () => {
    const user = climber(54, tower(), open);
    const { check, message } = available(tower(), user);
    expect(check).toBe(false);
    expect(message).toContain("Quest is only available up to level 50");
  });

  it("gates a new attempt once the previous one has closed", () => {
    const quest = tower();
    const user = climber(54, quest, open);
    for (const attempt of [
      { endAt: new Date(), completed: 0 },
      { endAt: new Date(), completed: 1 },
    ]) {
      expect(available({ ...quest, ...attempt }, user).check).toBe(false);
    }
  });

  it("keeps a run playable after the player out-levels the tower", () => {
    const quest = tower();
    const user = climber(54, quest, open, [savedFloor]);
    expect(available({ ...quest, ...open }, user).check).toBe(true);
    expect(getUserQuests(user).map((entry) => entry.id)).toEqual(["tower"]);
  });

  it("keeps the checkpoint of an out-levelled run", () => {
    const quest = tower();
    const result = getNewTrackers(climber(54, quest, open, [savedFloor]), [
      { task: "pvp_kills", increment: 1 },
    ]);
    expect(trackerGoal(result, "tower", "floor")?.value).toBe(4);
  });

  it("rebuilds an out-levelled run that has no saved tracker", () => {
    const result = getNewTrackers(climber(54, tower(), open), [{ task: "any" }]);
    expect(trackerGoal(result, "tower", "floor")?.value).toBe(0);
  });

  it("still applies the minimum level to an open run", () => {
    const quest = tower();
    const user = climber(29, quest, open);
    const { check, message } = available({ ...quest, ...open }, user);
    expect(check).toBe(false);
    expect(message).toBe("Quest requires level 30\n");
  });

  it("leaves the cap on other quest types", () => {
    const quest = tower("mission");
    const user = climber(54, quest, open);
    expect(available({ ...quest, ...open }, user).check).toBe(false);
  });
});
