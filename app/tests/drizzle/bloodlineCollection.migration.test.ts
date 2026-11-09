import { readFile } from "node:fs/promises";
import { beforeEach, expect, it } from "bun:test";
import { quest } from "@/drizzle/schema";
import { insertQuests } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../setup/testDatabase";

const definitions = [
  ["-ox0s_IEnFE-PNg0LCSuc", "H"],
  ["l3ZJjFP0_BiyawXjxVHqU", "ALL"],
  ["n05YRB5bl5zUjwqMPBJSN", "A"],
  ["pkkRYsVbB2Rs-V5Q9Kuod", "B"],
  ["WhlFEtsIbCUq53L84FQo6", "C"],
  ["wNOr8nnxzGQy3f3JFk9ch", "S"],
  ["yUBrMxAvFnNMTIMdIqkWs", "D"],
] as const;
const migration = await readFile(
  new URL(
    "../../drizzle/migrations/0081_bloodline_collection_ranks.sql",
    import.meta.url,
  ),
  "utf8",
);

/** Build a pre-migration definition with sibling content that the conversion must preserve. */
const legacyQuest = (id: string, rank: string, excludeSRank?: boolean) => ({
  id,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  content: {
    objectives: [
      {
        id: `bl677-${rank}`,
        task: "bloodline_collection",
        bloodlineRank: rank,
        ...(excludeSRank === undefined ? {} : { excludeSRank }),
        reward_badges: ["collector"],
        description: "Collect these bloodlines",
      },
      { id: "other", task: "user_level", value: 5 },
    ],
    reward: { reward_money: 10 },
    sceneBackground: "scene",
    sceneCharacters: [],
  },
});

describeWithDatabase("bloodline collection rank migration", () => {
  beforeEach(async () => resetTables(quest));

  it("migrates every production definition without changing IDs, rewards or quest versions", async () => {
    const rows = definitions.map(([id, rank]) => legacyQuest(id, rank));
    await insertQuests(rows as never);
    await runRawSql(migration);
    const database = await getTestDatabase();
    const converted = await database.query.quest.findMany();
    for (const row of rows) {
      const result = converted.find((entry) => entry.id === row.id);
      const { bloodlineRank, ...objective } = row.content.objectives.find(
        (entry) => "bloodlineRank" in entry,
      )!;
      expect(result?.content as unknown).toEqual({
        ...row.content,
        objectives: [
          {
            ...objective,
            bloodlineRanks:
              bloodlineRank === "ALL" ? ["D", "C", "B", "A", "S"] : [bloodlineRank],
          },
          row.content.objectives[1],
        ],
      });
      expect(result?.updatedAt).toEqual(row.updatedAt);
    }
    await runRawSql(migration);
    expect(await database.query.quest.findMany()).toEqual(converted);
  });

  it.each(["ALL", "S"])(
    "removes the exclusion flag while preserving its meaning for %s",
    async (rank) => {
      const [id] = definitions.find((entry) => entry[1] === rank)!;
      await insertQuests([legacyQuest(id, rank, true)] as never);
      await runRawSql(migration);
      const result = await (await getTestDatabase()).query.quest.findFirst();
      expect(result?.content.objectives[0]).toMatchObject({
        bloodlineRanks: rank === "ALL" ? ["D", "C", "B", "A"] : ["S"],
      });
      expect(result?.content.objectives[0]).not.toHaveProperty("bloodlineRank");
      expect(result?.content.objectives[0]).not.toHaveProperty("excludeSRank");
    },
  );

  it.each([
    { id: "edited", task: "bloodline_collection" },
    { id: "bl677-H", task: "user_level" },
    { id: "bl677-H", task: "bloodline_collection", bloodlineRanks: ["A", "H"] },
  ])("leaves changed or already-migrated objectives untouched: %j", async (patch) => {
    const row = legacyQuest(definitions[0][0], "H");
    row.content.objectives[0] = { ...row.content.objectives[0]!, ...patch };
    await insertQuests([row] as never);
    await runRawSql(migration);
    expect(
      (await (await getTestDatabase()).query.quest.findFirst())?.content as unknown,
    ).toEqual(row.content);
  });
});
