import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeEach, expect, it } from "bun:test";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { skillTree, userData, userSkill } from "@/drizzle/schema";
import { getActivityBonuses } from "@/libs/activityBonuses";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { skillTreeRouter } from "@/server/api/routers/skillTree";
import { IncreaseHuntingYield } from "@/validators/combat";
import { insertUsers } from "../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../setup/testDatabase";

const migration = await readFile(
  new URL("../../drizzle/migrations/0121_reconcile_skill_points.sql", import.meta.url),
  "utf8",
);

it("loads skill-point reconciliation through the migration journal", () => {
  const migrations = readMigrationFiles({
    migrationsFolder: fileURLToPath(
      new URL("../../drizzle/migrations", import.meta.url),
    ),
  });
  expect(
    migrations.filter(({ sql }) => sql.join("\n").includes(migration)),
  ).toHaveLength(1);
});

describeWithDatabase("skill-point reconciliation migration", () => {
  beforeEach(async () => resetTables(userSkill, skillTree, userData));

  it("preserves the budget and effects of skills purchased with existing points", async () => {
    const userId = "allocated";
    await insertUsers([{ userId, rank: "CHUNIN", level: 50, skillPoints: 30 }]);
    const db = await getTestDatabase();
    const skills = ["hunting-1", "hunting-2", "hunting-3"].map((id) => ({
      id,
      name: id,
      image: "skill.webp",
      description: "Hunting yield bonus",
      costSkillPoints: 10,
      effects: [IncreaseHuntingYield.parse({ power: 1 })],
    }));
    await db.insert(skillTree).values(skills);
    const caller = await callerFor(skillTreeRouter, userId);
    for (const skill of skills) {
      expect(await caller.purchaseSkill({ skillId: skill.id })).toMatchObject({
        success: true,
      });
    }
    const allocations = await db.query.userSkill.findMany();

    await runRawSql(migration);

    const [{ user }, ownedSkills] = await Promise.all([
      fetchUpdatedUser({ client: db, userId }),
      caller.getUserSkills(),
    ]);
    if (!user) throw new Error("Missing skill owner");
    expect({
      total: user.skillPoints,
      used: ownedSkills.usedSkillPoints,
      available: user.skillPoints - ownedSkills.usedSkillPoints,
      activeSkills: ownedSkills.activatedSkillCount,
      huntingBonus: getActivityBonuses(user).huntingBonusQuantity,
    }).toEqual({ total: 30, used: 30, available: 0, activeSkills: 3, huntingBonus: 3 });
    expect(await db.query.userSkill.findMany()).toEqual(allocations);
  });

  it("grants missing level points, excludes AI and preserves existing totals", async () => {
    await insertUsers([
      { userId: "over", rank: "CHUNIN", level: 50, skillPoints: 30 },
      { userId: "under", rank: "JONIN", level: 100, skillPoints: 10 },
      { userId: "level-31", rank: "CHUNIN", level: 31, skillPoints: 10 },
      { userId: "level-31-under", rank: "CHUNIN", level: 31, skillPoints: 0 },
      { userId: "level-30", rank: "CHUNIN", level: 30, skillPoints: 10 },
      { userId: "level-29", rank: "GENIN", level: 29, skillPoints: 10 },
      { userId: "level-49", rank: "CHUNIN", level: 49, skillPoints: 0 },
      { userId: "level-51", rank: "JONIN", level: 51, skillPoints: 20 },
      { userId: "level-59", rank: "JONIN", level: 59, skillPoints: 20 },
      { userId: "level-60", rank: "JONIN", level: 60, skillPoints: 20 },
      { userId: "level-61", rank: "JONIN", level: 61, skillPoints: 40 },
      { userId: "genin", rank: "GENIN", level: 30, skillPoints: 10 },
      { userId: "genin-31", rank: "GENIN", level: 31, skillPoints: 10 },
      { userId: "elite", rank: "ELITE JONIN", level: 110, skillPoints: 0 },
      { userId: "elder", rank: "ELDER", level: 100, skillPoints: 30 },
      { userId: "ai", rank: "CHUNIN", level: 50, skillPoints: 30, isAi: true },
      { userId: "ai-under", rank: "CHUNIN", level: 50, skillPoints: 10, isAi: true },
      { userId: "correct", rank: "CHUNIN", level: 50, skillPoints: 20 },
      { userId: "correct-60", rank: "JONIN", level: 60, skillPoints: 30 },
    ]);
    const db = await getTestDatabase();
    const original = await db.query.userData.findMany();
    await runRawSql(migration);
    const rows = await db.query.userData.findMany();
    expect(
      Object.fromEntries(rows.map((row) => [row.userId, row.skillPoints])),
    ).toEqual({
      over: 30,
      under: 30,
      "level-31": 10,
      "level-31-under": 1,
      "level-30": 10,
      "level-29": 10,
      "level-49": 19,
      "level-51": 21,
      "level-59": 29,
      "level-60": 30,
      "level-61": 40,
      genin: 10,
      "genin-31": 10,
      elite: 30,
      elder: 30,
      ai: 30,
      "ai-under": 10,
      correct: 20,
      "correct-60": 30,
    });
    for (const row of rows) {
      const previous = original.find((entry) => entry.userId === row.userId)!;
      if (row.skillPoints === previous.skillPoints) {
        expect(row).toEqual(previous);
      } else {
        expect(row.updatedAt.getTime()).toBeGreaterThan(previous.updatedAt.getTime());
      }
    }
    await runRawSql(migration);
    expect(await db.query.userData.findMany()).toEqual(rows);
  });
});
