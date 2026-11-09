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
const kappa = {
  userId: "9zteAgVlXWDTDzxSS4Jxm",
  username: "Kappa Creature",
  isAi: true,
  avatar: "https://utfs.io/f/3308884f-5ccc-4a7a-ad81-cf7f27668b3e-1omb0r.webp",
  avatarFacing: "left",
} as const;
const kappaSource =
  "https://ui0arpl8sm.ufs.sh/f/ai-sprite-20261018-9zteAgVlXWDTDzxSS4Jxm-main-f289124ddeeb.webp";
const idleId = "sprite-20261105-f289124ddeebfa7b8ed1-idle";
const moveId = "sprite-20261105-f289124ddeebfa7b8ed1-move";

it("registers the sheet/binding data migration after table creation without statement markers", () => {
  const migrations = readMigrationFiles({
    migrationsFolder: fileURLToPath(
      new URL("../../drizzle/migrations", import.meta.url),
    ),
  });
  const index = migrations.findIndex(({ sql }) => sql.join("\n").includes(migration));
  expect(index).toBeGreaterThan(0);
  expect(migrations[index - 1]!.sql.join("\n")).toContain(
    "CREATE TABLE `SpriteAnimation`",
  );
  expect(migration).not.toContain("--> statement-breakpoint");
});

describeWithDatabase("delivered sprite animation migration", () => {
  beforeEach(async () => {
    await resetTables(aiSpriteAnimation, spriteAnimation, userData);
  });

  it("loads every published sheet and all qualified roster bindings, preserves drafts, and is repeatable", async () => {
    const db = await getTestDatabase();
    // Exercise the complete captured roster in the migration, including shared artwork aliases.
    const start = migration.indexOf("FROM (\n") + "FROM (\n".length;
    const end = migration.indexOf("\n) AS `expected`");
    const [roster] = (await db.execute(
      sql.raw(
        `SELECT DISTINCT userId, previousAvatar AS avatar, previousFacing AS avatarFacing FROM (${migration.slice(start, end)}) AS roster`,
      ),
    )) as unknown as [
      { userId: string; avatar: string | null; avatarFacing: "left" | "right" }[],
      unknown,
    ];
    expect(roster).toHaveLength(403);
    await insertUsers(
      roster.map((row) => ({ ...row, username: `AI-${row.userId}`, isAi: true })),
    );
    const users = await db.query.userData.findMany({ orderBy: userData.userId });

    await runRawSql(migration);

    const sheets = await db.query.spriteAnimation.findMany({
      orderBy: spriteAnimation.id,
    });
    const bindings = await db.query.aiSpriteAnimation.findMany({
      orderBy: [aiSpriteAnimation.userId, aiSpriteAnimation.actionKey],
    });
    expect(sheets).toHaveLength(950);
    expect(bindings).toHaveLength(638);
    expect(new Set(bindings.map((row) => row.animationId)).size).toBe(570);
    const draftIds = new Set(
      sheets
        .filter((row) => /^\[(Held|Pending)\] /.test(row.name))
        .map((row) => row.id),
    );
    expect(draftIds.size).toBe(380);
    expect(bindings.some((row) => draftIds.has(row.animationId))).toBe(false);
    for (const sheet of sheets) {
      expect(spriteAnimationSchema.safeParse(sheet).success).toBe(true);
      const key = new URL(sheet.url).pathname.split("/").pop()!;
      expect(backfill).toContain(`WHEN '${key}' THEN`);
    }
    expect(await db.query.userData.findMany({ orderBy: userData.userId })).toEqual(
      users,
    );

    await runRawSql(migration);
    expect(
      await db.query.spriteAnimation.findMany({ orderBy: spriteAnimation.id }),
    ).toEqual(sheets);
    expect(
      await db.query.aiSpriteAnimation.findMany({
        orderBy: [aiSpriteAnimation.userId, aiSpriteAnimation.actionKey],
      }),
    ).toEqual(bindings);
  });

  it("preserves existing manual assignments and library metadata", async () => {
    const db = await getTestDatabase();
    await insertUsers([kappa]);
    await runRawSql(migration);
    await db.insert(spriteAnimation).values({
      id: "manual",
      name: "Staff revision",
      url: "https://example.com/manual.webp",
      columns: 2,
      rows: 1,
      frameCount: 2,
      fps: 8,
      facing: "right",
      createdByUserId: "editor",
    });
    await db
      .update(aiSpriteAnimation)
      .set({ animationId: "manual" })
      .where(eq(aiSpriteAnimation.actionKey, "idle"));
    await db
      .update(spriteAnimation)
      .set({ name: "Renamed library entry", fps: 8 })
      .where(eq(spriteAnimation.id, idleId));
    const before = await db.query.aiSpriteAnimation.findMany({
      orderBy: aiSpriteAnimation.actionKey,
    });

    await runRawSql(migration);

    expect(
      await db.query.aiSpriteAnimation.findMany({
        orderBy: aiSpriteAnimation.actionKey,
      }),
    ).toEqual(before);
    expect(
      await db.query.spriteAnimation.findFirst({
        where: eq(spriteAnimation.id, idleId),
      }),
    ).toMatchObject({ name: "Renamed library entry", fps: 8 });
  });

  it.each([
    ["captured portrait", kappa.avatar],
    [
      "equivalent CDN hostname",
      kappa.avatar.replace("utfs.io", "uploadthing.b-cdn.net"),
    ],
    ["accepted source replacement", kappaSource],
    [
      "accepted source on CDN",
      kappaSource.replace("ui0arpl8sm.ufs.sh", "uploadthing.b-cdn.net"),
    ],
  ])("binds an existing AI with its %s even after a rename", async (_name, avatar) => {
    const db = await getTestDatabase();
    await insertUsers([{ ...kappa, username: "Renamed AI", avatar }]);
    await runRawSql(migration);
    expect(
      await db.query.aiSpriteAnimation.findMany({
        orderBy: aiSpriteAnimation.actionKey,
      }),
    ).toEqual([
      { userId: kappa.userId, actionKey: "idle", animationId: idleId },
      { userId: kappa.userId, actionKey: "move", animationId: moveId },
    ]);
  });

  it.each([
    ["new artwork", { avatar: "https://example.com/new-character.webp" }],
    [
      "different immutable key case",
      {
        avatar: kappaSource
          .toUpperCase()
          .replace("HTTPS://UI0ARPL8SM.UFS.SH", "https://ui0arpl8sm.ufs.sh"),
      },
    ],
    ["edited facing", { avatarFacing: "right" }],
    ["a player using the captured ID", { isAi: false }],
  ] satisfies [string, Partial<typeof userData.$inferInsert>][])(
    "does not bind %s",
    async (_name, patch) => {
      const db = await getTestDatabase();
      await insertUsers([{ ...kappa, ...patch }]);
      await runRawSql(migration);
      expect(await db.query.aiSpriteAnimation.findMany()).toEqual([]);
    },
  );

  it("does not recreate deleted AIs or bind changed playback metadata", async () => {
    const db = await getTestDatabase();
    await runRawSql(migration);
    expect(await db.query.userData.findMany()).toEqual([]);
    expect(await db.query.aiSpriteAnimation.findMany()).toEqual([]);
    await db
      .update(spriteAnimation)
      .set({ fps: 8 })
      .where(eq(spriteAnimation.id, idleId));
    await insertUsers([kappa]);
    await runRawSql(migration);
    expect(await db.query.aiSpriteAnimation.findMany()).toEqual([
      { userId: kappa.userId, actionKey: "move", animationId: moveId },
    ]);
  });
});
