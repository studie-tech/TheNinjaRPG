import { beforeEach, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { asc, eq } from "drizzle-orm";
import { aiProfile, jutsuLoadout, userData } from "@/drizzle/schema";
import { ActionEndTurn, AiRule, getBackupRules } from "@/validators/ai";
import { insertUsers } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../setup/testDatabase";

const migrations = new URL("../../drizzle/migrations/", import.meta.url);
/** The migration that gives jutsu loadouts their own AI rules, found by its schema change. */
const migration = (
  await Promise.all(
    (
      await readdir(migrations)
    )
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFile(new URL(name, migrations), "utf8")),
  )
).find((sql) => sql.includes("ADD `jutsuLoadoutId`")) as string;

/** The data statements; the test database already has the migration's columns. */
const backfill = migration.slice(migration.indexOf("-- The fills below"));

const rules = (note: string) => [
  AiRule.parse({
    conditions: [],
    action: ActionEndTurn.parse({}),
    group: { id: note, name: note, note: "" },
  }),
  ...getBackupRules(),
];

const loadout = (id: string, userId: string, createdAt: string) => ({
  id,
  userId,
  jutsuIds: [],
  createdAt: new Date(createdAt),
});

describeWithDatabase("AI profiles per jutsu loadout migration", () => {
  beforeEach(async () => {
    await resetTables(aiProfile, jutsuLoadout, userData);
    await insertUsers([
      // Fights with custom rules on its active loadout, and owns a second loadout.
      {
        userId: "custom",
        username: "custom",
        aiProfileId: "p-custom",
        jutsuLoadout: "c1",
      },
      // Owns custom rules but fights with the Default profile.
      { userId: "default", username: "default", jutsuLoadout: "d1" },
      // Points at the Default profile by name.
      {
        userId: "named",
        username: "named",
        aiProfileId: "Default",
        jutsuLoadout: "n1",
      },
      // Custom rules, loadouts, but no active loadout pointer yet.
      { userId: "unpointed", username: "unpointed", aiProfileId: "p-unpointed" },
      // Custom rules and no loadouts at all.
      { userId: "bare", username: "bare", aiProfileId: "p-bare" },
      // A staff AI keeps its single profile.
      { userId: "ai", username: "ai", isAi: true, aiProfileId: "p-ai" },
    ]);
    const db = await getTestDatabase();
    await db
      .insert(jutsuLoadout)
      .values([
        loadout("c1", "custom", "2026-01-02"),
        loadout("c2", "custom", "2026-01-01"),
        loadout("d1", "default", "2026-01-01"),
        loadout("d2", "default", "2026-01-02"),
        loadout("n1", "named", "2026-01-01"),
        loadout("u2", "unpointed", "2026-01-02"),
        loadout("u1", "unpointed", "2026-01-01"),
      ]);
    await db.insert(aiProfile).values([
      { id: "Default", userId: "staff", rules: rules("default") },
      { id: "p-custom", userId: "custom", rules: rules("custom") },
      { id: "p-default", userId: "default", rules: rules("kept") },
      { id: "p-unpointed", userId: "unpointed", rules: rules("unpointed") },
      { id: "p-bare", userId: "bare", rules: rules("bare") },
      { id: "p-ai", userId: "ai", rules: rules("ai"), includeDefaultRules: false },
    ]);
  });

  it("points players at their active loadout's rules after the previous build switched loadouts", async () => {
    await runRawSql(backfill);
    const db = await getTestDatabase();
    // The previous build switches loadouts, or turns custom rules off, without the rules pointer.
    await db
      .update(userData)
      .set({ jutsuLoadout: "c2" })
      .where(eq(userData.userId, "custom"));
    await db
      .update(userData)
      .set({ jutsuLoadout: "u2", aiProfileId: null })
      .where(eq(userData.userId, "unpointed"));
    await runRawSql(backfill);
    const pointers = Object.fromEntries(
      (
        await db
          .select({ userId: userData.userId, aiProfileId: userData.aiProfileId })
          .from(userData)
      ).map((row) => [row.userId, row.aiProfileId]),
    );
    expect(pointers).toMatchObject({ custom: "p-custom-c2", unpointed: null });
    const u2 = await db.query.jutsuLoadout.findFirst({
      where: eq(jutsuLoadout.id, "u2"),
    });
    expect(u2?.customAi).toBe(false);
  });

  it("leaves the rules players chose per loadout alone when it runs again", async () => {
    await runRawSql(backfill);
    const db = await getTestDatabase();
    // After the release, one player sets a loadout to Default, another writes rules for one.
    await db
      .update(jutsuLoadout)
      .set({ customAi: false })
      .where(eq(jutsuLoadout.id, "c2"));
    await db.insert(aiProfile).values({
      id: "p-new-d2",
      userId: "default",
      jutsuLoadoutId: "d2",
      rules: rules("new"),
    });
    await db
      .update(jutsuLoadout)
      .set({ customAi: true })
      .where(eq(jutsuLoadout.id, "d2"));
    await db
      .update(userData)
      .set({ jutsuLoadout: "d2", aiProfileId: "p-new-d2" })
      .where(eq(userData.userId, "default"));
    await runRawSql(backfill);
    const flags = Object.fromEntries(
      (
        await db
          .select({ id: jutsuLoadout.id, customAi: jutsuLoadout.customAi })
          .from(jutsuLoadout)
      ).map((row) => [row.id, row.customAi]),
    );
    expect(flags).toMatchObject({ c1: true, c2: false, d1: false, d2: true });
    const copies = await db
      .select({ id: aiProfile.id })
      .from(aiProfile)
      .where(eq(aiProfile.userId, "default"));
    expect(copies.map((row) => row.id).sort()).toEqual(["p-default", "p-new-d2"]);
  });

  it("gives every loadout the rules its player fights with, and runs again safely", async () => {
    // A second run touches only rows still unlinked, such as ones the previous build created.
    await runRawSql(backfill);
    await runRawSql(backfill);
    const db = await getTestDatabase();
    const profiles = await db
      .select({
        id: aiProfile.id,
        userId: aiProfile.userId,
        jutsuLoadoutId: aiProfile.jutsuLoadoutId,
        rules: aiProfile.rules,
        includeDefaultRules: aiProfile.includeDefaultRules,
      })
      .from(aiProfile)
      .orderBy(asc(aiProfile.id));
    expect(
      profiles.map(({ id, userId, jutsuLoadoutId, rules }) => [
        id,
        userId,
        jutsuLoadoutId,
        rules[0]?.group?.name,
      ]),
    ).toEqual([
      ["Default", "staff", null, "default"],
      ["p-ai", "ai", null, "ai"],
      ["p-bare", "bare", null, "bare"],
      ["p-custom", "custom", "c1", "custom"],
      ["p-custom-c2", "custom", "c2", "custom"],
      ["p-default", "default", "d1", "kept"],
      ["p-unpointed", "unpointed", "u1", "unpointed"],
      ["p-unpointed-u2", "unpointed", "u2", "unpointed"],
    ]);
    expect(profiles.find((p) => p.id === "p-custom-c2")?.rules).toEqual(
      profiles.find((p) => p.id === "p-custom")?.rules,
    );
    const loadouts = await db
      .select({ id: jutsuLoadout.id, customAi: jutsuLoadout.customAi })
      .from(jutsuLoadout)
      .orderBy(asc(jutsuLoadout.id));
    expect(loadouts).toEqual([
      { id: "c1", customAi: true },
      { id: "c2", customAi: true },
      { id: "d1", customAi: false },
      { id: "d2", customAi: false },
      { id: "n1", customAi: false },
      { id: "u1", customAi: true },
      { id: "u2", customAi: true },
    ]);
    const users = await db
      .select({ userId: userData.userId, aiProfileId: userData.aiProfileId })
      .from(userData)
      .orderBy(asc(userData.userId));
    expect(users).toEqual([
      { userId: "ai", aiProfileId: "p-ai" },
      { userId: "bare", aiProfileId: "p-bare" },
      { userId: "custom", aiProfileId: "p-custom" },
      { userId: "default", aiProfileId: null },
      { userId: "named", aiProfileId: null },
      { userId: "unpointed", aiProfileId: "p-unpointed" },
    ]);
  });
});
