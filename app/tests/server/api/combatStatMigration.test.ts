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
