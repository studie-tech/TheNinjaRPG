import { readFile } from "node:fs/promises";
import { beforeEach, expect, it } from "bun:test";
import { inArray } from "drizzle-orm";
import {
  CREATOR_TRIAL_FIRST_FORM,
  TRANSFORMATION_ACTION,
  USER_CAPS,
  getCombatStatCap,
  getUserCaps,
} from "@/drizzle/constants";
import {
  aiProfile,
  aiTransformation,
  aiSpriteAnimation,
  jutsu,
  spriteAnimation,
  userData,
  userJutsu,
} from "@/drizzle/schema";
import { bossFormsFrom } from "@/libs/combat/bossFight";
import { AiRule } from "@/validators/ai";
import { bossArrivalSchema } from "@/validators/coop";
import { JutsuValidator } from "@/validators/combat";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../setup/testDatabase";

const migration = await readFile(
  new URL("../../drizzle/migrations/0146_seed_creator_trial.sql", import.meta.url),
  "utf8",
);
const statements = migration
  .split(/;\n/)
  .map((statement) => statement.replace(/^(--.*\n)+/gm, "").trim())
  .filter(Boolean);
const IDS = [
  CREATOR_TRIAL_FIRST_FORM,
  "creator-trial-genin",
  "creator-trial-chunin",
  "creator-trial-jonin",
  "creator-trial-elite",
];
const linkFile = await readFile(
  new URL("../../drizzle/migrations/0147_ai_transformations.sql", import.meta.url),
  "utf8",
);
const links = linkFile.slice(linkFile.indexOf("INSERT INTO"));

const seed = async () => {
  for (const statement of statements) await runRawSql(statement);
};

it("seeds with no statement markers", () => {
  expect(migration).not.toContain("--> statement-breakpoint");
});

describeWithDatabase("creator trial seed", () => {
  beforeEach(async () => {
    await resetTables(
      aiProfile,
      aiSpriteAnimation,
      jutsu,
      spriteAnimation,
      userData,
      userJutsu,
    );
    await seed();
  });

  it("creates every form at its rank's cap", async () => {
    const client = await getTestDatabase();
    const forms = await client.query.userData.findMany({
      where: inArray(userData.userId, IDS),
    });
    expect(forms.map((form) => form.userId).sort()).toEqual([...IDS].sort());
    for (const form of forms) {
      const caps = getUserCaps(form.rank);
      expect(form.isAi).toBe(true);
      expect(form.inArena).toBe(false);
      expect(form.level).toBe(USER_CAPS[form.rank].LVL_CAP);
      expect(form.offence).toBe(getCombatStatCap(caps, "offence"));
      expect(form.defence).toBe(getCombatStatCap(caps, "defence"));
      for (const general of ["strength", "intelligence", "willpower", "speed"] as const)
        expect(form[general]).toBe(getCombatStatCap(caps, general));
    }
  });

  it("authors valid jutsu with real art, effects and an owner's sprite", async () => {
    const client = await getTestDatabase();
    const jutsus = await client.query.jutsu.findMany();
    expect(jutsus).toHaveLength(19);
    const owned = await client.query.userJutsu.findMany();
    const bindings = await client.query.aiSpriteAnimation.findMany();
    for (const row of jutsus) {
      expect(JutsuValidator.safeParse({ ...row, hidden: true }).success).toBe(true);
      expect(row.image).toStartWith("https://uploadthing.b-cdn.net/f/");
      expect(row.description).not.toBe("");
      expect(row.battleDescription).toContain("%user");
      for (const effect of row.effects) {
        expect("appearAnimation" in effect && effect.appearAnimation).toBeTruthy();
        expect("appearSfx" in effect && effect.appearSfx).toBeTruthy();
      }
      const owner = owned.find((entry) => entry.jutsuId === row.id);
      expect(owner?.equipped).toBeTruthy();
      expect(
        bindings.some(
          (binding) =>
            binding.userId === owner?.userId && binding.actionKey === `jutsu:${row.id}`,
        ),
      ).toBe(true);
    }
  });

  it("gives each form a valid profile using only its own jutsu", async () => {
    const client = await getTestDatabase();
    const owned = await client.query.userJutsu.findMany();
    for (const profile of await client.query.aiProfile.findMany()) {
      const own = owned
        .filter((row) => row.userId === profile.userId)
        .map((row) => row.jutsuId);
      for (const rule of profile.rules) {
        const { action } = AiRule.parse(rule);
        const used =
          action.type === "use_specific_jutsu"
            ? [action.jutsuId]
            : action.type === "use_combo_action"
              ? action.comboIds
              : [];
        for (const id of used) expect(own).toContain(id);
      }
    }
  });

  it("binds every form's movement, attacks and arrival to registered sheets", async () => {
    const client = await getTestDatabase();
    const bindings = await client.query.aiSpriteAnimation.findMany();
    const sheets = await client.query.spriteAnimation.findMany();
    for (const [index, id] of IDS.entries()) {
      const keys = bindings
        .filter((row) => row.userId === id)
        .map((row) => row.actionKey);
      expect(keys).toEqual(
        expect.arrayContaining(["idle", "move", "basic:basicAttack"]),
      );
      expect(keys.includes(TRANSFORMATION_ACTION)).toBe(index > 0);
    }
    for (const binding of bindings)
      expect(sheets.some((sheet) => sheet.id === binding.animationId)).toBe(true);
    for (const sheet of sheets) {
      expect(sheet.url).toStartWith("https://uploadthing.b-cdn.net/f/");
      expect(sheet.smallUrl).toStartWith("https://uploadthing.b-cdn.net/f/");
      expect(sheet.frameCount).toBeLessThanOrEqual(sheet.columns * sheet.rows);
    }
  });

  it("keeps later staff edits when applied again", async () => {
    const client = await getTestDatabase();
    await client.update(jutsu).set({ description: "Edited by staff" });
    await seed();
    expect((await client.query.jutsu.findFirst())?.description).toBe("Edited by staff");
  });

  it("links every form into one valid boss that escalates to the last", async () => {
    const client = await getTestDatabase();
    await resetTables(aiTransformation);
    await runRawSql(links.trim().replace(/;$/, ""));
    const rows = await client.query.aiTransformation.findMany();
    const forms = bossFormsFrom(CREATOR_TRIAL_FIRST_FORM, rows);
    expect(forms.map((form) => form.aiId)).toEqual(IDS);
    expect(
      forms.slice(1).map((form) => bossArrivalSchema.parse(form.arrival).tier),
    ).toEqual([1, 2, 3, 4]);
  });
});
