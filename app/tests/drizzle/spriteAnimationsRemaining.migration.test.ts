import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeEach, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { aiSpriteAnimation, spriteAnimation, userData } from "@/drizzle/schema";
import { spriteAnimationSchema } from "@/validators/spriteAnimation";
import { insertUsers } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../setup/testDatabase";

const migration = await readFile(
  new URL(
    "../../drizzle/migrations/0141_seed_remaining_sprite_animations.sql",
    import.meta.url,
  ),
  "utf8",
);
const previous = await readFile(
  new URL("../../drizzle/migrations/0138_seed_sprite_animations.sql", import.meta.url),
  "utf8",
);
const backfill = await readFile(
  new URL(
    "../../drizzle/migrations/0143_backfill_sprite_small_urls.sql",
    import.meta.url,
  ),
  "utf8",
);
const start = migration.indexOf("FROM (\n") + "FROM (\n".length;
const expected = migration.slice(start, migration.indexOf("\n) AS `expected`"));

it("registers after the first sprite seed without statement markers", () => {
  const migrations = readMigrationFiles({
    migrationsFolder: fileURLToPath(
      new URL("../../drizzle/migrations", import.meta.url),
    ),
  });
  const index = migrations.findIndex(({ sql }) => sql.join("\n").includes(migration));
  expect(index).toBeGreaterThan(0);
  const earlier = migrations.findIndex(({ sql }) => sql.join("\n").includes(previous));
  expect(earlier).toBeGreaterThanOrEqual(0);
  expect(earlier).toBeLessThan(index);
  expect(migration).not.toContain("--> statement-breakpoint");
});

describeWithDatabase("remaining sprite animation migration", () => {
  beforeEach(async () => {
    await resetTables(aiSpriteAnimation, spriteAnimation, userData);
  });

  it("binds every captured AI, links existing sheets, and is repeatable", async () => {
    const db = await getTestDatabase();
    await runRawSql(previous);
    const [roster] = (await db.execute(
      sql.raw(
        `SELECT DISTINCT userId, avatar, avatarFacing FROM (${expected}) AS roster`,
      ),
    )) as unknown as [
      { userId: string; avatar: string; avatarFacing: "left" | "right" }[],
    ];
    await insertUsers(
      roster.map((row) => ({ ...row, username: `AI-${row.userId}`, isAi: true })),
    );

    await runRawSql(migration);
    await runRawSql(backfill);

    const sheets = await db.query.spriteAnimation.findMany({
      orderBy: spriteAnimation.id,
    });
    for (const sheet of sheets) {
      expect(sheet.smallUrl).toStartWith("https://uploadthing.b-cdn.net/f/");
      expect(sheet.smallUrl).not.toBe(sheet.url);
    }
    const bindings = await db.query.aiSpriteAnimation.findMany({
      orderBy: [aiSpriteAnimation.userId, aiSpriteAnimation.actionKey],
    });
    expect(sheets).toHaveLength(1466);
    expect(bindings).toHaveLength(682);
    expect(new Set(bindings.map((row) => row.userId)).size).toBe(425);
    for (const sheet of sheets) {
      expect(spriteAnimationSchema.safeParse(sheet).success).toBe(true);
    }

    await runRawSql(migration);
    expect(
      await db.query.aiSpriteAnimation.findMany({
        orderBy: [aiSpriteAnimation.userId, aiSpriteAnimation.actionKey],
      }),
    ).toEqual(bindings);
  });

  it("leaves manual bindings and changed artwork alone", async () => {
    const db = await getTestDatabase();
    await runRawSql(previous);
    const [roster] = (await db.execute(
      sql.raw(
        `SELECT userId, actionKey, avatar, avatarFacing FROM (${expected}) AS roster LIMIT 2`,
      ),
    )) as unknown as [
      {
        userId: string;
        actionKey: string;
        avatar: string;
        avatarFacing: "left" | "right";
      }[],
    ];
    const [manual, changed] = roster;
    await insertUsers([
      {
        userId: manual!.userId,
        username: "Manual",
        isAi: true,
        avatar: manual!.avatar,
        avatarFacing: manual!.avatarFacing,
      },
      {
        userId: changed!.userId,
        username: "Redrawn",
        isAi: true,
        avatar: "https://ui0arpl8sm.ufs.sh/f/redrawn.webp",
        avatarFacing: changed!.avatarFacing,
      },
    ]);
    const [draft] = await db.query.spriteAnimation.findMany({ limit: 1 });
    await db.insert(aiSpriteAnimation).values({
      userId: manual!.userId,
      actionKey: manual!.actionKey,
      animationId: draft!.id,
    });

    await runRawSql(migration);

    const rows = await db.query.aiSpriteAnimation.findMany({
      where: eq(aiSpriteAnimation.userId, manual!.userId),
    });
    expect(rows.find((row) => row.actionKey === manual!.actionKey)?.animationId).toBe(
      draft!.id,
    );
    expect(
      await db.query.aiSpriteAnimation.findMany({
        where: eq(aiSpriteAnimation.userId, changed!.userId),
      }),
    ).toHaveLength(0);
  });
});
