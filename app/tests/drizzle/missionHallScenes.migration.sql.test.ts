import { beforeEach, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { gameAsset, quest } from "@/drizzle/schema";
import { AllObjectives } from "@/validators/objectives";
import { insertQuests } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../setup/testDatabase";

const migration = await readFile(
  new URL("../../drizzle/migrations/0198_tiny_rockslide.sql", import.meta.url),
  "utf8",
);
const statements = migration
  .split(/;\n/)
  .map((entry) => entry.replace(/^\s*--.*$/gm, ""));
/** The Mission Hall update for one quest. */
const update = (questId: string) => {
  const statement = statements.find(
    (entry) =>
      entry.includes(`UPDATE \`Quest\` SET`) &&
      entry.includes(`WHERE \`id\` = '${questId}'`),
  );
  if (!statement) throw new Error(`No Mission Hall update for ${questId}`);
  return statement;
};
const sceneArt = statements.find((entry) =>
  entry.includes(
    "INSERT INTO `GameAsset` (`id`, `name`, `type`, `image`, `url`, `frames`",
  ),
);

const HYORIN_ERRAND = "A3he5vVNzt5mbQI8JPQj9";
const TSUKIMORI_ERRAND = "H3s7RQ0coL4a4Jlyzc_h-";
const GATEWRIGHT = "qFJk06nwwy0B9o2qZ1oZE";
const LEMU = "UxcxyMdvZoae6zaSMZklT";
const BLANK = "1YXbXYW2wz3GETVMb6DT6";

/** A village errand as production stores it: two walks, a blank cast, no text, and a
 * second step placed in whatever sector the player stands in. */
const errand = (id: string, objectiveIds: [string, string]) => ({
  id,
  name: "Hyorins Broken Gate",
  questType: "errand" as const,
  description: "An ox charged your gate. Help repair it!",
  consecutiveObjectives: true,
  content: {
    sceneBackground: "",
    sceneCharacters: [id === HYORIN_ERRAND ? BLANK : LEMU],
    objectives: objectiveIds.map((objectiveId, index) => ({
      id: objectiveId,
      task: "move_to_location",
      description: "",
      sectorType: index === 0 ? "user_village" : "current_sector",
      locationType: "specific",
      latitude: 5 + index,
      longitude: 5 + index,
      sceneBackground: "",
      sceneCharacters: [],
      nextObjectiveId: index === 0 ? objectiveIds[1] : undefined,
    })),
  } as never,
});

describeWithDatabase("Mission Hall scenes", () => {
  beforeEach(async () => {
    await resetTables(quest, gameAsset);
    await insertQuests([
      errand(HYORIN_ERRAND, ["0hXsXLaSTiIv4E-Ys1JUh", "nNxvaVjDYFyRsj_rSYebW"]),
      errand(TSUKIMORI_ERRAND, ["restructured-1", "restructured-2"]),
    ]);
    if (sceneArt) await runRawSql(sceneArt);
    await runRawSql(update(HYORIN_ERRAND));
    await runRawSql(update(TSUKIMORI_ERRAND));
  });

  it("gives an errand someone who explains it and says what each walk is for", async () => {
    const database = await getTestDatabase();
    const row = await database.query.quest.findFirst({
      where: eq(quest.id, HYORIN_ERRAND),
    });
    expect(row?.name).toBe("Hyorin's Broken Gate");
    const content = z
      .object({
        sceneCharacters: z.array(z.string()),
        objectives: z.array(AllObjectives),
      })
      .parse(row?.content);
    expect(content.sceneCharacters).toEqual([GATEWRIGHT]);
    for (const objective of content.objectives) {
      expect(objective.sceneCharacters).toEqual([GATEWRIGHT]);
      expect(objective.sceneBackground).not.toBe("");
      expect(objective.description).toContain("gatewright");
      // The gate is in the player's own village, wherever they happen to stand.
      expect(objective).toMatchObject({ sectorType: "user_village" });
    }
  });

  it("creates the art its scenes show wherever it is missing", async () => {
    const database = await getTestDatabase();
    const row = await database.query.quest.findFirst({
      where: eq(quest.id, HYORIN_ERRAND),
    });
    const content = z
      .object({ objectives: z.array(z.object({ sceneBackground: z.string() })) })
      .parse(row?.content);
    const ids = [GATEWRIGHT, ...content.objectives.map((o) => o.sceneBackground)];
    const art = await database.query.gameAsset.findMany({
      where: inArray(gameAsset.id, ids),
    });
    expect(art.map((entry) => entry.id).sort()).toEqual([...new Set(ids)].sort());
  });

  it("leaves a quest alone once its objectives no longer match", async () => {
    const database = await getTestDatabase();
    const row = await database.query.quest.findFirst({
      where: eq(quest.id, TSUKIMORI_ERRAND),
    });
    expect(row?.name).toBe("Hyorins Broken Gate");
    expect(
      z.object({ sceneCharacters: z.array(z.string()) }).parse(row?.content)
        .sceneCharacters,
    ).toEqual([LEMU]);
  });
});

describeWithDatabase("village errands", () => {
  const errandInserts = statements.filter((entry) =>
    /INSERT INTO `Quest` [^;]*'errand', 'D'/.test(entry),
  );

  beforeEach(async () => {
    await resetTables(quest);
    for (const statement of errandInserts) await runRawSql(statement);
  });

  it("offers every village several errands beside its own gate", async () => {
    const database = await getTestDatabase();
    const errands = await database.query.quest.findMany({
      where: eq(quest.questType, "errand"),
    });
    expect(errands.length).toBeGreaterThanOrEqual(5);
    expect(new Set(errands.map((entry) => entry.name)).size).toBe(errands.length);
    for (const entry of errands) {
      expect(entry).toMatchObject({
        questRank: "D",
        requiredVillage: null,
        hidden: false,
      });
      const content = z
        .object({ objectives: z.array(AllObjectives) })
        .parse(entry.content);
      for (const objective of content.objectives) {
        expect(objective).toMatchObject({
          task: "move_to_location",
          sectorType: "user_village",
        });
        expect(objective.sceneCharacters).toHaveLength(1);
        expect(objective.sceneBackground).not.toBe("");
        expect(objective.description).not.toBe("");
      }
    }
  });
});
