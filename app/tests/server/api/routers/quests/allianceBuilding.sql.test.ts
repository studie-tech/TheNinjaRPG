import { beforeEach, expect, it } from "bun:test";
import { item, quest, questHistory, userData, userItem } from "@/drizzle/schema";
import { questsRouter } from "@/server/api/routers/quests";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertItems,
  insertQuests,
  insertUserItems,
  insertUsers,
} from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("allianceBuilding entry stock", () => {
  beforeEach(async () => {
    await resetTables(questHistory, quest, userItem, item, userData);
    await insertUsers([{ userId: "hero", status: "AWAKE", rank: "CHUNIN", level: 50 }]);
    await insertItems([{ id: "ticket", name: "Event Ticket" }]);
    await insertQuests([
      {
        id: "paid",
        name: "Paid Event",
        questType: "event",
        questRank: "D",
        hidden: false,
        maxAttempts: 10,
        maxCompletes: 10,
        content: {
          objectives: [],
          reward: ObjectiveReward.parse({}),
          entryItems: [{ ids: ["ticket"], number: 2 }],
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
  });

  it("counts only carried stacks, as the entry charge does", async () => {
    await insertUserItems([
      { id: "pack", userId: "hero", itemId: "ticket", quantity: 1 },
      { id: "pouch", userId: "hero", itemId: "ticket", quantity: 2 },
      { id: "home", userId: "hero", itemId: "ticket", quantity: 9, storedAtHome: true },
      { id: "sold", userId: "hero", itemId: "ticket", quantity: 9, isInAuction: true },
    ]);
    const quests = await callerFor(questsRouter, "hero");
    const hall = await quests.allianceBuilding({ level: 50, rank: ["D"] });
    expect(hall.map((entry) => entry.entryRequirements)).toEqual([
      [{ itemId: "ticket", quantity: 2, name: "Event Ticket", owned: 3 }],
    ]);
  });

  it("reports a missing item as zero owned", async () => {
    const quests = await callerFor(questsRouter, "hero");
    const hall = await quests.allianceBuilding({ level: 50, rank: ["D"] });
    expect(hall[0]?.entryRequirements).toEqual([
      { itemId: "ticket", quantity: 2, name: "ticket", owned: 0 },
    ]);
  });
});
