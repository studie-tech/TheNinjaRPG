import { describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/mysql-proxy";
import {
  insertGameAssetForCreate,
  selectGameAssetForGetAll,
  selectGameAssetForGetAllFolders,
} from "@/queries/asset";
import type { DrizzleClient } from "@/server/db";

// Compile real Drizzle statements without connecting to a database.
const client = drizzle(async () => ({ rows: [] })) as unknown as DrizzleClient;

/** Compile our filter and pagination choices without executing database statements. */
const listing = (input: Parameters<typeof selectGameAssetForGetAll>[1]) =>
  selectGameAssetForGetAll(client, input, 49, 48).toSQL();

describe("asset library queries", () => {
  it("counts complete folders for the selected media type without pagination", () => {
    const query = selectGameAssetForGetAllFolders(client, {
      type: "SCENE_BACKGROUND",
    }).toSQL();
    expect(query.sql).toContain("count(*)");
    expect(query.sql).toContain("`GameAsset`.`type` = ?");
    expect(query.sql).toContain("group by `GameAsset`.`folder`");
    expect(query.sql).not.toContain("limit");
    expect(query.params).toEqual(["SCENE_BACKGROUND"]);
    expect(selectGameAssetForGetAllFolders(client).toSQL().params).toEqual([]);
  });
  it("includes every media type in the unified library while preserving picker defaults", () => {
    expect(listing({}).params).toContain("ANIMATION");
    expect(listing({ includeAnimations: true }).params).not.toContain("ANIMATION");
    expect(listing({ type: "ANIMATION", includeAnimations: true }).sql).toContain(
      "`GameAsset`.`type` = ?",
    );
  });

  it("matches the chosen folder exactly, including the empty Unfiled folder", () => {
    for (const folder of ["Forest", ""]) {
      const query = listing({ includeAnimations: true, exactFolder: folder });
      expect(query.sql).toContain("`GameAsset`.`folder` = ?");
      expect(query.sql).not.toContain("like");
      expect(query.params).toContain(folder);
    }
    expect(listing({ includeAnimations: true }).sql).not.toContain("where");
  });

  it("combines name search with type, folder and all selected name keywords", () => {
    const query = listing({
      name: "fire",
      type: "ANIMATION",
      exactFolder: "Combat",
      nameTokens: ["red", "burst"],
    });
    expect(query.params).toEqual([
      "%fire%",
      "ANIMATION",
      "%red%",
      "%burst%",
      "Combat",
      49,
      48,
    ]);
    expect(query.sql).toContain(" and ");
  });

  it.each([
    ["newest", "`GameAsset`.`createdAt` desc"],
    ["oldest", "`GameAsset`.`createdAt` asc"],
    ["name-asc", "`GameAsset`.`name` asc"],
    ["name-desc", "`GameAsset`.`name` desc"],
  ] as const)(
    "sorts %s before applying pagination with a stable tie breaker",
    (sort, order) => {
      const query = listing({ sort });
      expect(query.sql).toContain(
        `order by ${order}, \`GameAsset\`.\`id\` asc limit ? offset ?`,
      );
    },
  );

  it("filters assigned content tags without duplicating matching assets", () => {
    const query = listing({ includeAnimations: true, tags: ["Fire", "Water"] });
    expect(query.sql).toContain("exists (select");
    expect(query.sql).toContain("`GameAssetTag`.`assetId` = `GameAsset`.`id`");
    expect(query.sql).toContain("`ContentTag`.`name` in (?, ?)");
    expect(query.sql).not.toContain("group by");
    expect(query.params).toEqual(["Fire", "Water", 49, 48]);
    expect(listing({ tags: [] }).sql).toContain("false");
  });

  it("creates an asset with the chosen name, media type and folder", () => {
    const query = insertGameAssetForCreate(
      client,
      "asset-id",
      { userId: "creator" },
      { name: "Forest rain", type: "SFX", folder: "Weather" },
    ).toSQL();
    for (const value of ["asset-id", "Forest rain", "SFX", "Weather", "creator"])
      expect(query.params).toContain(value);
    expect(query.params).not.toContain("Placeholder");
  });
});
