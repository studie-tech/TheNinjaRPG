import { describe, expect, it } from "vitest";
import { getPublicQuestUser } from "@/libs/quest";
import type { UserWithRelations } from "@/routers/profile";

const makeUser = (sector = 1, role = "USER") =>
  ({
    role,
    sector,
    questData: [{ id: "q", goals: [{ id: "o", sector: 8, longitude: 4, latitude: 5 }] }],
    userQuests: [{ questId: "q", quest: { id: "q", content: { objectives: [{
      id: "o", task: "move_to_location", hideLocation: true,
      sector: 2, longitude: 0, latitude: 0, sectorType: "random", sectorList: ["2", "8"],
      locationType: "random",
    }] } } }],
  }) as unknown as NonNullable<UserWithRelations>;

const objective = (user: NonNullable<UserWithRelations>) => user.userQuests[0]!.quest.content.objectives[0]!;

describe("hidden quest response locations", () => {
  it("masks both client channels without modifying canonical trackers or quest definitions", () => {
    const user = makeUser();
    const original = structuredClone(user);
    const response = getPublicQuestUser(user);
    expect(objective(response)).toMatchObject({ sector: 1337, longitude: 1337, latitude: 1337, sectorList: ["1337"] });
    expect(response.questData![0]!.goals[0]).not.toHaveProperty("sector");
    expect(response.questData![0]!.goals[0]).not.toHaveProperty("longitude");
    expect(response.questData![0]!.goals[0]).not.toHaveProperty("latitude");
    expect(user).toEqual(original);
  });

  it("reveals the existing rolled location after arriving, without rerolling or using authored defaults", () => {
    const user = makeUser();
    getPublicQuestUser(user);
    user.sector = 8;
    expect(objective(getPublicQuestUser(user))).toMatchObject({ sector: 8, longitude: 4, latitude: 5 });
    expect(user.questData![0]!.goals[0]).toMatchObject({ sector: 8, longitude: 4, latitude: 5 });
  });

  it("remasks a target on departure without destroying it for a later return", () => {
    const user = makeUser(8);
    expect(objective(getPublicQuestUser(user))).toMatchObject({ sector: 8 });
    user.sector = 1;
    expect(objective(getPublicQuestUser(user))).toMatchObject({ sector: 1337 });
    user.sector = 8;
    expect(objective(getPublicQuestUser(user))).toMatchObject({ sector: 8, longitude: 4, latitude: 5 });
  });

  it("returns real coordinates if staff unhides the quest after a masked read", () => {
    const user = makeUser();
    getPublicQuestUser(user);
    const target = objective(user);
    if ("hideLocation" in target) target.hideLocation = false;
    expect(objective(getPublicQuestUser(user))).toMatchObject({ sector: 8, longitude: 4, latitude: 5 });
  });

  it("preserves staff visibility", () => {
    expect(objective(getPublicQuestUser(makeUser(1, "CONTENT")))).toMatchObject({ sector: 8, longitude: 4, latitude: 5 });
  });
});
