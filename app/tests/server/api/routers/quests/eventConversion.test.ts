import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { quest, questHistory, userData } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import * as socials from "@/libs/socials";
import { questsRouter } from "@/server/api/routers/quests";
import { QuestValidator, SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuests, insertUsers } from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("converting a quest into an event", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    vi.spyOn(socials, "callDiscordContent").mockResolvedValue(undefined);
    await resetTables(questHistory, quest, userData);
    await insertUsers([
      { userId: "editor", username: "Editor", role: "OWNER", rank: "JONIN" },
      { userId: "player", username: "Player", rank: "STUDENT", updatedAt: new Date() },
    ]);
    await insertQuests([
      {
        id: "convert",
        questType: "mission",
        questRank: "D",
        hidden: false,
        maxAttempts: 1,
        maxCompletes: 1,
        content: {
          objectives: [
            SimpleObjective.parse({ id: "train", task: "stats_trained", value: 10 }),
          ],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: ["character"],
        },
      },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  const save = async (client: Awaited<ReturnType<typeof getTestDatabase>>) => {
    const db = await getTestDatabase();
    const authored = (await db.query.quest.findFirst({
      where: eq(quest.id, "convert"),
    }))!;
    return callerForDatabase(questsRouter, "editor", client).update({
      id: "convert",
      data: QuestValidator.parse({ ...authored, questType: "event" }),
    });
  };

  it("assigns the event to active players once the edit is saved", async () => {
    const db = await getTestDatabase();
    expect(await save(db)).toMatchObject({ success: true });
    const history = await db.query.questHistory.findMany({
      where: eq(questHistory.questId, "convert"),
    });
    expect(history.map((row) => row.userId)).toEqual(["player"]);
  });

  it("assigns nobody when a concurrent edit wins the save", async () => {
    const db = await getTestDatabase();
    const concurrent = beforeStatements(db, quest, [
      () =>
        db
          .update(quest)
          .set({ updatedAt: new Date(Date.now() + 60_000) })
          .where(eq(quest.id, "convert")),
    ]);
    expect(await save(concurrent)).toMatchObject({
      success: false,
      message: "Quest changed while saving. Refresh and try again.",
    });
    const [history, stored] = await Promise.all([
      db.query.questHistory.findMany({ where: eq(questHistory.questId, "convert") }),
      db.query.quest.findFirst({ where: eq(quest.id, "convert") }),
    ]);
    expect(history).toEqual([]);
    expect(stored?.questType).toBe("mission");
  });
});
