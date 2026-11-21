import { beforeEach, describe, expect, it } from "bun:test";
import { and, eq, gt } from "drizzle-orm";
import {
  ANBU_ITEMSHOP_DISCOUNT_PERC,
  KESSEN_CARD_SELL_VALUES,
  KESSEN_PACK_ID_PREFIX,
  KESSEN_VILLAGE_BUNDLE_WEEKLY_LIMIT,
} from "@/drizzle/constants";
import {
  item,
  itemPurchaseCounter,
  userData,
  userItem,
  villageStructure,
} from "@/drizzle/schema";
import {
  DECK_COPIES_SALE_REASON,
  EARNED_PACK_BLOCK_REASON,
} from "@/libs/kessen/cardSale";
import { KESSEN_PACK_IDS, KESSEN_VILLAGE_BUNDLE_LIMIT_KEY } from "@/libs/kessen/packs";
import { itemRouter } from "@/server/api/routers/item";
import { getItemPurchasePeriodStart } from "@/utils/time";
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
});
