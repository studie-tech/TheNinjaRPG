import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { json, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import sharp from "sharp";
import { actionLog, gameAsset, item, itemVariant, userData } from "@/drizzle/schema";
import { lpcSelectionError } from "@/libs/lpc/appearance";
import { buildLpcCatalog, spriteLayerSheets } from "@/libs/lpc/catalog";
import { UPLOADTHING_HOST } from "@/libs/uploadthing";
import { deleteUnreferencedLpcAsset, listLpcAssets } from "@/queries/asset";
import { findLpcDesignForSelection } from "@/queries/lpc";
import { gameAssetRouter } from "@/routers/asset";
import * as ssrf from "@/server/utils/ssrf";
import { gameAssetValidator } from "@/validators/asset";
import type { LpcConfig } from "@/validators/lpcAsset";
import { seedLpcAssets } from "../../drizzle/seeds/lpc";
import { insertItems, insertUsers } from "../setup/factories";
import { rateLimitResponse, stubRateLimitTransport } from "../setup/rateLimit";
import { beforeStatements, failStatements } from "../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
  runRawSql,
} from "../setup/testDatabase";

const migrationAsset = mysqlTable("LpcGameAssetMigrationTest", {
  id: varchar("id", { length: 191 }),
  name: varchar("name", { length: 191 }),
  type: varchar("type", { length: 32 }),
  lpcConfig: json("lpcConfig").$type<LpcConfig>(),
});

describeWithDatabase("LPC GameAsset persistence", () => {
  beforeEach(async () => {
    stubRateLimitTransport();
    await resetTables(itemVariant, item, gameAsset, userData, actionLog);
  });

  afterEach(() => vi.restoreAllMocks());

  it("backfills the complete catalog through the deployment migration and preserves staff edits on rerun", async () => {
    const migration = await readFile(
      new URL("../../drizzle/migrations/0131_lpc_game_assets.sql", import.meta.url),
      "utf8",
    );
    const data = migration
      .slice(migration.indexOf("INSERT INTO"))
      .replaceAll("`GameAsset`", "`LpcGameAssetMigrationTest`");
    const database = await getTestDatabase();
    await runRawSql(
      "CREATE TABLE `LpcGameAssetMigrationTest` LIKE `GameAsset`; ALTER TABLE `LpcGameAssetMigrationTest` DROP COLUMN `lpcConfig`; ALTER TABLE `LpcGameAssetMigrationTest` MODIFY COLUMN `type` enum('STATIC','ANIMATION','SCENE_BACKGROUND','SCENE_CHARACTER','SFX','MUSIC') NOT NULL; INSERT INTO `LpcGameAssetMigrationTest` (`id`,`name`,`type`,`image`,`url`) VALUES ('unrelated','Existing artwork','STATIC','https://example.com/art.png','https://example.com/art.png');",
    );
    try {
      await runRawSql(
        migration.replaceAll("`GameAsset`", "`LpcGameAssetMigrationTest`"),
      );
      const imported = await database.select().from(migrationAsset);
      expect(imported).toHaveLength(64);
      expect(imported.filter((asset) => asset.type === "LPC")).toHaveLength(63);
      expect(
        imported.find((asset) => asset.id === "katana")?.lpcConfig?.variants[
          "male/black/blue"
        ],
      ).toHaveLength(4);
      expect(imported.find((asset) => asset.id === "unrelated")).toMatchObject({
        type: "STATIC",
        name: "Existing artwork",
      });
      await database
        .update(migrationAsset)
        .set({ name: "Staff katana" })
        .where(eq(migrationAsset.id, "katana"));
      await runRawSql(data);
      expect(
        (
          await database
            .select()
            .from(migrationAsset)
            .where(eq(migrationAsset.id, "katana"))
        )[0]?.name,
      ).toBe("Staff katana");
    } finally {
      await runRawSql("DROP TABLE `LpcGameAssetMigrationTest`");
    }
  });

  it("rejects a case-variant design ID even when MySQL finds its canonical row", async () => {
    const database = await getTestDatabase();
    await seedLpcAssets(database);
    const asset = await findLpcDesignForSelection(database, "KATANA");
    expect(asset?.id).toBe("katana");
    expect(lpcSelectionError("KATANA", null, asset)).toContain("existing");
    expect(lpcSelectionError("katana", null, asset)).toBeNull();
  });

  it("syncs all designs idempotently and preserves edited media and attribution", async () => {
    const database = await getTestDatabase();
    expect(await seedLpcAssets(database)).toEqual({
      designs: 63,
      inserted: 63,
      preserved: 0,
    });
    const first = await database.query.gameAsset.findFirst({
      where: eq(gameAsset.id, "katana"),
    });
    expect(first?.lpcConfig?.variants["male/black/blue"]).toHaveLength(4);
    const edited = {
      ...first!.lpcConfig!,
      attributions: [
        {
          authors: ["Staff artist"],
          licenses: ["TNR"],
          chosenLicense: "TNR",
          urls: [],
          notes: "Staff adaptation",
        },
      ],
    };
    await database
      .update(gameAsset)
      .set({ name: "Edited katana", lpcConfig: edited })
      .where(eq(gameAsset.id, "katana"));
    expect(await seedLpcAssets(database)).toEqual({
      designs: 63,
      inserted: 0,
      preserved: 63,
    });
    expect(
      await database.query.gameAsset.findFirst({ where: eq(gameAsset.id, "katana") }),
    ).toMatchObject({ name: "Edited katana", lpcConfig: edited });
    const snapshot = await recordQueries(() => listLpcAssets(database));
    expect(snapshot.statements).toHaveLength(1);
    const catalog = buildLpcCatalog(snapshot.result);
    expect(
      spriteLayerSheets(
        catalog,
        { version: 1, body: "female", layers: [] },
        { profile: "katana", color: "black" },
      ),
    ).toHaveLength(4);
  });

  it("retries a deadlocked seed upsert while preserving every design and staff edits", async () => {
    const database = await getTestDatabase();
    await seedLpcAssets(database);
    const original = (await database.query.gameAsset.findFirst({
      where: eq(gameAsset.id, "beard-stubble"),
    }))!;
    const edited = {
      name: "Staff stubble",
      image: "https://example.com/stubble.png",
      url: "https://example.com/credits",
      lpcConfig: {
        ...original.lpcConfig!,
        attributions: [
          {
            authors: ["Staff artist"],
            licenses: ["TNR"],
            chosenLicense: "TNR",
            urls: [],
            notes: "Staff adaptation",
          },
        ],
      },
    };
    await database.update(gameAsset).set(edited).where(eq(gameAsset.id, original.id));
    const saved = await database.query.gameAsset.findFirst({
      where: eq(gameAsset.id, original.id),
    });
    const deadlocked = beforeStatements(database, gameAsset, [
      async () => {
        throw new Error("Failed query: insert into GameAsset", {
          cause: Object.assign(
            new Error(
              "Deadlock found when trying to get lock; try restarting transaction",
            ),
            { errno: 1213, code: "ER_LOCK_DEADLOCK", sqlState: "40001" },
          ),
        });
      },
    ]);

    const sync = await recordQueries(() => seedLpcAssets(deadlocked));
    expect(sync.result).toEqual({ designs: 63, inserted: 0, preserved: 63 });
    expect(
      sync.statements.filter((statement) =>
        statement.startsWith("insert into `GameAsset`"),
      ),
    ).toHaveLength(63);
    expect(await listLpcAssets(database)).toHaveLength(63);
    expect(
      await database.query.gameAsset.findFirst({
        where: eq(gameAsset.id, original.id),
      }),
    ).toEqual(saved);
  });

  it("propagates non-deadlock seed failures", async () => {
    const database = await getTestDatabase();
    await expect(
      seedLpcAssets(failStatements(database, gameAsset, 10)),
    ).rejects.toThrow("Statement failed on purpose");
    expect(await listLpcAssets(database)).toHaveLength(0);
  });

  it("prevents deletion while an item or variant references the design", async () => {
    const database = await getTestDatabase();
    await seedLpcAssets(database);
    await insertItems([{ id: "lpc-test-item", lpcProfile: "katana" }]);
    expect((await deleteUnreferencedLpcAsset(database, "katana")).rowsAffected).toBe(0);
    await database
      .update(item)
      .set({ lpcProfile: null })
      .where(eq(item.id, "lpc-test-item"));
    await database.insert(itemVariant).values({
      id: "lpc-test-variant",
      itemId: "lpc-test-item",
      name: "Sword variant",
      image: "https://example.com/item.png",
      costType: "MONEY",
      lpcProfile: "katana",
    });
    expect((await deleteUnreferencedLpcAsset(database, "katana")).rowsAffected).toBe(0);
    await database
      .update(itemVariant)
      .set({ lpcProfile: null })
      .where(eq(itemVariant.id, "lpc-test-variant"));
    expect((await deleteUnreferencedLpcAsset(database, "katana")).rowsAffected).toBe(1);
  });

  it("retains active scene snapshots and exposes saved settings to the next load", async () => {
    const database = await getTestDatabase();
    await seedLpcAssets(database);
    await insertUsers([{ userId: "lpc-editor", role: "CODER" }]);
    const caller = callerForDatabase(gameAssetRouter, "lpc-editor", database);
    const before = buildLpcCatalog(await caller.getLpcCatalog());
    expect(await caller.getLpcSceneCatalog()).toEqual(before);
    const saved = await database.query.gameAsset.findFirst({
      where: eq(gameAsset.id, "katana"),
    });
    const config = structuredClone(saved!.lpcConfig!);
    config.replacementSlot = "shirt";
    const result = await caller.update({
      id: "katana",
      data: gameAssetValidator.parse({ ...saved, lpcConfig: config }),
    });
    expect(result.success, result.message).toBe(true);
    expect(before.designs.katana!.replacementSlot).toBe("none");
    // The save replaces this instance's cached scene snapshot.
    expect((await caller.getLpcSceneCatalog()).designs.katana!.replacementSlot).toBe(
      "shirt",
    );
    expect(
      buildLpcCatalog(await caller.getLpcCatalog()).designs.katana!.replacementSlot,
    ).toBe("shirt");
    expect((await caller.delete({ id: "body" })).success).toBe(false);
  });

  it.each(["full", "travel"] as const)(
    "rejects imported settings with incomplete %s pixels before saving or logging",
    async (target) => {
      const database = await getTestDatabase();
      await seedLpcAssets(database);
      await insertUsers([{ userId: "lpc-editor", role: "CODER" }]);
      const caller = callerForDatabase(gameAssetRouter, "lpc-editor", database);
      const saved = (await database.query.gameAsset.findFirst({
        where: eq(gameAsset.id, "shirt"),
      }))!;
      const config = structuredClone(saved.lpcConfig!);
      const image = new URL("/f/lpc-imported.png", UPLOADTHING_HOST).href;
      const bytes = await sharp({
        create: { width: 64, height: 64, channels: 4, background: "red" },
      })
        .png()
        .toBuffer();
      let responseBytes = bytes.subarray(0, 100);
      vi.spyOn(ssrf, "validateUrlForSsrf").mockResolvedValue(true);
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const rateLimit = rateLimitResponse(init);
        if (rateLimit) return rateLimit;
        if (String(input) === image) return new Response(new Uint8Array(responseBytes));
        throw new Error(`Unexpected image request: ${String(input)}`);
      });
      const sheet = config.variants["male/gray/blue"]![0]!;
      const replacement = {
        image,
        z: sheet.z,
        layout: {
          cell: 64 as const,
          columns: 1,
          clips: { stand: [[0], [0], [0], [0]], walk: [[0], [0], [0], [0]] },
        },
      };
      if (target === "full") Object.assign(sheet, replacement);
      else sheet.travel = replacement;

      const result = await caller.update({
        id: saved.id,
        data: gameAssetValidator.parse({
          ...saved,
          name: "Incomplete pixels",
          lpcConfig: config,
        }),
      });

      expect(result.success, result.message).toBe(false);
      expect(result.message).toBeTruthy();
      expect(
        await database.query.gameAsset.findFirst({ where: eq(gameAsset.id, saved.id) }),
      ).toEqual(saved);
      expect(await database.select().from(actionLog)).toHaveLength(0);

      responseBytes = bytes;
      const accepted = await caller.update({
        id: saved.id,
        data: gameAssetValidator.parse({ ...saved, lpcConfig: config }),
      });
      expect(accepted.success, accepted.message).toBe(true);
      expect(
        (
          await database.query.gameAsset.findFirst({
            where: eq(gameAsset.id, saved.id),
          })
        )?.lpcConfig,
      ).toEqual(config);
      expect(await database.select().from(actionLog)).toHaveLength(1);
    },
  );
});
