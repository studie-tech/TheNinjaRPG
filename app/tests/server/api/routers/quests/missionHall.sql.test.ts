import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { quest, questHistory, userData } from "@/drizzle/schema";
import { isAvailableUserQuests } from "@/libs/quest/availability";
import {
  fetchQuestAvailabilityCandidates,
  fetchQuestDiscoveryCandidates,
} from "@/queries/quests";
import { questsRouter } from "@/server/api/routers/quests";
import type { QuestContentType } from "@/validators/objectives";
import { insertQuests, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("mission hall availability projection", () => {
  beforeEach(async () => resetTables(questHistory, quest, userData));

  it("decides availability like full rows without returning objective content", async () => {
    await insertUsers([{ userId: "hall", rank: "JONIN", level: 50, sector: 0 }]);
    const client = await getTestDatabase();
    const user = await client.query.userData.findFirst({
      where: eq(userData.userId, "hall"),
    });
    if (!user) throw new Error("Missing mission hall user");
    const objectives = (...entries: Record<string, unknown>[]) =>
      ({
        objectives: entries.map((entry, i) => ({
          id: `objective-${i}`,
          task: "dialog",
          description: "A long briefing that the mission hall never shows",
          ...entry,
        })),
      }) as Partial<QuestContentType>;
    await insertQuests([
      {
        id: "plain",
        name: "plain",
        questType: "mission",
        questRank: "D",
        content: objectives({}),
      },
      {
        id: "espionage",
        name: "espionage",
        questType: "mission",
        questRank: "D",
        content: objectives({}, { task: "espionage" }),
      },
      {
        id: "sabotage",
        name: "sabotage",
        questType: "mission",
        questRank: "D",
        content: objectives({ task: "sabotage" }),
      },
      {
        id: "elite",
        name: "elite",
        questType: "mission",
        questRank: "D",
        content: objectives({ reward_rank: "ELITE JONIN" }),
      },
      {
        id: "elite-choice",
        name: "elite-choice",
        questType: "mission",
        questRank: "D",
        content: objectives({
          reward_packages: [{ rewards: { reward_rank: "ELITE JONIN" } }],
        }),
      },
    ]);
    const options = { questTypes: ["mission" as const], level: 50 };
    const [full, projected] = await Promise.all([
      fetchQuestDiscoveryCandidates(client, user.userId, options),
      fetchQuestAvailabilityCandidates(client, user.userId, options),
    ]);
    const availability = (rows: Parameters<typeof isAvailableUserQuests>[0][]) =>
      rows.map((row) =>
        isAvailableUserQuests(row, { ...user, completedQuests: [] }, true),
      );
    expect(availability(projected)).toEqual(availability(full));
    expect(
      projected.filter((_, i) => availability(projected)[i]?.check).map((q) => q.id),
    ).toEqual(["plain"]);
    expect(projected.map((row) => row.content.objectives)).toEqual([
      [{ reward_rank: "ELITE JONIN" }],
      [{ reward_rank: "ELITE JONIN" }],
      [{ task: "espionage" }],
      [],
      [{ task: "espionage" }],
    ]);

    const hall = await (await callerFor(questsRouter, user.userId)).missionHall({
      villageId: user.villageId ?? "",
      level: 50,
    });
    expect(hall.map((row) => row.id)).toEqual(["plain"]);
    expect(JSON.stringify(hall)).not.toContain("briefing");
  });
});
