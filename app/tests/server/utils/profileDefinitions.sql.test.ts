/** Pin the profile read's cached definitions: revision-keyed, cached, live state. */
import { afterEach, beforeEach, expect, it } from "bun:test";
import { getCache } from "@vercel/functions";
import { eq, sql } from "drizzle-orm";
import {
  bloodlineRolls,
  item,
  quest,
  questHistory,
  userData,
  userItem,
  userItemImbuement,
  village,
  villageStructure,
} from "@/drizzle/schema";
import { hasQuestContentChanged } from "@/libs/questRun";
import {
  findProfileUserWithDefinitions,
  selectQuestForFetchQuestBootstrap,
} from "@/queries/profile";
import {
  executeDefinitionWriteForUpdate,
  fetchBloodlineCollectionRolls,
} from "@/queries/quests";
import { fetchUserItems } from "@/server/api/routers/item";
import {
  fetchProfileUser,
  fetchProgressionProfileUser,
} from "@/server/utils/profileDefinitions";
import { QuestTracker, QuestValidator } from "@/validators/objectives";
import {
  insertItems,
  insertQuestHistory,
  insertQuests,
  insertUserItems,
  insertUsers,
} from "../../setup/factories";
import { aroundStatements, beforeStatements } from "../../setup/statements";
import {
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../setup/testDatabase";

const USER_ID = "definition-reader";
const REVISION = new Date("2026-11-01T00:00:00.000Z");

/** The joined read without the opt-in progression columns `fetchProfileUser` omits. */
const joinedProfile = async (userId: string) => {
  const read = await findProfileUserWithDefinitions(await getTestDatabase(), userId);
  if (!read) return undefined;
  const { questBootstrap: _bootstrap, rolledBloodlineIds: _rolled, ...user } = read;
  return user;
};

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

  it("keeps preserved history and checkpoints on the fetched definition revision", async () => {
    const db = await getTestDatabase();
    const checkpoint = QuestTracker.parse({
      id: "story",
      goals: [{ id: "floor", value: 77 }],
    });
    await Promise.all([
      db.update(quest).set({ questType: "battlepyramid" }).where(eq(quest.id, "story")),
      db
        .update(questHistory)
        .set({ questType: "battlepyramid", questVersion: REVISION })
        .where(eq(questHistory.questId, "story")),
      db
        .update(userData)
        .set({ questData: [checkpoint] })
        .where(eq(userData.userId, USER_ID)),
    ]);
    const original = (await db.query.quest.findFirst({
      where: eq(quest.id, "story"),
    }))!;
    const editedAt = new Date(REVISION.getTime() + 1000);
    const client = beforeStatements(
      db,
      quest,
      [
        () =>
          executeDefinitionWriteForUpdate(
            db,
            original,
            {
              data: QuestValidator.parse({ ...original, hidden: true }),
            },
            editedAt,
          ),
      ],
      { operations: ["select"] },
    );

    const user = await fetchProfileUser(client, USER_ID);
    const attempt = user!.userQuests.find((entry) => entry.questId === "story")!;
    expect(attempt.questVersion).toEqual(editedAt);
    expect(attempt.quest.updatedAt).toEqual(editedAt);
    expect(hasQuestContentChanged(attempt)).toBe(false);
    expect(user!.questData).toEqual([checkpoint]);
  });

  it("bounds concurrent edits to one joined retry and keeps raid state consistent", async () => {
    const db = await getTestDatabase();
    let definitionReads = 0;
    const client = aroundStatements(
      db,
      quest,
      async (read) => {
        // Every separate definition read races another edit; a joined retry cannot split it.
        definitionReads++;
        if (definitionReads > 2) throw new Error("Unbounded definition retries");
        const health = 1000 / 2 ** definitionReads;
        await db
          .update(quest)
          .set({ raidBossMaxHealth: health, raidBossCurrentHealth: health })
          .where(eq(quest.id, "raid"));
        return read();
      },
      { operations: ["select"] },
    );
    const { result, statements } = await recordQueries(() =>
      fetchProfileUser(client, USER_ID),
    );
    const raid = result!.userQuests.find((entry) => entry.questId === "raid")!.quest;
    expect(raid).toMatchObject({ raidBossMaxHealth: 500, raidBossCurrentHealth: 500 });
    expect(definitionReads).toBe(1);
    const reads = statements.filter((statement) => /^select /i.test(statement));
    expect(reads).toHaveLength(3);
    expect(reads[0]).toContain("SHA2(JSON_ARRAY(");
    expect(reads[2]).not.toContain("SHA2(JSON_ARRAY(");
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

describeWithDatabase("profile item and village structure definitions", () => {
  const tables = [
    userData,
    item,
    userItem,
    userItemImbuement,
    village,
    villageStructure,
  ];
  afterEach(() => resetTables(...tables));
  beforeEach(async () => {
    await resetTables(...tables);
    const db = await getTestDatabase();
    await insertUsers([
      { userId: USER_ID, username: USER_ID, level: 20, villageId: "leaf" },
    ]);
    await db
      .insert(village)
      .values({ id: "leaf", name: "Leaf", sector: 301, kageId: "leaf-kage" });
    await db.insert(villageStructure).values([
      {
        id: "leaf/hall",
        name: "Town Hall",
        route: "/townhall",
        image: "/hall.png",
        villageId: "leaf",
        curSp: 1000,
        worldArt: {
          route: "/townhall",
          sourceImage: "/hall-source.png",
          filepath: "/hall-atlas.png",
          material: "/hall-material.png",
          surfaces: "/hall-surfaces.png",
          frame: { x: 0, y: 0, width: 256, height: 256 },
          stair: { x: 128, y: 240 },
          shadow: 0.4,
          height: 3,
          courtSlope: 0,
        },
      },
      {
        id: "leaf/bank",
        name: "Bank",
        route: "/bank",
        image: "/bank.png",
        villageId: "leaf",
      },
    ]);
    await insertItems([
      { id: "blade", name: "Blade", itemType: "WEAPON", slot: "HAND" },
      { id: "crystal", name: "Crystal", itemType: "CRYSTAL" },
    ]);
    await insertUserItems([
      { id: "held-blade", userId: USER_ID, itemId: "blade", equipped: "HAND_1" },
    ]);
    await db.insert(userItemImbuement).values({
      id: "imbued",
      userItemId: "held-blade",
      imbuementItemId: "crystal",
      craftingFinishedAt: REVISION,
    });
  });

  it("matches the joined read, then serves definitions without reading their rows", async () => {
    const db = await getTestDatabase();
    const joined = await joinedProfile(USER_ID);
    const cold = await recordQueries(() => fetchProfileUser(db, USER_ID));
    expect(cold.result).toEqual(joined);
    expect(cold.result?.items[0]?.imbuements[0]?.item?.name).toBe("Crystal");
    expect(cold.result?.village?.structures).toHaveLength(2);
    // The snapshot carries each row's id and content hash; one statement per table reads
    // the definitions this instance lacks.
    expect(cold.statements).toHaveLength(3);
    expect(cold.statements[0]).not.toContain("`worldArt`, `longitude`");
    expect(cold.statements[0]).not.toContain("`effects`, `itemType`");
    const reads = cold.statements.slice(1).join("\n");
    expect(reads).toMatch(/from `Item` where `Item`.`id` in/i);
    expect(reads).toMatch(/from `VillageStructure` where `VillageStructure`.`id` in/i);

    const warm = await recordQueries(() => fetchProfileUser(db, USER_ID));
    expect(warm.statements).toHaveLength(1);
    expect(warm.result).toEqual(joined);
  });

  it.each(["profile", "inventory"])(
    "shares local item definitions after a %s read",
    async (firstReader) => {
      const db = await getTestDatabase();
      if (firstReader === "profile") await fetchProfileUser(db, USER_ID);
      else await fetchUserItems(db, USER_ID);
      // Remove shared entries without clearing either reader's local memory. A reader
      // with a separate local cache would have to select Item definitions again.
      await getCache().expireTag("item-definition:entries");

      const { result, statements } = await recordQueries(async () => {
        const profile = await fetchProfileUser(db, USER_ID);
        const inventory = await fetchUserItems(db, USER_ID);
        return { profile, inventory };
      });
      expect(
        statements.filter((statement) =>
          /from `Item` where `Item`.`id` in/i.test(statement),
        ),
      ).toHaveLength(0);
      expect(result.profile?.items[0]?.item?.name).toBe("Blade");
      expect(result.profile?.items[0]?.imbuements[0]?.item?.name).toBe("Crystal");
      expect(result.inventory[0]?.item.name).toBe("Blade");
      expect(result.inventory[0]?.imbuements[0]?.item?.name).toBe("Crystal");
      const inventoryItem = result.inventory[0];
      if (inventoryItem) inventoryItem.item.name = "Private inventory copy";
      expect(result.profile?.items[0]?.item?.name).toBe("Blade");
    },
  );

  it("reads only the definitions a write changed", async () => {
    const db = await getTestDatabase();
    await fetchProfileUser(db, USER_ID);
    // Raids and upgrades write structure state; staff edits rewrite items.
    await db
      .update(villageStructure)
      .set({ curSp: 400 })
      .where(eq(villageStructure.id, "leaf/hall"));
    await db.update(item).set({ name: "Sharp Blade" }).where(eq(item.id, "blade"));

    const { result, statements } = await recordQueries(() =>
      fetchProfileUser(db, USER_ID),
    );
    expect(result).toEqual(await joinedProfile(USER_ID));
    expect(result?.items[0]?.item?.name).toBe("Sharp Blade");
    expect(
      result?.village?.structures.find((structure) => structure.id === "leaf/hall"),
    ).toMatchObject({ curSp: 400, worldArt: { filepath: "/hall-atlas.png" } });
    expect(statements).toHaveLength(3);
    const reads = statements.slice(1).join("\n");
    expect(reads).toContain("in ('blade')");
    expect(reads).toContain("in ('leaf/hall')");
  });

  it("retries the joined read when a definition changes during hydration", async () => {
    const db = await getTestDatabase();
    const client = beforeStatements(
      db,
      item,
      [() => db.update(item).set({ name: "Reforged" }).where(eq(item.id, "blade"))],
      { operations: ["select"] },
    );
    const { result, statements } = await recordQueries(() =>
      fetchProfileUser(client, USER_ID),
    );
    expect(result?.items[0]?.item?.name).toBe("Reforged");
    const reads = statements.filter((statement) => /^select /i.test(statement));
    expect(reads[0]).toContain("SHA2(JSON_ARRAY(");
    expect(reads.at(-1)).not.toContain("SHA2(JSON_ARRAY(");
  });

  it("never lists a structure deleted during hydration", async () => {
    const db = await getTestDatabase();
    const client = beforeStatements(
      db,
      villageStructure,
      [() => db.delete(villageStructure).where(eq(villageStructure.id, "leaf/bank"))],
      { operations: ["select"] },
    );
    const user = await fetchProfileUser(client, USER_ID);
    expect(user?.village?.structures.map((structure) => structure.id)).toEqual([
      "leaf/hall",
    ]);
  });
});

describeWithDatabase("profile progression reads", () => {
  const ROLLER_ID = "progression-reader";
  const NEWCOMER_ID = "progression-newcomer";
  afterEach(() => resetTables(userData, quest, questHistory, bloodlineRolls));
  beforeEach(async () => {
    await resetTables(userData, quest, questHistory, bloodlineRolls);
    await insertUsers([
      { userId: ROLLER_ID, username: ROLLER_ID, level: 20 },
      { userId: NEWCOMER_ID, username: NEWCOMER_ID, level: 5 },
    ]);
    await insertQuests([
      { id: "tier-done", questType: "tier", tierLevel: 1, requiredLevel: 1 },
      { id: "tier-open", questType: "tier", tierLevel: 2, requiredLevel: 10 },
      { id: "exam-abandoned", questType: "exam", requiredLevel: 15, maxLevel: 30 },
      { id: "story", questType: "story" },
    ]);
    await insertQuestHistory([
      { userId: ROLLER_ID, questId: "tier-done", questType: "tier", completed: 1 },
      // The denormalised type has drifted; the join reads the quest's own type.
      {
        userId: ROLLER_ID,
        questId: "exam-abandoned",
        questType: "daily",
        completed: 0,
      },
      { userId: ROLLER_ID, questId: "story", questType: "story", completed: 1 },
      { userId: NEWCOMER_ID, questId: "tier-done", questType: "tier", completed: 2 },
    ]);
    const db = await getTestDatabase();
    await db.insert(bloodlineRolls).values([
      { id: "roll-a", userId: ROLLER_ID, bloodlineId: "leaf", type: "ITEM" },
      { id: "roll-b", userId: ROLLER_ID, bloodlineId: "mist", type: "ITEM" },
      { id: "roll-pity", userId: ROLLER_ID, bloodlineId: null, type: "PITY" },
      { id: "roll-other", userId: NEWCOMER_ID, bloodlineId: "sand", type: "ITEM" },
    ]);
  });

  it.each([ROLLER_ID, NEWCOMER_ID])(
    "reads the standalone bootstrap and roll results in the profile statement (%s)",
    async (userId) => {
      const db = await getTestDatabase();
      const [bootstrap, rolls, profile] = await Promise.all([
        selectQuestForFetchQuestBootstrap(db, userId),
        fetchBloodlineCollectionRolls(db, userId),
        fetchProfileUser(db, userId),
      ]);
      const { result, statements } = await recordQueries(() =>
        fetchProgressionProfileUser(db, userId),
      );
      const byId = <T extends { id: string }>(rows: T[] = []) =>
        [...rows].sort((a, b) => a.id.localeCompare(b.id));
      expect(byId(result?.questBootstrap)).toEqual(byId(bootstrap));
      expect([...(result?.rolledBloodlineIds ?? [])].sort()).toEqual(
        rolls.flatMap((roll) => (roll.bloodlineId ? [roll.bloodlineId] : [])).sort(),
      );
      expect(result?.user).toEqual(profile as NonNullable<typeof profile>);
      expect(statements).toHaveLength(1);
    },
  );

  it("keeps the progression columns out of other profile reads", async () => {
    const db = await getTestDatabase();
    const { result, statements } = await recordQueries(() =>
      fetchProfileUser(db, ROLLER_ID),
    );
    expect(result).not.toHaveProperty("questBootstrap");
    expect(result).not.toHaveProperty("rolledBloodlineIds");
    expect(statements[0]).not.toContain("BloodlineRolls");
  });

  it("returns empty lists when no rolls or bootstrap quests exist", async () => {
    const db = await getTestDatabase();
    await resetTables(quest, bloodlineRolls);
    const result = await fetchProgressionProfileUser(db, ROLLER_ID);
    expect(result?.questBootstrap).toEqual([]);
    expect(result?.rolledBloodlineIds).toEqual([]);
  });
});
