import { afterEach, beforeEach, expect, it } from "bun:test";
import { readMigration } from "../setup/migrations";
import { describeWithDatabase, queryRawSql, runRawSql } from "../setup/testDatabase";

const migration = await readMigration("0168_naive_magus.sql");
const columns = {
  Bloodline: ["effects"],
  SkillTree: ["effects"],
  SageMode: ["effects", "afterEffects", "level2Effects"],
  Item: ["effects"],
  Jutsu: ["effects"],
  UserData: ["effects"],
  RaidDamageThreshold: ["effects"],
  UserRaidBuff: ["effects"],
  PetSpecies: ["effects"],
  Battle: ["usersEffects", "groundEffects", "extraState", "usersState"],
};
const fixture = (table: string) => `TagStatsMigration_${table}`;
const original = [
  {
    type: "increasestat",
    statTypes: [],
    generalTypes: ["Strength"],
    direction: "both",
    power: 10,
  },
  {
    type: "damage",
    statTypes: ["Highest"],
    generalTypes: [],
    power: 40,
    timeTracker: { round: 3 },
  },
  { type: "decreasestat", generalTypes: ["Highest"], direction: "offence", power: 20 },
  {
    type: "increasestat",
    statTypes: ["Ninjutsu"],
    generalTypes: ["Speed"],
    direction: "defence",
  },
  { type: "increasestat", statTypes: [], generalTypes: [], direction: "offence" },
  { type: "weakness", statTypes: ["Taijutsu"], elements: ["Water"] },
];
const expected = [
  { type: "increasestat", generalTypes: ["Strength"], direction: "none", power: 10 },
  { type: "damage", generalTypes: [], power: 40, timeTracker: { round: 3 } },
  { type: "decreasestat", generalTypes: ["Highest"], direction: "none", power: 20 },
  { type: "increasestat", generalTypes: ["Speed"], direction: "defence" },
  { type: "increasestat", generalTypes: [], direction: "offence" },
  { type: "weakness", elements: ["Water"] },
];
const rewrite = (sql: string) =>
  Object.keys(columns).reduce(
    (text, table) => text.replaceAll(`\`${table}\``, `\`${fixture(table)}\``),
    sql,
  );

describeWithDatabase("combat tag stat-selector migration", () => {
  beforeEach(async () => {
    for (const [table, fields] of Object.entries(columns)) {
      const key = table === "UserData" ? "userId" : "id";
      await runRawSql(
        `CREATE TABLE \`${fixture(table)}\` (\`${key}\` varchar(50) PRIMARY KEY, ${fields.map((field) => `\`${field}\` JSON NOT NULL`).join(",")})`,
      );
    }
  });

  afterEach(async () => {
    await runRawSql(
      `DROP TABLE IF EXISTS ${Object.keys(columns)
        .map((table) => `\`${fixture(table)}\``)
        .join(",")}`,
    );
  });

  it("preserves effect order, nested battle templates, metadata, empty arrays and general-only intent during cleanup", async () => {
    for (const [table, fields] of Object.entries(columns)) {
      const document = (field: string, tags: object[]) =>
        field === "extraState"
          ? {
              jutsus: { "quoted.id": { effects: tags } },
              items: { weapon: { effects: tags } },
              sageModes: {
                sage: { effects: tags, afterEffects: tags, level2Effects: tags },
              },
            }
          : field === "usersState"
            ? [{ items: [{ imbuementEffects: tags }], effects: tags }]
            : tags;
      for (const [id, tags] of [
        ["populated", original],
        ["empty", []],
        ["single", [original[0]!]],
        ["many", Array.from({ length: 120 }, (_, i) => ({ ...original[0], power: i }))],
      ] as const) {
        await runRawSql(
          `INSERT INTO \`${fixture(table)}\` VALUES ('${id}', ${fields.map((field) => `'${JSON.stringify(document(field, [...tags]))}'`).join(",")})`,
        );
      }
    }
    await runRawSql(rewrite(migration));
    for (const [table, fields] of Object.entries(columns)) {
      const key = table === "UserData" ? "userId" : "id";
      const rows = await queryRawSql<Record<string, unknown>>(
        `SELECT * FROM \`${fixture(table)}\``,
      );
      for (const row of rows) {
        const check = (value: unknown) => {
          const parsed = typeof value === "string" ? JSON.parse(value) : value;
          expect(JSON.stringify(parsed)).not.toContain('"statTypes"');
          return parsed;
        };
        for (const field of fields) {
          const value = check(row[field]);
          const tags =
            field === "extraState"
              ? value.jutsus["quoted.id"].effects
              : field === "usersState"
                ? value[0].items[0].imbuementEffects
                : value;
          if (row[key] === "populated") expect(tags).toEqual(expected);
          if (row[key] === "empty") expect(tags).toEqual([]);
          if (row[key] === "single") expect(tags).toEqual([expected[0]]);
          if (row[key] === "many")
            expect(tags).toEqual(
              Array.from({ length: 120 }, (_, i) => ({ ...expected[0], power: i })),
            );
        }
      }
    }
  });
  it("migrates more than 1,000 legacy tags in content and nested battles without changing the session recursion limit", async () => {
    const tags = Array.from({ length: 1001 }, (_, power) => ({
      type: "damage",
      statTypes: ["Ninjutsu"],
      power,
      description: "Retain every tag and its position",
    }));
    const cleaned = tags.map(({ statTypes: _statTypes, ...tag }) => tag);
    const nested = (effects: object[]) => ({
      jutsus: { "quoted.id": { effects } },
      metadata: { type: "battle", round: 7 },
    });
    await runRawSql(
      `INSERT INTO \`${fixture("Jutsu")}\` VALUES ('large', '${JSON.stringify(tags)}'), ('unaffected', '${JSON.stringify(cleaned)}')`,
    );
    await runRawSql(
      `INSERT INTO \`${fixture("Battle")}\` VALUES ('large', '[]', '[]', '${JSON.stringify(nested(tags))}', '[]'), ('unaffected', '[]', '[]', '${JSON.stringify(nested(cleaned))}', '[]')`,
    );
    for (const table of ["Jutsu", "Battle"]) {
      await runRawSql(
        `CREATE TRIGGER \`${fixture(table)}_skip\` BEFORE UPDATE ON \`${fixture(table)}\` FOR EACH ROW BEGIN IF OLD.id = 'unaffected' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Clean documents must not be updated'; END IF; END`,
      );
    }
    const [before] = await queryRawSql<{ depth: number }>(
      "SELECT @@cte_max_recursion_depth AS depth",
    );
    expect(before?.depth).toBe(1000);
    await runRawSql(rewrite(migration));
    const content = await queryRawSql<{ effects: unknown }>(
      `SELECT effects FROM \`${fixture("Jutsu")}\``,
    );
    const battles = await queryRawSql<{ extraState: unknown }>(
      `SELECT extraState FROM \`${fixture("Battle")}\``,
    );
    const parse = (value: unknown) =>
      typeof value === "string" ? JSON.parse(value) : value;
    expect(content).toHaveLength(2);
    expect(battles).toHaveLength(2);
    for (const row of content) expect(parse(row.effects)).toEqual(cleaned);
    for (const row of battles) expect(parse(row.extraState)).toEqual(nested(cleaned));
    const [after] = await queryRawSql<{ depth: number }>(
      "SELECT @@cte_max_recursion_depth AS depth",
    );
    expect(after?.depth).toBe(before?.depth);
  }, 30_000);
});
