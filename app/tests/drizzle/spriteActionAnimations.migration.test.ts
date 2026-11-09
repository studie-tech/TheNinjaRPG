import { beforeEach, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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
    "../../drizzle/migrations/0144_seed_ai_action_animations.sql",
    import.meta.url,
  ),
  "utf8",
);
const smallSheetBackfill = await readFile(
  new URL(
    "../../drizzle/migrations/0143_backfill_sprite_small_urls.sql",
    import.meta.url,
  ),
  "utf8",
);
const expectedRows = [
  ...migration.matchAll(/FROM \(\n([\s\S]*?)\n\) AS `expected`/g),
].map((match) => match[1]!);
type Roster = {
  userId: string;
  actionKey: string;
  avatar: string;
  avatarFacing: "left" | "right";
};

const loadRoster = async () => {
  const db = await getTestDatabase();
  const batches = await Promise.all(
    expectedRows.map(
      (rows) =>
        db.execute(
          sql.raw(
            `SELECT userId, actionKey, avatar, avatarFacing FROM (${rows}) AS roster`,
          ),
        ) as unknown as Promise<[Roster[]]>,
    ),
  );
  return batches.flatMap(([rows]) => rows);
};

it("registers after the small sheet backfill without statement markers", () => {
  const migrations = readMigrationFiles({
    migrationsFolder: fileURLToPath(
      new URL("../../drizzle/migrations", import.meta.url),
    ),
  });
  const index = migrations.findIndex(({ sql }) => sql.join("\n").includes(migration));
  const backfill = migrations.findIndex(({ sql }) =>
    sql.join("\n").includes(smallSheetBackfill),
  );
  expect(backfill).toBeGreaterThan(-1);
  expect(index).toBe(backfill + 1);
  expect(migration).not.toContain("--> statement-breakpoint");
});

describeWithDatabase("AI action animation migration", () => {
  beforeEach(async () => {
    await resetTables(aiSpriteAnimation, spriteAnimation, userData);
  });

  it("binds every captured action to a prepared sheet and is repeatable", async () => {
    const db = await getTestDatabase();
    const expected = await loadRoster();
    const users = new Map(expected.map((row) => [row.userId, row]));
    await insertUsers(
      [...users.values()].map(({ userId, avatar, avatarFacing }) => ({
        userId,
        avatar,
        avatarFacing,
        username: `AI-${userId}`,
        isAi: true,
      })),
    );

    await runRawSql(migration);

    const sheets = await db.query.spriteAnimation.findMany({
      orderBy: spriteAnimation.id,
    });
    const bindings = await db.query.aiSpriteAnimation.findMany({
      orderBy: [aiSpriteAnimation.userId, aiSpriteAnimation.actionKey],
    });
    expect(sheets).toHaveLength(1842);
    expect(bindings).toHaveLength(4599);
    expect(new Set(bindings.map((row) => row.userId)).size).toBe(660);
    for (const sheet of sheets) {
      expect(spriteAnimationSchema.safeParse(sheet).success).toBe(true);
      expect(sheet.smallUrl).toStartWith("https://uploadthing.b-cdn.net/f/");
      expect(sheet.smallUrl).not.toBe(sheet.url);
      expect(sheet.frameCount).toBe(16);
    }
    for (const { actionKey } of bindings) {
      expect(actionKey).toMatch(/^(basic|jutsu|item):.+/);
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
    const roster = await loadRoster();
    const manual = roster[0]!;
    const changed = roster.find((row) => row.userId !== manual.userId)!;
    await insertUsers([
      { ...manual, username: "Manual", isAi: true },
      {
        userId: changed.userId,
        username: "Redrawn",
        isAi: true,
        avatar: "https://ui0arpl8sm.ufs.sh/f/redrawn.webp",
        avatarFacing: changed.avatarFacing,
      },
    ]);
    await db.insert(spriteAnimation).values({
      id: "manual-sheet",
      name: "Manual sheet",
      url: "https://uploadthing.b-cdn.net/f/manual.webp",
      columns: 8,
      rows: 2,
      frameCount: 16,
      fps: 12.5,
      facing: "left",
      createdByUserId: "staff",
    });
    await db.insert(aiSpriteAnimation).values({
      userId: manual.userId,
      actionKey: manual.actionKey,
      animationId: "manual-sheet",
    });

    await runRawSql(migration);

    const rows = await db.query.aiSpriteAnimation.findMany({
      where: eq(aiSpriteAnimation.userId, manual.userId),
    });
    expect(rows.find((row) => row.actionKey === manual.actionKey)?.animationId).toBe(
      "manual-sheet",
    );
    expect(
      await db.query.aiSpriteAnimation.findMany({
        where: eq(aiSpriteAnimation.userId, changed.userId),
      }),
    ).toHaveLength(0);
  });
});
