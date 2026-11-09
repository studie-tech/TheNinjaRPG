import { beforeEach, expect, it, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import { quest, userData } from "@/drizzle/schema";
import * as socials from "@/libs/socials";
import { questsRouter } from "@/server/api/routers/quests";
import { SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuests, insertUsers } from "../../../setup/factories";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("concurrent war mission authoring", () => {
  beforeEach(async () => {
    await resetTables(quest, userData);
    await insertUsers([{ userId: "editor", username: "war-editor", role: "OWNER" }]);
  });
  for (const task of ["espionage", "sabotage"] as const) {
    it(`saves authored ${task} parameters without unused quest scenes`, async () => {
      const db = await getTestDatabase();
      await insertQuests([
        {
          id: task,
          name: "War mission",
          questType: "war",
          hidden: false,
          content: {
            objectives: [
              SimpleObjective.parse({
                id: "work",
                task,
                durationSeconds: 30,
                value: 10,
              }),
            ],
            reward: ObjectiveReward.parse({}),
            sceneBackground: "",
            sceneCharacters: [],
          },
        },
      ]);
      const entry = await db.query.quest.findFirst({ where: eq(quest.id, task) });
      if (!entry) throw new Error("Missing war mission");
      const caller = callerForDatabase(questsRouter, "editor", db);
      const discord = spyOn(socials, "callDiscordContent").mockResolvedValue(undefined);
      try {
        const content = {
          ...entry.content,
          objectives: [
            SimpleObjective.parse({ id: "work", task, durationSeconds: 60, value: 20 }),
          ],
        };
        expect(
          (await caller.update({ id: task, data: { ...entry, content } })).success,
        ).toBe(true);
        expect(
          (await db.query.quest.findFirst({ where: eq(quest.id, task) }))?.content
            .objectives[0],
        ).toMatchObject({ task, durationSeconds: 60, value: 20 });
        const result = await caller.update({
          id: task,
          data: {
            ...entry,
            content: {
              ...content,
              objectives: [
                SimpleObjective.parse({ id: "legacy", task: "pvp_kills", value: 10 }),
              ],
            },
          },
        });
        expect(result.success).toBe(false);
        expect(result.message).toContain("sceneCharacters");
      } finally {
        discord.mockRestore();
      }
    });
  }
});
