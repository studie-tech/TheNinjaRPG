import { beforeEach, expect, it } from "bun:test";
import { and, eq, like } from "drizzle-orm";
import { KESSEN_CARD_SELL_VALUES } from "@/drizzle/constants";
import { item } from "@/drizzle/schema";
import { calcItemSellingPrice, isUnsellableCard } from "@/libs/item";
import { itemToKessenCard } from "@/libs/kessen/catalog";
import { KESSEN_PACK_IDS } from "@/libs/kessen/packs";
import { kessenGoodsCondition } from "@/queries/item";
import { KESSEN_PACKS } from "@/server/utils/kessenPacks";
import { isBunnyCdnUrl } from "@/utils/image";
import { ItemValidator } from "@/validators/combat";
import { cardDataSchema } from "@/validators/itemCard";
import { weightedCacheSchema } from "@/validators/weightedCache";
import { KESSEN_SEED_CATALOG } from "../libs/kessen/fixtures/catalog";
import { readMigration } from "../setup/migrations";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../setup/testDatabase";

// The branch's one migration creates the Kessen tables, then seeds the cards and packs; the
// seed tests run its seed section against tables the test database already has, then the
// migration that turns the seeded summon groups into card sets.
const MIGRATION = "0190_wakeful_dreadnoughts.sql";
const SEED_START = "-- Kessen cards";
const SETS_MIGRATION = "0195_kessen_card_sets.sql";

const sellPrice = (row: typeof item.$inferSelect, quantity: number) =>
  calcItemSellingPrice(
    {} as Parameters<typeof calcItemSellingPrice>[0],
    { quantity, item: row } as Parameters<typeof calcItemSellingPrice>[1],
    [],
  );
const file = await readMigration(MIGRATION);
const migration = file.slice(file.indexOf(SEED_START));
const setsMigration = await readMigration(SETS_MIGRATION);

it("seeds every catalog card and pack", () => {
  for (const id of [...KESSEN_SEED_CATALOG, ...KESSEN_PACKS].map((entry) => entry.id)) {
    expect(migration).toContain(`('${id}', `);
  }
});

it("serves every image from the media CDN", () => {
  const urls = migration.match(/https:\/\/[^'"\\\s]+/g) ?? [];
  expect(urls.length).toBeGreaterThan(KESSEN_SEED_CATALOG.length);
  expect(urls.filter((url) => !isBunnyCdnUrl(url))).toEqual([]);
});

/** UTF-8 text decoded as Latin-1 or Windows-1252 ("â€”" for an em dash), or lost bytes. */
const MOJIBAKE = /â€|Ã[\u0080-\u00ff]|Â[\u0080-\u00ff]|\ufffd/;

it("writes names and descriptions as clean UTF-8", () => {
  expect(migration).not.toMatch(MOJIBAKE);
  // Forbidden names carry a real em dash.
  expect(migration).toContain("Raizhen — Ten Calamities");
});

describeWithDatabase("Kessen seed migration", () => {
  beforeEach(async () => {
    await resetTables(item);
    await runRawSql(migration);
    await runRawSql(setsMigration);
  });

  const seededRows = async () => {
    const client = await getTestDatabase();
    return client.select().from(item).where(like(item.id, "kessen-%"));
  };

  it("stores names and descriptions without mojibake", async () => {
    const rows = await seededRows();
    expect(rows.length).toBeGreaterThan(KESSEN_SEED_CATALOG.length);
    const garbled = rows.filter(
      (row) => MOJIBAKE.test(row.name) || MOJIBAKE.test(row.description),
    );
    expect(garbled.map((row) => row.id)).toEqual([]);
    const forbidden = rows.filter(
      (row) => cardDataSchema.safeParse(row.cardData).data?.variant === "FORBIDDEN",
    );
    expect(forbidden.length).toBeGreaterThan(0);
    for (const row of forbidden) expect(row.name).toContain(" — ");
  });

  it("stores cards the engine, the item editor and the sell flow accept", async () => {
    const rows = await seededRows();
    const cards = rows.filter((row) => row.itemType === "CARD");
    expect(cards.map((row) => row.id).sort()).toEqual(
      KESSEN_SEED_CATALOG.map((card) => card.id).sort(),
    );
    for (const row of cards) {
      const seed = KESSEN_SEED_CATALOG.find((card) => card.id === row.id);
      if (!seed) throw new Error(`${row.id} is not a seed card`);
      const data = cardDataSchema.parse(row.cardData);
      const card = itemToKessenCard(row);
      expect(card).toEqual(seed);
      expect(ItemValidator.safeParse(row).success).toBe(true);
      expect(isBunnyCdnUrl(data.artUrl)).toBe(true);
      expect(row.image).toBe(data.artUrl);
      const sellValue =
        data.kind === "LEADER" || data.variant === "FORBIDDEN"
          ? 0
          : KESSEN_CARD_SELL_VALUES[row.rarity];
      expect(sellPrice(row, 1)).toBe(sellValue);
    }
  });

  it("lists packs whose caches draw only seeded collectible cards", async () => {
    const rows = await seededRows();
    const collectible = new Set(
      KESSEN_SEED_CATALOG.filter(
        (card) => card.kind !== "LEADER" && card.isCollectible,
      ).map((card) => card.id),
    );
    for (const pack of KESSEN_PACKS) {
      const row = rows.find((entry) => entry.id === pack.id);
      expect(row).toEqual(
        expect.objectContaining({
          itemType: "CONSUMABLE",
          destroyOnUse: true,
          inShop: pack.listing !== null,
          cost: pack.listing?.cost ?? 0,
          seichiSilverCost: pack.listing ? 0 : 1,
          purchaseLimit: pack.listing?.purchaseLimit ?? null,
          purchaseLimitPeriod: pack.listing?.purchaseLimitPeriod ?? "NONE",
          canBeTraded: false,
        }),
      );
      if (!row) throw new Error(`${pack.id} is not seeded`);
      // The item editor accepts every pack; earned-only packs sell for nothing.
      expect(ItemValidator.safeParse(row).success).toBe(true);
      if (!pack.listing) expect(sellPrice(row, 99)).toBe(0);
      expect(isUnsellableCard(row)).toBe(pack.id === KESSEN_PACK_IDS.first);
      expect(row.effects).toHaveLength(2);
      for (const effect of row.effects) {
        const cache = weightedCacheSchema.parse(
          "weightedCache" in effect ? effect.weightedCache : null,
        );
        for (const entry of cache.tiers.flatMap((tier) => tier.entries)) {
          for (const reward of entry.items)
            expect(collectible).toContain(reward.itemId);
        }
      }
    }
  });

  it("stocks the Card Master stall with packs, commons and rares only", async () => {
    const client = await getTestDatabase();
    const listed = await client
      .select({ id: item.id, itemType: item.itemType, rarity: item.rarity })
      .from(item)
      .where(and(kessenGoodsCondition("only"), eq(item.inShop, true)));
    expect(
      listed.every(
        (row) =>
          row.id.startsWith("kessen-pack-") ||
          (row.itemType === "CARD" && ["COMMON", "RARE"].includes(row.rarity)),
      ),
    ).toBe(true);
    expect(listed.filter((row) => row.itemType === "CARD")).toHaveLength(
      KESSEN_SEED_CATALOG.filter(
        (card) =>
          card.kind !== "LEADER" &&
          card.isCollectible &&
          card.variant === "STANDARD" &&
          (card.rarity === "COMMON" || card.rarity === "RARE"),
      ).length,
    );
  });

  it("keeps rows staff have edited when it runs again", async () => {
    await runRawSql(
      "UPDATE `Item` SET `name` = 'Renamed Owlcat', `cost` = 1 WHERE `id` = 'kessen-owlcat'",
    );
    await runRawSql(migration);
    const rows = await seededRows();
    expect(rows).toHaveLength(KESSEN_SEED_CATALOG.length + KESSEN_PACKS.length);
    expect(rows.find((row) => row.id === "kessen-owlcat")).toEqual(
      expect.objectContaining({ name: "Renamed Owlcat", cost: 1 }),
    );
  });
});
