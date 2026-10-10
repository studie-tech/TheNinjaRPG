import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it } from "bun:test";
import { describeWithDatabase, runRawSql } from "../../setup/testDatabase";
import { sql } from "drizzle-orm";
import { getTestDatabase } from "../../setup/testDatabase";

const migration = readFileSync(resolve(process.cwd(), "drizzle/migrations/0056_unified_combat_stats_masteries.sql"), "utf8");
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
const energyMigration = migration.slice(migration.indexOf("-- Energy cutover (after training settlement)"))
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
const guideMigration = migration.slice(migration.indexOf("-- Energy cutover (after training settlement)"))
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


const contentTable = "CombatContentMigrationFixture";
const contentMigration = migration.slice(migration.indexOf("-- Jutsu text follows"), migration.indexOf("ALTER TABLE `Bloodline` MODIFY"))
  .split("\n").filter(line => !line.startsWith("--")).join("\n")
  .split(";").map(statement => statement.trim()).filter(Boolean)
  .map(statement => statement.replaceAll("`Jutsu`", `\`${contentTable}\``));
const contentFixtures = [
  {
    "id": "eJISnE5IrvC09FuoeuQ5X",
    "description": "A stormborn genjutsu that increases the user's offensive stats while weakening the enemy’s genjutsu defense, intelligence, and willpower.",
    "battleDescription": "%user invokes a wrathful storm within the target’s mind—**Arashi Ikari**, the Tempest of Fury. Thunder cracks and phantom lightning arcs through a mental maelstrom, amplifying the user’s genjutsu chakra to overwhelming levels. At the same time, %target’s mental defenses are shredded by roaring winds and blinding flashes, reducing their intelligence and willpower to resist. The storm leaves the battlefield unscathed—but in the minds of those caught in it, chaos reigns.",
    "effects": [
      {
        "type": "damage",
        "target": "INHERIT"
      },
      {
        "type": "increasedamagetaken",
        "target": "INHERIT"
      }
    ],
    "expectedDescription": "A stormborn genjutsu that damages the enemy and increases the damage they take.",
    "expectedBattleDescription": "%user conjures a storm of phantom lightning in %target’s mind. The mental assault deals damage and leaves %target more vulnerable to subsequent attacks."
  },
  {
    "id": "iioSrLkg_-jlX5xIycMYr",
    "description": "A rapid-fire attack where flaming kunai are thrown in a barrage. Decreases Target Defensive stats while boosting caster offense. ",
    "battleDescription": "%user unleashes a relentless stream of flaming kunai at %target, each one carving through the air with searing heat. The scorching impact disrupts the enemy’s form, weakening their Bukijutsu defenses. As the flames intensify, %user’s offensive presence surges, their strikes becoming even more aggressive and empowered.",
    "effects": [
      {
        "type": "damage",
        "target": "INHERIT"
      },
      {
        "type": "afterburn",
        "target": "INHERIT"
      }
    ],
    "expectedDescription": "A barrage of flaming kunai that damages the enemy and leaves them burning.",
    "expectedBattleDescription": "%user unleashes a relentless stream of flaming kunai at %target. Each strike sears the enemy, leaving flames that continue to burn after the initial impact."
  },
  {
    "id": "mdIWNxovAIVj_8esBaYGX",
    "description": "A blazing surge of chakra that fuels the user’s ninjutsu while mentally disorienting and weakening the enemy’s defenses.",
    "battleDescription": "%user channels refined fire chakra into a spiraling blaze that amplifies their ninjutsu potency. The heat distorts the air and attacks %target’s clarity and mental resistance, lowering their ability to defend against future techniques by weakening their ninjutsu defense, intelligence, and willpower.",
    "effects": [
      {
        "type": "damage",
        "target": "INHERIT"
      },
      {
        "type": "afterburn",
        "target": "INHERIT"
      }
    ],
    "expectedDescription": "A spiraling blaze of fire chakra that damages the enemy and leaves them burning.",
    "expectedBattleDescription": "%user channels refined fire chakra into a spiraling blaze that engulfs %target. The scorching flames deal damage and continue to burn after the initial impact."
  },
  {
    "id": "TI1JQAG1ltx_uLHE9-UUs",
    "description": "A chaining lightning technique that enhances the user’s power while weakening the opponent’s mental and chakra resilience.",
    "battleDescription": "%user channels a concentrated flow of lightning chakra through their body, heightening their offensive capabilities. Sparks then arc across the battlefield toward %target, surging through their chakra network and diminishing their resistance to ninjutsu by weakening their intelligence, willpower, and ninjutsu defenses.",
    "effects": [
      {
        "type": "damage",
        "target": "INHERIT"
      },
      {
        "type": "decreasedamagetaken",
        "target": "SELF"
      }
    ],
    "expectedDescription": "A lightning technique that damages the enemy and reduces the damage the user takes.",
    "expectedBattleDescription": "%user channels lightning chakra through their body before sending sparks arcing toward %target. The strike deals damage while the surrounding chakra shields %user, reducing the damage they take."
  }
] as const;

describeWithDatabase("combat content SQL migration", () => {
  afterEach(async () => { await runRawSql(`DROP TABLE IF EXISTS \`${contentTable}\``); });
  it("describes damage effects accurately and preserves edited wording or mechanics", async () => {
    await runRawSql(`CREATE TABLE \`${contentTable}\` (id varchar(191) PRIMARY KEY, description text, battleDescription text, effects json)`);
    const db = await getTestDatabase();
    for (const fixture of contentFixtures) {
      await db.execute(sql.raw(`INSERT INTO \`${contentTable}\` VALUES (${[fixture.id, fixture.description, fixture.battleDescription, JSON.stringify(fixture.effects)].map(value => "'" + value.replaceAll("'", "''") + "'").join(",")})`));
    }
    for (const statement of contentMigration) await runRawSql(statement);
    const [rows] = await db.execute(sql.raw(`SELECT id,description,battleDescription,CAST(effects AS CHAR) AS effects FROM \`${contentTable}\``)) as unknown as [Record<string, string>[], unknown];
    for (const fixture of contentFixtures) {
      const row = rows.find(row => row.id === fixture.id)!;
      expect(row.description).toBe(fixture.expectedDescription);
      expect(row.battleDescription).toBe(fixture.expectedBattleDescription);
      expect(JSON.parse(row.effects!)).toEqual(fixture.effects);
    }
    const fixture = contentFixtures[0]!;
    await runRawSql(`UPDATE \`${contentTable}\` SET description='Staff wording.',battleDescription='Staff battle wording.'`);
    for (const statement of contentMigration) await runRawSql(statement);
    const [edited] = await db.execute(sql.raw(`SELECT description,battleDescription FROM \`${contentTable}\``)) as unknown as [Record<string, string>[], unknown];
    expect(edited.every(row => row.description === "Staff wording." && row.battleDescription === "Staff battle wording.")).toBe(true);
    await db.execute(sql.raw(`UPDATE \`${contentTable}\` SET description='${fixture.description.replaceAll("'", "''")}',effects='[{"type":"damage","target":"INHERIT"},{"type":"increasestat","target":"SELF"}]' WHERE id='${fixture.id}'`));
    for (const statement of contentMigration) await runRawSql(statement);
    const [changed] = await db.execute(sql.raw(`SELECT description FROM \`${contentTable}\` WHERE id='${fixture.id}'`)) as unknown as [Record<string, string>[], unknown];
    expect(changed[0]!.description).toBe(fixture.description);
  });
});
