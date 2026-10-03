import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { describeWithDatabase, runRawSql } from "../../setup/testDatabase";
import { sql } from "drizzle-orm";
import { getTestDatabase } from "../../setup/testDatabase";

const migration = readFileSync(resolve(process.cwd(), "drizzle/migrations/0052_unified_combat_stats_masteries.sql"), "utf8");
const backfill = migration.slice(migration.indexOf("UPDATE `UserData`\nSET"), migration.indexOf("ALTER TABLE `UserData` MODIFY COLUMN `currentlyTraining`"));
const table = "UnifiedCombatMigrationFixture";
const disciplines = ["ninjutsu", "genjutsu", "taijutsu", "bukijutsu"];
const old = disciplines.flatMap((type) => [`${type}Offence`, `${type}Defence`]);
const fields = [...old, "offence", "defence", ...disciplines.map((type) => `${type}Mastery`), "bloodlineMastery", "sageMastery"];

describeWithDatabase("uniform combat-stat SQL migration", () => {
  afterEach(async () => { await runRawSql(`DROP TABLE IF EXISTS \`${table}\``); });
  it("retains equal percentages across builds, full caps and stored overflow", async () => {
    await runRawSql(`CREATE TABLE \`${table}\` (userId varchar(30) PRIMARY KEY, isAi boolean DEFAULT 0, isSummon boolean DEFAULT 0, experience double DEFAULT 777, ${fields.map((f) => `\`${f}\` double NOT NULL DEFAULT 10`).join(",")})`);
    for (const [id, values] of [
      ["specialist", [400010, 400010, 10, 10, 10, 10, 10, 10]],
      ["broad", Array(8).fill(100010)],
      ["capped", Array(8).fill(450000)],
      ["overcap", Array(8).fill(480000)],
      ["defaults", Array(8).fill(10)],
    ] as const) {
      await runRawSql(`INSERT INTO \`${table}\` (userId, ${old.map((f) => `\`${f}\``).join(",")}) VALUES ('${id}',${values.join(",")})`);
    }
    await runRawSql(`INSERT INTO \`${table}\` (userId,isAi,ninjutsuOffence,taijutsuDefence) VALUES ('ai',1,200,500)`);
    await runRawSql(backfill.replaceAll("`UserData`", `\`${table}\``));
    const db=await getTestDatabase();
    const rows=await db.execute(sql.raw(`SELECT * FROM \`${table}\``)) as unknown as [Record<string, number | string>[], unknown];
    const byId = Object.fromEntries(rows[0].map((row) => [row.userId, row]));
    for (const id of ["specialist", "broad", "capped", "overcap"]) {
      const row=byId[id]!;
      const invested=old.reduce((total, field) => total + Number(row[field]) - 10, 0);
      const retained=Number(row.offence)+Number(row.defence)-20;
      expect(retained/invested).toBeCloseTo(0.7222327163, 9);
      expect(row.experience).toBe(777);
    }
    expect(Number(byId.specialist!.offence)).toBeCloseTo(Number(byId.broad!.offence), 8);
    expect(byId.capped!.offence).toBe(1300000);
    expect(Number(byId.overcap!.offence)).toBeGreaterThan(1300000);
    expect(byId.defaults!.offence).toBe(10);
    expect(byId.ai!.offence).toBe(200);
    expect(byId.ai!.defence).toBe(500);
    expect(byId.capped!.ninjutsuMastery).toBe(450000);
    expect(byId.capped!.sageMastery).toBe(10);
  });
});


const energyTable = "EnergyMigrationFixture";
const energyPool = "EnergyPoolFixture";
const energyGuard = "EnergyGuardFixture";
const energyMigration = readFileSync(resolve(process.cwd(), "drizzle/migrations/0054_elite_titanium_man.sql"), "utf8")
  .replaceAll("`UserData`", `\`${energyTable}\``)
  .replaceAll("`_EnergyPool`", `\`${energyPool}\``)
  .replaceAll("`_EnergyTrainingGuard`", `\`${energyGuard}\``)
  .split("\n").filter(line => !line.startsWith("--")).join("\n")
  .split(";").map(statement => statement.trim()).filter(statement => statement && !statement.startsWith("UPDATE `GuideArticle`"));

describeWithDatabase("Energy SQL cutover", () => {
  afterEach(async () => {
    for (const name of [energyTable, energyPool, energyGuard]) await runRawSql(`DROP TABLE IF EXISTS \`${name}\``);
  });
  it.each(["currentlyTraining", "currentlyTrainingMastery", "unstaged", "settled"])("guards %s sessions and fills staged capacities", async state => {
    await runRawSql(`CREATE TABLE \`${energyTable}\` (userId varchar(30) PRIMARY KEY, currentlyTraining varchar(30), currentlyTrainingMastery varchar(30), trainingStartedAt datetime, lastCombatTrainingFinishedAt datetime)`);
    await runRawSql(`CREATE TABLE \`${energyPool}\` (userId varchar(30) PRIMARY KEY, capacity double NOT NULL)`);
    await runRawSql(`INSERT INTO \`${energyTable}\` (userId) VALUES ('player')`);
    if (state === "currentlyTraining" || state === "currentlyTrainingMastery") await runRawSql(`UPDATE \`${energyTable}\` SET \`${state}\` = 'active'`);
    if (state !== "unstaged") await runRawSql(`INSERT INTO \`${energyPool}\` VALUES ('player',675)`);
    if (state !== "settled") {
      const failingIndex = state === "unstaged" ? 3 : 2;
      for (const statement of energyMigration.slice(0, failingIndex)) await runRawSql(statement);
      await expect(runRawSql(energyMigration[failingIndex]!)).rejects.toThrow();
      // No column removal or backfill is allowed before both guards pass.
      await runRawSql(`SELECT currentlyTraining, trainingStartedAt FROM \`${energyTable}\``);
      return;
    }
    for (const statement of energyMigration) await runRawSql(statement);
    const db = await getTestDatabase();
    const [rows] = await db.execute(sql.raw(`SELECT curEnergy,maxEnergy FROM \`${energyTable}\``)) as unknown as [Record<string, number>[], unknown];
    expect(rows).toEqual([{curEnergy:675, maxEnergy:675}]);
    await expect(runRawSql(`SELECT currentlyTraining FROM \`${energyTable}\``)).rejects.toThrow();
  });
});


const guideTable = "EnergyGuideMigrationFixture";
const legacyTrainingGuide = "Train offensive taijutsu (or another offence) in short 15-minute bouts when you can.";
const masteryTrainingGuide = "Train Offence in short 15-minute bouts when you can, and a mastery such as Taijutsu alongside it to unlock jutsu and gear of that type.";
const energyTrainingGuide = "Spend Energy to train Offence instantly, and train a mastery such as Taijutsu in timed sessions alongside it to unlock jutsu and gear of that type.";
const guideMigration = readFileSync(resolve(process.cwd(), "drizzle/migrations/0054_elite_titanium_man.sql"), "utf8")
  .split("\n").filter(line => !line.startsWith("--")).join("\n")
  .split(";").map(statement => statement.trim()).filter(statement => statement.startsWith("UPDATE `GuideArticle`"))
  .map(statement => statement.replaceAll("`GuideArticle`", `\`${guideTable}\``));

describeWithDatabase("Energy getting-started guide migration", () => {
  afterEach(async () => { await runRawSql(`DROP TABLE IF EXISTS \`${guideTable}\``); });
  it.each([legacyTrainingGuide, masteryTrainingGuide])("replaces %s while preserving staff text and other articles", async oldText => {
    await runRawSql(`CREATE TABLE \`${guideTable}\` (slug varchar(100) PRIMARY KEY, content text)`);
    await runRawSql(`INSERT INTO \`${guideTable}\` VALUES ('getting-started','<p>Staff introduction.</p><li>${oldText}</li><p>Staff conclusion.</p>'),('other-guide','${oldText}')`);
    for (const statement of guideMigration) await runRawSql(statement);
    const db = await getTestDatabase();
    const [rows] = await db.execute(sql.raw(`SELECT slug,content FROM \`${guideTable}\` ORDER BY slug`)) as unknown as [Record<string, string>[], unknown];
    expect(rows).toEqual([
      {slug: "getting-started", content: `<p>Staff introduction.</p><li>${energyTrainingGuide}</li><p>Staff conclusion.</p>`},
      {slug: "other-guide", content: oldText},
    ]);
    await runRawSql(`UPDATE \`${guideTable}\` SET content = 'Staff training instructions.' WHERE slug = 'getting-started'`);
    for (const statement of guideMigration) await runRawSql(statement);
    const [edited] = await db.execute(sql.raw(`SELECT content FROM \`${guideTable}\` WHERE slug = 'getting-started'`)) as unknown as [Record<string, string>[], unknown];
    expect(edited).toEqual([{content: "Staff training instructions."}]);
  });
});
