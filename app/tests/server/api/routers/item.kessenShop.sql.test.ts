import { beforeEach, describe, expect, it } from "bun:test";
import { and, eq, gt } from "drizzle-orm";
import {
  ANBU_ITEMSHOP_DISCOUNT_PERC,
  CACHE_PROBABILITY_TOTAL,
  KESSEN_CARD_SELL_VALUES,
  KESSEN_PACK_ID_PREFIX,
  KESSEN_VILLAGE_BUNDLE_WEEKLY_LIMIT,
} from "@/drizzle/constants";
import {
  actionLog,
  item,
  itemPurchaseCounter,
  kessenProgress,
  userData,
  userItem,
  villageStructure,
} from "@/drizzle/schema";
import {
  DECK_COPIES_SALE_REASON,
  EARNED_PACK_BLOCK_REASON,
} from "@/libs/kessen/cardSale";
import { kessenCardToCardData } from "@/libs/kessen/catalog";
import { buildKessenPackEffects } from "@/libs/kessen/packContents";
import {
  isKessenPackId,
  KESSEN_PACK_IDS,
  KESSEN_VILLAGE_BUNDLE_LIMIT_KEY,
} from "@/libs/kessen/packs";
import { listItemForGetAll } from "@/queries/item";
import { itemDatabaseFilter, itemRouter } from "@/server/api/routers/item";
import { kessenCollectionRouter } from "@/server/api/routers/kessenCollection";
import { getItemPurchasePeriodStart } from "@/utils/time";
import { ItemValidator } from "@/validators/combat";
import { KESSEN_SEED_CATALOG } from "../../../libs/kessen/fixtures/catalog";
import { insertItems, insertUserItems, insertUsers } from "../../../setup/factories";
import { beforeTransaction } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const USER = "kessen-shopper";
const PRICE = 1_000;
const MONEY = 100_000;
const STRUCTURE_DISCOUNT = 10;
const PAPER = `${KESSEN_PACK_ID_PREFIX}paper`;
const LACQUER = `${KESSEN_PACK_ID_PREFIX}lacquer`;
const HYORIN_BUNDLE = KESSEN_PACK_IDS.village("HYORIN");
const AKASUMI_BUNDLE = KESSEN_PACK_IDS.village("AKASUMI");
const SHARED_LIMIT_MESSAGE = "You already bought this week's Village Bundle";
const COMMON_ONLY = {
  COMMON: CACHE_PROBABILITY_TOTAL,
  RARE: 0,
  EPIC: 0,
  LEGENDARY: 0,
  FORBIDDEN: 0,
};
const LEGENDARY_ONLY = {
  ...COMMON_ONLY,
  COMMON: 0,
  LEGENDARY: CACHE_PROBABILITY_TOTAL,
};
const FORBIDDEN_ONLY = {
  ...COMMON_ONLY,
  COMMON: 0,
  FORBIDDEN: CACHE_PROBABILITY_TOTAL,
};

const moneyOf = async () =>
  (
    await (
      await getTestDatabase()
    ).query.userData.findFirst({
      where: eq(userData.userId, USER),
      columns: { money: true },
    })
  )?.money ?? 0;

const copiesOf = async (itemId: string) =>
  (
    await (
      await getTestDatabase()
    )
      .select({ quantity: userItem.quantity })
      .from(userItem)
      .where(
        and(
          eq(userItem.userId, USER),
          eq(userItem.itemId, itemId),
          gt(userItem.quantity, 0),
        ),
      )
  ).reduce((sum, row) => sum + row.quantity, 0);

describeWithDatabase("item router and Kessen goods", () => {
  beforeEach(async () => {
    await resetTables(itemPurchaseCounter, userItem, item, villageStructure, userData);
    await insertUsers([
      {
        userId: USER,
        villageId: "home",
        money: MONEY,
        status: "AWAKE",
        anbuId: "squad",
        level: 20,
      },
    ]);
    await (await getTestDatabase()).insert(villageStructure).values({
      id: "shop-structure",
      name: "Item Shop",
      route: "/itemshop",
      image: "",
      villageId: "home",
      level: 1,
      itemDiscountPerLvl: STRUCTURE_DISCOUNT,
    });
    await insertItems([
      { id: "plain-item", cost: PRICE, inShop: true, canStack: true, stackSize: 10 },
      {
        id: PAPER,
        itemType: "CONSUMABLE",
        cost: PRICE,
        inShop: true,
        canStack: true,
        stackSize: 10,
      },
      { id: LACQUER, name: "Lacquer Case", itemType: "CONSUMABLE", inShop: false },
      {
        id: "kessen-card",
        name: "Card",
        itemType: "CARD",
        rarity: "COMMON",
        cost: PRICE,
        inShop: true,
        canStack: true,
        stackSize: 10,
      },
      ...[HYORIN_BUNDLE, AKASUMI_BUNDLE].map((id) => ({
        id,
        itemType: "CONSUMABLE" as const,
        cost: PRICE,
        inShop: true,
        canStack: true,
        stackSize: 10,
        purchaseLimit: KESSEN_VILLAGE_BUNDLE_WEEKLY_LIMIT,
        purchaseLimitPeriod: "WEEKLY" as const,
      })),
    ]);
  });

  describe("buy prices", () => {
    const spentOn = async (itemId: string) => {
      const api = await callerFor(itemRouter, USER);
      const result = await api.buy({ itemId, villageId: "home", stack: 2 });
      expect(result.success).toBe(true);
      return MONEY - (await moneyOf());
    };

    it("discounts ordinary items for village structures and ANBU membership", async () => {
      const factor = (100 - STRUCTURE_DISCOUNT - ANBU_ITEMSHOP_DISCOUNT_PERC) / 100;
      expect(await spentOn("plain-item")).toBe(Math.ceil(PRICE * 2 * factor));
    });

    it.each([PAPER, "kessen-card"])(
      "charges the listed price for %s",
      async (itemId) => {
        expect(await spentOn(itemId)).toBe(PRICE * 2);
      },
    );
  });

  describe("the shared Village Bundle limit", () => {
    const sharedCounters = async () =>
      (await getTestDatabase())
        .select()
        .from(itemPurchaseCounter)
        .where(eq(itemPurchaseCounter.userId, USER));

    it("counts every Village Bundle against one weekly purchase", async () => {
      const api = await callerFor(itemRouter, USER);
      const bought = await api.buy({
        itemId: HYORIN_BUNDLE,
        villageId: "home",
        stack: 1,
      });
      expect(bought.success).toBe(true);
      const refused = await api.buy({
        itemId: AKASUMI_BUNDLE,
        villageId: "home",
        stack: 1,
      });
      expect(refused).toMatchObject({ success: false });
      expect(refused.message).toContain(SHARED_LIMIT_MESSAGE);
      for (const id of [HYORIN_BUNDLE, AKASUMI_BUNDLE]) {
        expect(await api.getPurchaseAllowance({ id })).toMatchObject({
          limit: KESSEN_VILLAGE_BUNDLE_WEEKLY_LIMIT,
          remaining: 0,
        });
      }
      // The stall's batched read reports the same shared allowance for each listing.
      const batch = await api.getPurchaseAllowances({
        ids: [HYORIN_BUNDLE, AKASUMI_BUNDLE],
      });
      expect(batch.map((entry) => [entry.itemId, entry.remaining]).sort()).toEqual(
        [
          [AKASUMI_BUNDLE, 0],
          [HYORIN_BUNDLE, 0],
        ].sort(),
      );
      expect(await moneyOf()).toBe(MONEY - PRICE);
      expect(await copiesOf(AKASUMI_BUNDLE)).toBe(0);
      expect(await sharedCounters()).toEqual([
        expect.objectContaining({
          itemId: KESSEN_VILLAGE_BUNDLE_LIMIT_KEY,
          period: "WEEKLY",
          quantity: 1,
        }),
      ]);
    });

    it("rolls back a purchase whose shared quota was claimed after its read", async () => {
      const db = await getTestDatabase();
      // Another bundle's purchase commits the shared counter between this request's read
      // and its transaction; only the guarded increment can refuse it.
      const raced = beforeTransaction(db, () =>
        db.insert(itemPurchaseCounter).values({
          userId: USER,
          itemId: KESSEN_VILLAGE_BUNDLE_LIMIT_KEY,
          period: "WEEKLY",
          periodStart: getItemPurchasePeriodStart("WEEKLY") as Date,
          quantity: KESSEN_VILLAGE_BUNDLE_WEEKLY_LIMIT,
        }),
      );
      const api = callerForDatabase(itemRouter, USER, raced);
      const result = await api.buy({
        itemId: AKASUMI_BUNDLE,
        villageId: "home",
        stack: 1,
      });
      expect(result).toMatchObject({ success: false });
      expect(result.message).toContain(SHARED_LIMIT_MESSAGE);
      expect(await moneyOf()).toBe(MONEY);
      expect(await copiesOf(AKASUMI_BUNDLE)).toBe(0);
    });

    it("sells one bundle when two villages' bundles are bought at once", async () => {
      const api = await callerFor(itemRouter, USER);
      const results = await Promise.all(
        [HYORIN_BUNDLE, AKASUMI_BUNDLE].map((itemId) =>
          api.buy({ itemId, villageId: "home", stack: 1 }),
        ),
      );
      expect(results.filter((result) => result.success)).toHaveLength(1);
      const refused = results.find((result) => !result.success);
      expect(refused?.message).toContain(SHARED_LIMIT_MESSAGE);
      expect((await copiesOf(HYORIN_BUNDLE)) + (await copiesOf(AKASUMI_BUNDLE))).toBe(
        1,
      );
      expect(await moneyOf()).toBe(MONEY - PRICE);
      expect((await sharedCounters()).map((row) => row.quantity)).toEqual([1]);
    });
  });

  describe("selling cards and packs", () => {
    beforeEach(async () => {
      // A Common card holds three deck copies: the oldest stack holds them, the newer surplus.
      await insertUserItems([
        {
          id: "deck-stack",
          userId: USER,
          itemId: "kessen-card",
          quantity: 3,
          createdAt: new Date(1_000),
        },
        {
          id: "surplus-stack",
          userId: USER,
          itemId: "kessen-card",
          quantity: 2,
          createdAt: new Date(2_000),
        },
        {
          id: "listed-stack",
          userId: USER,
          itemId: "kessen-card",
          quantity: 1,
          isInAuction: true,
        },
        { id: "lacquer-stack", userId: USER, itemId: LACQUER, quantity: 2 },
      ]);
    });

    it("sells surplus copies but refuses a sale that takes deck copies", async () => {
      const api = await callerFor(itemRouter, USER);
      const refused = await api.sellUserItem({ userItemId: "deck-stack" });
      expect(refused).toMatchObject({ success: false });
      expect(refused.message).toContain(DECK_COPIES_SALE_REASON);
      expect(await copiesOf("kessen-card")).toBe(6);

      const sold = await api.sellUserItem({ userItemId: "surplus-stack" });
      expect(sold.success).toBe(true);
      expect(await moneyOf()).toBe(MONEY + KESSEN_CARD_SELL_VALUES.COMMON * 2);
      // Listed copies cannot enter decks, so the deck stack is all that is left to keep.
      const last = await api.sellUserItem({ userItemId: "deck-stack" });
      expect(last.success).toBe(false);
    });

    it("bulk sells the surplus stack and refuses the deck stack by totals", async () => {
      const api = await callerFor(itemRouter, USER);
      const result = await api.sellUserItems({
        userItemIds: ["deck-stack", "surplus-stack"],
      });
      expect(result.soldUserItemIds).toEqual(["surplus-stack"]);
      expect(result.refused).toEqual([
        { userItemId: "deck-stack", name: "Card", reason: DECK_COPIES_SALE_REASON },
      ]);
      expect(await copiesOf("kessen-card")).toBe(4);
    });

    it("never sells or drops an earned pack", async () => {
      const api = await callerFor(itemRouter, USER);
      const single = await api.sellUserItem({ userItemId: "lacquer-stack" });
      expect(single.success).toBe(false);
      expect(single.message).toContain(EARNED_PACK_BLOCK_REASON);
      const bulk = await api.sellUserItems({ userItemIds: ["lacquer-stack"] });
      expect(bulk.refused).toEqual([
        {
          userItemId: "lacquer-stack",
          name: "Lacquer Case",
          reason: EARNED_PACK_BLOCK_REASON,
        },
      ]);
      expect(await copiesOf(LACQUER)).toBe(2);
    });
  });

  describe("staff-created packs", () => {
    const STAFF = "pack-maker";

    beforeEach(async () => {
      await resetTables(kessenProgress, actionLog);
      await insertUsers([
        {
          userId: STAFF,
          username: "Pack Maker",
          role: "CONTENT-ADMIN",
          status: "AWAKE",
        },
      ]);
      await insertItems(
        KESSEN_SEED_CATALOG.map((card) => ({
          id: card.id,
          // Item names are unique; the catalog's boss leader shares its Forbidden variant's name.
          name: `${card.name} ${card.id}`,
          itemType: "CARD" as const,
          rarity: card.rarity,
          slot: "NONE" as const,
          target: "SELF" as const,
          inShop: false,
          canStack: true,
          stackSize: 99,
          cardData: kessenCardToCardData(card),
        })),
      );
    });

    it.each(["EPIC", "LEGENDARY"] as const)(
      "refuses creation without selectable %s pity rewards before inserting a pack",
      async (rarity) => {
        const db = await getTestDatabase();
        await db.delete(item).where(eq(item.rarity, rarity));
        const before = await db.select({ id: item.id }).from(item);
        const staff = await callerFor(itemRouter, STAFF);
        const result = await staff.create({ type: "CONSUMABLE", kessenPack: true });
        expect(result.success).toBe(false);
        expect(result.message).toContain("pity guarantees");
        expect(await db.select({ id: item.id }).from(item)).toEqual(before);
        expect(await db.select().from(actionLog)).toEqual([]);
      },
    );

    it("refuses unpayable rare-slot saves without changing the pack or logging a save", async () => {
      const db = await getTestDatabase();
      const staff = await callerFor(itemRouter, STAFF);
      const created = await staff.create({ type: "CONSUMABLE", kessenPack: true });
      expect(created.success).toBe(true);
      const saved = await db.query.item.findFirst({
        where: eq(item.id, created.message),
      });
      if (!saved) throw new Error("Missing pack fixture");
      for (const rareSlotWeights of [
        FORBIDDEN_ONLY,
        {
          ...COMMON_ONLY,
          COMMON: 0,
          RARE: CACHE_PROBABILITY_TOTAL / 2,
          LEGENDARY: CACHE_PROBABILITY_TOTAL / 2,
        },
      ]) {
        const effects = buildKessenPackEffects(
          {
            name: saved.name,
            faction: null,
            normalWeights: COMMON_ONLY,
            rareSlotWeights,
          },
          KESSEN_SEED_CATALOG,
        );
        const result = await staff.update({
          id: saved.id,
          data: ItemValidator.parse({ ...saved, hidden: false, inShop: true, effects }),
        });
        expect(result.success).toBe(false);
        expect(result.message).toContain("pity guarantees");
        expect(await db.query.item.findFirst({ where: eq(item.id, saved.id) })).toEqual(
          saved,
        );
        expect(await db.select().from(actionLog)).toEqual([]);
      }
    });

    it("saves Legendary-floor and no-pity Forbidden packs", async () => {
      const db = await getTestDatabase();
      const staff = await callerFor(itemRouter, STAFF);
      const created = await staff.create({ type: "CONSUMABLE", kessenPack: true });
      expect(created.success).toBe(true);
      const saved = await db.query.item.findFirst({
        where: eq(item.id, created.message),
      });
      if (!saved) throw new Error("Missing pack fixture");
      for (const config of [
        {
          slots: { normal: 1, rareSlot: 1 },
          normalWeights: COMMON_ONLY,
          rareSlotWeights: LEGENDARY_ONLY,
        },
        {
          slots: { normal: 1, rareSlot: 0 },
          normalWeights: FORBIDDEN_ONLY,
          rareSlotWeights: FORBIDDEN_ONLY,
        },
      ]) {
        const effects = buildKessenPackEffects(
          { name: saved.name, faction: null, ...config },
          KESSEN_SEED_CATALOG,
        );
        const result = await staff.update({
          id: saved.id,
          data: ItemValidator.parse({ ...saved, hidden: false, inShop: true, effects }),
        });
        expect(result.success, result.message).toBe(true);
        expect(
          await db.query.item.findFirst({ where: eq(item.id, saved.id) }),
        ).toMatchObject({
          effects,
          hidden: false,
          inShop: true,
        });
      }
    });

    it("creates a hidden pack the stall sells and the Card Hall opens once released", async () => {
      const db = await getTestDatabase();
      const staff = await callerFor(itemRouter, STAFF);
      const created = await staff.create({ type: "CONSUMABLE", kessenPack: true });
      expect(created.success).toBe(true);
      const packId = created.message;
      expect(isKessenPackId(packId)).toBe(true);
      // The editor saves the new pack as created.
      const saved = await db.query.item.findFirst({ where: eq(item.id, packId) });
      expect(ItemValidator.safeParse(saved).error?.issues ?? []).toEqual([]);
      const stall = async () =>
        (
          await listItemForGetAll(
            db,
            0,
            { limit: 100 },
            itemDatabaseFilter({
              onlyInShop: true,
              hidden: false,
              itemType: "CONSUMABLE",
              kessenGoods: "only",
            }),
          )
        ).map((row) => row.id);
      expect(await stall()).not.toContain(packId);

      // The editor's shop fields release it at the stall with a daily limit.
      await db
        .update(item)
        .set({
          hidden: false,
          inShop: true,
          cost: PRICE,
          purchaseLimit: 1,
          purchaseLimitPeriod: "DAILY",
        })
        .where(eq(item.id, packId));
      expect(await stall()).toContain(packId);
      const api = await callerFor(itemRouter, USER);
      expect(
        (await api.buy({ itemId: packId, villageId: "home", stack: 1 })).success,
      ).toBe(true);
      expect(
        (await api.buy({ itemId: packId, villageId: "home", stack: 1 })).success,
      ).toBe(false);
      expect(await copiesOf(packId)).toBe(1);

      const [stack] = await db
        .select({ id: userItem.id })
        .from(userItem)
        .where(and(eq(userItem.userId, USER), eq(userItem.itemId, packId)));
      const opened = await callerForDatabase(kessenCollectionRouter, USER, db).openPack(
        {
          userItemId: stack?.id ?? "",
          requestId: "staff-pack-open-1",
        },
      );
      if (!opened.success || !("reveal" in opened)) throw new Error(opened.message);
      expect(opened.reveal?.packItemId).toBe(packId);
      expect(opened.reveal?.cards).toHaveLength(5);
      expect(opened.reveal?.pity.epicIn).toBeGreaterThan(0);
      expect(await copiesOf(packId)).toBe(0);

      // A copy made in the item manual is a pack too.
      const copy = await staff.clone({ id: packId });
      expect(copy.success).toBe(true);
      expect(isKessenPackId(copy.message)).toBe(true);
    });
  });
});
