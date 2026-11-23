import { beforeEach, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { gameAsset, item, itemVariant } from "@/drizzle/schema";
import { resolveItemSprite } from "@/libs/lpc/appearance";
import { spriteLayerSheets } from "@/libs/lpc/catalog";
import { lpcConfigValidator } from "@/validators/lpcAsset";
import { insertItems } from "../setup/factories";
import { lpcAssets, lpcCatalog } from "../setup/lpc";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../setup/testDatabase";

const migration = await readFile(
  new URL("../../drizzle/migrations/0193_low_warstar.sql", import.meta.url),
  "utf8",
);
// The schema fixture already has the new columns; execute every deployment data statement unchanged.
const data = migration.slice(migration.indexOf("UPDATE `GameAsset`"));
const publication = await readFile(
  new URL("../../drizzle/migrations/0131_lpc_game_assets.sql", import.meta.url),
  "utf8",
);
const katana = {
  id: "ZSUdrzzgorepP4CQrBfEk",
  name: "Skyglass Katana",
  image: "https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJeCMeCnKyV3OvUJQExAi0bGoIZDF74LqSnHRd",
  lpcProfile: null,
  lpcColor: null,
  updatedAt: new Date("2026-11-21T22:10:37.795Z"),
};
const carapace = {
  id: "6g-leb_pyJJlDjY1i-gz3",
  name: "Kaeruun’s Ember Carapace",
  image: "https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJRcSZWQo0udmODoNtpa0FMcwI4k2Eq7nJhyvj",
  lpcProfile: "NONE",
  lpcColor: "gold",
  updatedAt: new Date("2026-11-15T20:10:36.093Z"),
};
const scythe = {
  id: "DmhRWpw13MbjnTPs4s12h",
  itemId: "ttwbJ6ZA5Id-OuBludM27",
  name: "Headless Rider's Scythe",
  image: "https://ui0arpl8sm.ufs.sh/f/content-O2-K67OUhcyO-M9WZDMDq.webp",
  lpcProfile: null,
  lpcColor: null,
  updatedAt: new Date("2026-11-04T02:23:54.880Z"),
};

describeWithDatabase("adult LPC customization migration", () => {
  beforeEach(async () => {
    await resetTables(itemVariant, item, gameAsset);
    await runRawSql(publication.slice(publication.indexOf("INSERT INTO")));
    await insertItems([
      katana,
      carapace,
      { id: scythe.itemId, name: "Oathbinder", lpcProfile: "whip", lpcColor: "black" },
    ]);
    await (await getTestDatabase())
      .insert(itemVariant)
      .values({ ...scythe, costType: "MONEY" });
  });

  it("keeps a hat variant's metal palette independent of its horned hood's gold trim", async () => {
    const database = await getTestDatabase();
    await insertItems([
      {
        id: "sJXl6M3oneQBi0JErDwPQ",
        name: "Kaeruun’s Horned Veil",
        image:
          "https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJD2Y5PvzEwoh0WXMnscL279N8ayVQUCbRzS3p",
        lpcProfile: "NONE",
        lpcColor: "gold",
        updatedAt: new Date("2026-11-15T20:12:12.901Z"),
      },
    ]);
    await database.insert(itemVariant).values({
      id: "UnmxbW-PR5Q8SSbVCNRjF",
      itemId: "sJXl6M3oneQBi0JErDwPQ",
      name: "Hyorin Kage Hat",
      image: "https://uploadthing.b-cdn.net/f/NHlmecyvXfnHbA_tsalSn.png",
      lpcProfile: "wide-hat",
      lpcColor: "blue",
      costType: "MONEY",
      updatedAt: new Date("2026-10-30T14:48:25.938Z"),
    });
    await runRawSql(data);
    const parent = (await database.query.item.findFirst({
      where: eq(item.id, "sJXl6M3oneQBi0JErDwPQ"),
    }))!;
    const variant = await database.query.itemVariant.findFirst({
      where: eq(itemVariant.id, "UnmxbW-PR5Q8SSbVCNRjF"),
    });
    expect(parent.lpcMaterialColors).toEqual({ metal: "gold" });
    const visual = resolveItemSprite(parent, variant);
    expect(visual).toEqual({
      profile: "wide-hat",
      color: "white",
      materialColors: { metal: "white" },
    });
    for (const body of ["male", "female"] as const)
      expect(
        spriteLayerSheets(lpcCatalog, { version: 1, body, layers: [] }, visual),
      ).toEqual(lpcCatalog.entries[`wide-hat/${body}/white/blue`]!);
  });

  it("upgrades published designs, composes multi-garment recipes and applies audited appearances idempotently", async () => {
    const database = await getTestDatabase();
    const before = await database.query.item.findMany({ orderBy: item.id });
    const beforeVariant = (await database.query.itemVariant.findFirst())!;
    await runRawSql(data);
    const artwork = await database.query.gameAsset.findMany();
    expect(artwork).toHaveLength(lpcAssets.length);
    for (const asset of artwork)
      expect(lpcConfigValidator.safeParse(asset.lpcConfig).success, asset.id).toBe(
        true,
      );
    expect(
      artwork.find((asset) => asset.id === "outfit-shinobi")?.lpcConfig
        ?.replacementSlots,
    ).toEqual(["shirt", "legs", "feet"]);
    expect(
      artwork
        .find((asset) => asset.id === "leather")
        ?.lpcConfig?.variants["female/brown/blue"]?.some(
          (sheet) => sheet.material === "metal",
        ),
    ).toBe(true);
    const after = await database.query.item.findMany({ orderBy: item.id });
    for (const row of before) {
      const visual =
        row.id === katana.id
          ? { lpcProfile: "katana", lpcColor: "blue" }
          : row.id === carapace.id
            ? {
                lpcProfile: "leather",
                lpcColor: "brown",
                lpcMaterialColors: { metal: "gold" },
              }
            : {};
      expect(after.find((saved) => saved.id === row.id)).toEqual({ ...row, ...visual });
    }
    const afterVariant = await database.query.itemVariant.findFirst();
    expect(afterVariant).toEqual({
      ...beforeVariant,
      lpcProfile: "sickle",
      lpcColor: "black",
    });
    await runRawSql(data);
    expect(await database.query.item.findMany({ orderBy: item.id })).toEqual(after);
    expect(await database.query.itemVariant.findFirst()).toEqual(afterVariant);
    expect(await database.query.gameAsset.findMany()).toEqual(artwork);
  });

  it("preserves staff edits, new-ID collisions and records whose content revision changed", async () => {
    const database = await getTestDatabase();
    await database.update(item).set({ lpcColor: "red" }).where(eq(item.id, katana.id));
    await database
      .update(item)
      .set({ updatedAt: new Date("2026-11-22T00:00:00Z") })
      .where(eq(item.id, carapace.id));
    await database
      .update(itemVariant)
      .set({ image: "https://example.com/staff-scythe.png" })
      .where(eq(itemVariant.id, scythe.id));
    await database
      .update(gameAsset)
      .set({ licenseDetails: "Staff attribution" })
      .where(eq(gameAsset.id, "shirt"));
    await database.insert(gameAsset).values({
      id: "hair-bob",
      type: "STATIC",
      name: "Staff image",
      image: "https://example.com/art.png",
      url: "https://example.com/art.png",
    });
    const before = await database.query.item.findMany({ orderBy: item.id });
    const beforeVariant = await database.query.itemVariant.findFirst();
    await runRawSql(data);
    expect(await database.query.item.findMany({ orderBy: item.id })).toEqual(before);
    expect(await database.query.itemVariant.findFirst()).toEqual(beforeVariant);
    const shirt = await database.query.gameAsset.findFirst({
      where: eq(gameAsset.id, "shirt"),
    });
    expect(shirt?.licenseDetails).toBe("Staff attribution");
    expect(shirt?.lpcConfig?.version).toBe(2);
    expect(shirt?.lpcConfig?.variants["male/gray/blue"]?.[0]?.material).toBeUndefined();
    expect(
      await database.query.gameAsset.findFirst({ where: eq(gameAsset.id, "hair-bob") }),
    ).toMatchObject({ type: "STATIC", name: "Staff image" });
  });
});
