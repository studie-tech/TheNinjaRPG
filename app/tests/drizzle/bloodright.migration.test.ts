import { expect, it } from "bun:test";
import type { RowDataPacket } from "mysql2/promise";
import { readMigration, withMigrationSandbox } from "../setup/migrations";
import { describeWithDatabase } from "../setup/testDatabase";

describeWithDatabase("jutsu Bloodright migration", () => {
  it("refunds saved investments, retires passive Bloodright and preserves ordinary skills", async () => {
    await withMigrationSandbox(
      {
        snapshot: "0194",
        baseline: ["UserData", "SkillTree", "UserSkill"],
        created: ["BloodrightOption"],
      },
      async ({ query }) => {
        await query(
          "CREATE INDEX SkillTree_bloodlineId_idx ON SkillTree (bloodlineId)",
        );
        await query(
          "INSERT INTO UserData (userId, username, gender, seichiSilver, bloodrightSpent, bloodright) VALUES ('owner', 'Owner', 'Other', 50, 125, JSON_ARRAY(JSON_OBJECT('skillId', 'passive', 'cost', 125))), ('empty', 'Empty', 'Other', 75, 0, JSON_ARRAY())",
        );
        await query(
          "INSERT INTO SkillTree (id, name, image, description, effects, pathType) VALUES ('passive', 'Passive', '', '', JSON_ARRAY(), 'BLOODRIGHT'), ('ordinary', 'Ordinary', '', '', JSON_ARRAY(), 'SKILL')",
        );
        await query(
          "INSERT INTO SkillTree (id, name, image, description, effects, pathType, requiredSkillIds) VALUES ('mixed', 'Mixed', '', '', JSON_ARRAY(), 'SKILL', JSON_ARRAY('ordinary', 'passive')), ('retired-only', 'Retired only', '', '', JSON_ARRAY(), 'SKILL', JSON_ARRAY('passive'))",
        );
        await query(
          "INSERT INTO UserSkill (id, userId, skillId) VALUES ('passive-owned', 'owner', 'passive'), ('skill-owned', 'owner', 'ordinary')",
        );
        await query(await readMigration("0195_familiar_greymalkin.sql"));
        const [users] = await query<RowDataPacket[]>(
          "SELECT userId, seichiSilver, bloodrightSpent, JSON_LENGTH(bloodright) AS count FROM UserData ORDER BY userId",
        );
        expect(users).toMatchObject([
          { userId: "empty", seichiSilver: 75, bloodrightSpent: 0, count: 0 },
          { userId: "owner", seichiSilver: 175, bloodrightSpent: 0, count: 0 },
        ]);
        const [skills] = await query<RowDataPacket[]>(
          "SELECT id, requiredSkillIds FROM SkillTree ORDER BY id",
        );
        expect(skills).toMatchObject([
          { id: "mixed", requiredSkillIds: ["ordinary"] },
          { id: "ordinary", requiredSkillIds: [] },
          { id: "retired-only", requiredSkillIds: [] },
        ]);
        const [owned] = await query<RowDataPacket[]>("SELECT skillId FROM UserSkill");
        expect(owned.map((row) => row.skillId)).toEqual(["ordinary"]);
        const [columns] = await query<RowDataPacket[]>("SHOW COLUMNS FROM SkillTree");
        expect(columns.map((row) => row.Field)).not.toContain("pathType");
        const [options] = await query<RowDataPacket[]>(
          "SELECT * FROM BloodrightOption",
        );
        expect(options).toHaveLength(0);
      },
    );
  });
});
