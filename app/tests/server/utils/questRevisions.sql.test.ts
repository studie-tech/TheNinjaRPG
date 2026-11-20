/** Pin revision-keyed quest reads: identical to joined definitions, cached, live raid state. */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { and, asc, eq, getTableColumns, sql } from "drizzle-orm";
import { quest, questHistory, userData } from "@/drizzle/schema";
import { questRevisionRelation } from "@/queries/questRevisions";
import {
  fetchQuestDiscoveryCandidates,
  fetchQuestDiscoverySummaryCandidates,
} from "@/queries/quests";
import { listQuestHistoryForGetSectorData } from "@/queries/travel";
import { fetchProfileUser } from "@/server/utils/profileDefinitions";
import { withQuestDefinitions } from "@/server/utils/questRevisions";
import { insertQuestHistory, insertQuests, insertUsers } from "../../setup/factories";
import { aroundStatements } from "../../setup/statements";
import {
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../setup/testDatabase";

const USER_ID = "revision-reader";
const ctx = { userId: USER_ID };
const discovery = { questTypes: ["event" as const, "raid" as const] };

describeWithDatabase("revision-keyed quest reads", () => {
  afterEach(() => resetTables(userData, quest, questHistory));
  beforeEach(async () => {
    await resetTables(userData, quest, questHistory);
    await insertUsers([{ userId: USER_ID, username: USER_ID, level: 20 }]);
    await insertQuests([
      {
        id: "event",
        questType: "event",
        name: "Event quest",
        description: "A long event",
        content: { rewardMode: "choose" },
      },
      {
        id: "raid",
        questType: "raid",
        name: "Raid quest",
        raidBossMaxHealth: 1000,
        raidBossCurrentHealth: 1000,
      },
    ]);
    await insertQuestHistory([
      { userId: USER_ID, questId: "event", questType: "event", previousAttempts: 2 },
      { userId: USER_ID, questId: "raid", questType: "raid" },
    ]);
  });

  it("resolves open attempts to the joined definitions, then without reading Quest content", async () => {
    const db = await getTestDatabase();
    const joined = await listQuestHistoryForGetSectorData(db, ctx, true);
    const read = () =>
      recordQueries(async () =>
        withQuestDefinitions(
          db,
          await listQuestHistoryForGetSectorData(db, ctx, questRevisionRelation),
        ),
      );
    const cold = await read();
    expect(cold.result).toEqual(joined);
    expect(cold.statements).toHaveLength(2);
    expect(cold.statements[0]).toContain("SHA2(JSON_ARRAY(");

    const warm = await read();
    expect(warm.result).toEqual(joined);
    expect(warm.statements).toHaveLength(1);
  });

  it("shares warmed definitions across profile, discovery and sector reads", async () => {
    const db = await getTestDatabase();
    const profile = await fetchProfileUser(db, USER_ID);
    const profileEvent = profile!.userQuests.find(
      (entry) => entry.questId === "event",
    )!;
    profileEvent.quest.name = "Private profile rewrite";

    const discoveryRead = await recordQueries(() =>
      fetchQuestDiscoveryCandidates(db, USER_ID, discovery),
    );
    expect(discoveryRead.statements).toHaveLength(1);
    expect(discoveryRead.result).toEqual(await joinedDiscovery());

    const sectorRead = await recordQueries(async () =>
      withQuestDefinitions(
        db,
        await listQuestHistoryForGetSectorData(db, ctx, questRevisionRelation),
      ),
    );
    expect(sectorRead.statements).toHaveLength(1);
    expect(sectorRead.result).toEqual(
      await listQuestHistoryForGetSectorData(db, ctx, true),
    );
  });

  it("reads raid state live and any content write's new revision", async () => {
    const db = await getTestDatabase();
    await fetchQuestDiscoveryCandidates(db, USER_ID, discovery);
    await db
      .update(quest)
      .set({ raidBossCurrentHealth: 250 })
      .where(eq(quest.id, "raid"));
    // Migrations and console fixes rewrite content without moving `updatedAt`.
    await db.execute(
      sql`UPDATE \`Quest\` SET \`name\` = 'Edited event' WHERE \`id\` = 'event'`,
    );
    const { result, statements } = await recordQueries(() =>
      fetchQuestDiscoveryCandidates(db, USER_ID, discovery),
    );
    expect(result).toEqual(await joinedDiscovery());
    expect(result.map((entry) => [entry.name, entry.raidBossCurrentHealth])).toEqual([
      ["Edited event", null],
      ["Raid quest", 250],
    ]);
    // Only the edited quest is read again; raid state alone keeps its revision.
    expect(statements).toHaveLength(2);
    expect(statements[1]).toContain("in ('event')");
  });

  it("repeats the joined read when a definition changes after its revision was read", async () => {
    const db = await getTestDatabase();
    let questReads = 0;
    const client = aroundStatements(
      db,
      quest,
      async (read) => {
        // The definition read follows the revision read; edit the quest in between.
        if (++questReads === 2)
          await db.update(quest).set({ name: "Raced" }).where(eq(quest.id, "event"));
        return read();
      },
      { operations: ["select"] },
    );
    const { result, statements } = await recordQueries(() =>
      fetchQuestDiscoveryCandidates(client, USER_ID, discovery),
    );
    // Revisions, the edit, the definitions that no longer match, and the joined read.
    expect(statements).toHaveLength(4);
    expect(statements[3]).not.toContain("SHA2(JSON_ARRAY(");
    expect(result).toEqual(await joinedDiscovery());
    expect(result[0]?.name).toBe("Raced");
  });

  it("hands every read its own copy", async () => {
    const db = await getTestDatabase();
    const [first] = await fetchQuestDiscoveryCandidates(db, USER_ID, discovery);
    if (first) first.content.objectives.push({} as never);
    const [second] = await fetchQuestDiscoveryCandidates(db, USER_ID, discovery);
    expect(second?.content.objectives).toEqual([]);
  });

  it("projects dashboard summaries as the SQL projection does", async () => {
    const db = await getTestDatabase();
    const expected: unknown[] = await db
      .select({
        id: quest.id,
        name: quest.name,
        content:
          sql`JSON_OBJECT('reward', JSON_EXTRACT(${quest.content}, '$.reward'), 'rewardMode', JSON_EXTRACT(${quest.content}, '$.rewardMode'))`.mapWith(
            (value: string) => quest.content.mapFromDriverValue(value),
          ),
        previousAttempts: questHistory.previousAttempts,
      })
      .from(quest)
      .leftJoin(questHistory, eq(questHistory.questId, quest.id))
      .orderBy(asc(quest.name));
    for (const pass of ["cold", "warm"]) {
      const { result, statements } = await recordQueries(() =>
        fetchQuestDiscoverySummaryCandidates(db, USER_ID, discovery),
      );
      const projected: unknown[] = result.map(
        ({ id, name, content, previousAttempts }) => ({
          id,
          name,
          content,
          previousAttempts,
        }),
      );
      expect(projected).toEqual(expected);
      expect(statements).toHaveLength(pass === "cold" ? 2 : 1);
      expect(statements[0]).toContain("SHA2(JSON_ARRAY(");
    }
  });
});

/** The discovery candidates as one joined statement reads them. */
const joinedDiscovery = async () =>
  (await getTestDatabase())
    .select({
      ...getTableColumns(quest),
      previousAttempts: questHistory.previousAttempts,
      previousCompletes: questHistory.previousCompletes,
      completed: questHistory.completed,
      periodCompletes: questHistory.periodCompletes,
      periodStartAt: questHistory.periodStartAt,
    })
    .from(quest)
    .leftJoin(
      questHistory,
      and(eq(quest.id, questHistory.questId), eq(questHistory.userId, USER_ID)),
    )
    .orderBy(asc(quest.name));
