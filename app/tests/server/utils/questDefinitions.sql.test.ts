/** Pin the profile read's quest definitions: revision-keyed, cached, live raid state. */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { quest, questHistory, userData } from "@/drizzle/schema";
import { fetchProfileUser } from "@/server/utils/questDefinitions";
import { insertQuestHistory, insertQuests, insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../setup/testDatabase";

const USER_ID = "definition-reader";
const REVISION = new Date("2026-11-01T00:00:00.000Z");

describeWithDatabase("profile quest definitions", () => {
  // The open raid would otherwise appear in later suites' profile reads.
  afterEach(() => resetTables(userData, quest, questHistory));
  beforeEach(async () => {
    await resetTables(userData, quest, questHistory);
    await insertUsers([{ userId: USER_ID, username: USER_ID, level: 20 }]);
    await insertQuests([
      {
        id: "story",
        questType: "story",
        name: "Story quest",
        description: "A long story",
        updatedAt: REVISION,
      },
      {
        id: "raid",
        questType: "raid",
        name: "Raid quest",
        raidBossMaxHealth: 1000,
        raidBossCurrentHealth: 1000,
        updatedAt: REVISION,
      },
    ]);
    await insertQuestHistory([
      { userId: USER_ID, questId: "story", questType: "story" },
      { userId: USER_ID, questId: "raid", questType: "raid" },
    ]);
  });

  it("matches the joined definitions, then serves them without reading Quest rows", async () => {
    const db = await getTestDatabase();
    const cold = await recordQueries(() => fetchProfileUser(db, USER_ID));
    const joined = await db.query.questHistory.findMany({
      where: eq(questHistory.userId, USER_ID),
      with: { quest: true },
    });
    const byQuest = (entries: { questId: string; quest: unknown }[] = []) =>
      Object.fromEntries(entries.map((entry) => [entry.questId, entry.quest]));
    expect(byQuest(cold.result?.userQuests)).toEqual(byQuest(joined));
    // The profile statement carries raid state and a content hash; one statement reads
    // the definitions.
    expect(cold.statements).toHaveLength(2);
    expect(cold.statements[0]).toContain(
      "(select json_array(`id`, `raidBossCurrentHealth`, `raidStartedAt`, `raidEndsAt`, `raidCaptureDeadline`, `raidGracePeriodEnd`, SHA2(JSON_ARRAY(",
    );
    expect(cold.statements[1]).toMatch(/from `Quest` where `Quest`.`id` in/i);

    const warm = await recordQueries(() => fetchProfileUser(db, USER_ID));
    expect(warm.statements).toHaveLength(1);
    expect(byQuest(warm.result?.userQuests)).toEqual(byQuest(joined));
  });

  it("reads raid state live and any content write's new revision", async () => {
    const db = await getTestDatabase();
    await fetchProfileUser(db, USER_ID);
    await db
      .update(quest)
      .set({ raidBossCurrentHealth: 250 })
      .where(eq(quest.id, "raid"));
    // Migrations and console fixes rewrite content without moving `updatedAt`.
    await db.execute(
      sql`UPDATE \`Quest\` SET \`name\` = 'Edited story' WHERE \`id\` = 'story'`,
    );

    const { result, statements } = await recordQueries(() =>
      fetchProfileUser(db, USER_ID),
    );
    const quests = Object.fromEntries(
      (result?.userQuests ?? []).map((entry) => [entry.questId, entry.quest]),
    );
    expect(quests.raid).toMatchObject({
      name: "Raid quest",
      raidBossCurrentHealth: 250,
    });
    expect(quests.story).toMatchObject({ name: "Edited story", updatedAt: REVISION });
    // Only the edited quest is read again; raid state alone keeps its revision.
    expect(statements).toHaveLength(2);
    expect(statements[1]).toContain("in ('story')");
  });

  it("hands every read its own copy and leaves deleted quests without a definition", async () => {
    const db = await getTestDatabase();
    const first = await fetchProfileUser(db, USER_ID);
    const story = first?.userQuests.find((entry) => entry.questId === "story");
    if (story?.quest) story.quest.name = "Rewritten for one player";
    await db.delete(quest).where(eq(quest.id, "raid"));

    const second = await fetchProfileUser(db, USER_ID);
    const quests = Object.fromEntries(
      (second?.userQuests ?? []).map((entry) => [entry.questId, entry.quest]),
    );
    expect(quests.story?.name).toBe("Story quest");
    expect(quests.raid).toBeNull();
  });
});
