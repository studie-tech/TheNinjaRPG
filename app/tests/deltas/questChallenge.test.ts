import { describe, expect, it } from "bun:test";
import { getQuestChallengeUserUpdate } from "@/deltas/questChallenge";
import { QuestTracker } from "@/validators/objectives";

describe("quest challenge delta", () => {
  it("patches the quest trackers once the objective is done", () => {
    const questData = [
      QuestTracker.parse({
        id: "q1",
        goals: [{ id: "g1", done: true }],
      }),
    ];
    const update = getQuestChallengeUserUpdate({
      questData,
      sector: 1,
      role: "USER",
      playsAsPlayer: true,
      userQuests: [],
    });
    expect(update).toEqual({ userDelta: {}, userPatch: { questData } });
    expect(update.userPatch?.questData).not.toBe(questData);
    // A following objective that started a battle travels with the same patch.
    const withBattle = getQuestChallengeUserUpdate(
      { questData, sector: 1, role: "USER", playsAsPlayer: true, userQuests: [] },
      { userDelta: {}, userPatch: { status: "BATTLE", battleId: "battle-1" } },
    );
    expect(withBattle.userPatch).toEqual({
      status: "BATTLE",
      battleId: "battle-1",
      questData,
    });
  });

  it("confirms an unchanged profile when the objective is not done", () => {
    expect(getQuestChallengeUserUpdate(undefined)).toEqual({ userDelta: {} });
  });
});
