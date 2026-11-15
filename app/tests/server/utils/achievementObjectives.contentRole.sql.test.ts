import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { quest, questHistory, userData } from "@/drizzle/schema";
import { userQuestHistoryRelation } from "@/server/utils/achievementObjectives";
import { insertQuestHistory, insertQuests, insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

/** The quest IDs of the open history a profile read loads for the player. */
const loadedQuests = async () =>
  (
    await (
      await getTestDatabase()
    ).query.userData.findFirst({
      where: eq(userData.userId, "staff"),
      with: { userQuests: userQuestHistoryRelation },
    })
  )?.userQuests
    .map((entry) => entry.questId)
    .sort();

describeWithDatabase("open quest history of staff playing as a regular player", () => {
  beforeEach(async () => {
    await resetTables(questHistory, quest, userData);
    await insertUsers([{ userId: "staff", username: "staff", role: "CONTENT" }]);
    await insertQuests([
      { id: "released", hidden: false },
      { id: "unreleased", hidden: true },
    ]);
    await insertQuestHistory([
      { userId: "staff", questId: "released" },
      { userId: "staff", questId: "unreleased" },
    ]);
  });

  it("loads unreleased quests for staff only while they play as staff", async () => {
    expect(await loadedQuests()).toEqual(["released", "unreleased"]);
    await (await getTestDatabase())
      .update(userData)
      .set({ playsAsPlayer: true })
      .where(eq(userData.userId, "staff"));
    expect(await loadedQuests()).toEqual(["released"]);
  });
});
