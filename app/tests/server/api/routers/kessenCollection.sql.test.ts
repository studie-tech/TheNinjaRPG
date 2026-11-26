import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { and, eq } from "drizzle-orm";
import {
  CACHE_PROBABILITY_TOTAL,
  KESSEN_CARD_SELL_VALUES,
  KESSEN_FIRST_BUNDLE_ITEM_ID,
  KESSEN_LEGENDARY_PITY_PACKS,
  KESSEN_MAX_DECKS,
} from "@/drizzle/constants";
import {
  actionLog,
  item,
  kessenDeck,
  kessenProgress,
  userData,
  userItem,
} from "@/drizzle/schema";
import { AUTO_WAKE_MESSAGE } from "@/libs/actionReadiness";
import { kessenCardToCardData } from "@/libs/kessen/catalog";
import { starterDeck } from "@/libs/kessen/deck";
import { buildKessenPackEffects } from "@/libs/kessen/packContents";
import type { KessenCard } from "@/libs/kessen/types";
import { listItemForGetAll } from "@/queries/item";
import { itemDatabaseFilter, itemRouter } from "@/server/api/routers/item";
import { kessenCollectionRouter } from "@/server/api/routers/kessenCollection";
import type { DrizzleClient } from "@/server/db";
import {
  KESSEN_PACKS,
  KessenPackRaceError,
  prepareKessenPackOpening,
} from "@/server/utils/kessenPacks";
import { HealTag, NonCombatConsumeRewardTag } from "@/validators/combat";
import type { WeightedCache } from "@/validators/weightedCache";
import { KESSEN_SEED_CATALOG } from "../../../libs/kessen/fixtures/catalog";
import { insertItems, insertUserItems, insertUsers } from "../../../setup/factories";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const USER = "collector";
const OTHER = "rival";

/** Shirohana cards of the seed catalog, by tier, for small deterministic test packs. */
const pickCards = (filter: (card: KessenCard) => boolean, count: number) =>
  KESSEN_SEED_CATALOG.filter(
    (card) => card.kind !== "LEADER" && card.variant === "STANDARD" && filter(card),
  )
    .slice(0, count)
    .map((card) => card.id);
const [C1, C2] = pickCards((card) => card.rarity === "COMMON", 2) as [string, string];
const [R1] = pickCards((card) => card.rarity === "RARE", 1) as [string];
const [E1] = pickCards((card) => card.rarity === "EPIC", 1) as [string];
const [L1, L2] = pickCards((card) => card.rarity === "LEGENDARY", 2) as [
  string,
  string,
];

const tier = (name: string, probability: number, ids: string[]) => ({
  name,
  probability,
  entries: ids.map((itemId) => ({ items: [{ itemId, quantity: 1 }] })),
});
const cacheEffect = (count: number, tiers: WeightedCache["tiers"]) =>
  NonCombatConsumeRewardTag.parse({
    type: "noncombatconsumereward",
    rewardMode: "weightedCache",
    weightedCache: {
      version: 1,
      displayName: "Test Bundle",
      rolls: [{ count, probability: CACHE_PROBABILITY_TOTAL }],
      tiers,
    },
  });
/** Four slots over two commons, then a fifth slot that draws the rare unless pity raises it. */
const testPackEffects = () => [
  cacheEffect(4, [tier("Common", CACHE_PROBABILITY_TOTAL, [C1, C2])]),
  cacheEffect(1, [
    tier("Rare", 9_998, [R1]),
    tier("Epic", 1, [E1]),
    tier("Legendary", 1, [L1, L2]),
  ]),
];
const packRow = (id: string, name: string) => ({
  id,
  name,
  itemType: "CONSUMABLE" as const,
  target: "SELF" as const,
  method: "SINGLE" as const,
  destroyOnUse: true,
  preventBattleUsage: true,
  canStack: true,
  stackSize: 99,
  effects: testPackEffects(),
});

const progressRow = (values: Partial<typeof kessenProgress.$inferInsert> = {}) => ({
  userId: USER,
  academy: {},
  seenKeywords: [],
  npcWinsToday: {},
  ...values,
});

const quantityOf = async (db: DrizzleClient, itemId: string, userId = USER) =>
  (
    await db
      .select({ quantity: userItem.quantity })
      .from(userItem)
      .where(and(eq(userItem.userId, userId), eq(userItem.itemId, itemId)))
  ).reduce((sum, row) => sum + row.quantity, 0);
const progressOf = async (db: DrizzleClient) =>
  db.query.kessenProgress.findFirst({ where: eq(kessenProgress.userId, USER) });

describeWithDatabase("kessenCollection router", () => {
  // Draws land at the start of every interval: the first entry of the first tier.
  let random: ReturnType<typeof spyOn> | undefined;
  afterEach(() => random?.mockRestore());
  beforeEach(async () => {
    random = spyOn(Math, "random").mockReturnValue(0);
    await resetTables(actionLog, userItem, item, userData, kessenProgress, kessenDeck);
    await insertUsers([
      { userId: USER, username: "Collector", level: 50, status: "AWAKE", money: 0 },
      { userId: OTHER, username: "Rival", level: 50, status: "AWAKE", money: 0 },
    ]);
    await insertItems([
      ...KESSEN_SEED_CATALOG.map((card) => ({
        id: card.id,
        // Item names are unique; the catalog's boss leader shares its Forbidden variant's name.
        name: `${card.name} ${card.id}`,
        itemType: "CARD" as const,
        rarity: card.rarity,
        slot: "NONE" as const,
        target: "SELF" as const,
        canStack: true,
        stackSize: 99,
        cardData: kessenCardToCardData(card),
      })),
      packRow("kessen-pack-test", "Test Bundle"),
      { ...packRow(KESSEN_FIRST_BUNDLE_ITEM_ID, "First Bundle"), inShop: false },
      { id: "potion", name: "Potion", itemType: "CONSUMABLE" },
    ]);
    await insertUserItems([
      { id: "pack-stack", userId: USER, itemId: "kessen-pack-test", quantity: 2 },
      { id: "potion-stack", userId: USER, itemId: "potion", quantity: 1 },
    ]);
  });

  describe("openPack", () => {
    it("opens one pack per request id and replays the receipt on retry", async () => {
      const db = await getTestDatabase();
      const caller = callerForDatabase(kessenCollectionRouter, USER, db);
      const input = { userItemId: "pack-stack", requestId: "open-request-0001" };
      const first = await caller.openPack(input);
      expect(first.success).toBe(true);
      if (!first.success || !("reveal" in first)) throw new Error(first.message);
      expect(first.reveal?.cards).toHaveLength(5);
      expect(first.reveal?.cards.at(-1)).toMatchObject({ itemId: R1, rarity: "RARE" });
      expect(first.reveal?.pity).toEqual({
        epicIn: 6,
        legendaryIn: KESSEN_LEGENDARY_PITY_PACKS - 1,
      });
      expect(await caller.openPack(input)).toEqual(first);
      expect(await quantityOf(db, "kessen-pack-test")).toBe(1);
      expect(await db.select().from(actionLog)).toHaveLength(1);
      expect(await quantityOf(db, R1)).toBe(1);
      expect((await quantityOf(db, C1)) + (await quantityOf(db, C2))).toBe(4);
      expect(await progressOf(db)).toMatchObject({
        packsSinceEpic: 1,
        packsSinceLegendary: 1,
      });
      const second = await caller.openPack({
        userItemId: "pack-stack",
        requestId: "open-request-0002",
      });
      expect(second.success).toBe(true);
      expect(await quantityOf(db, "kessen-pack-test")).toBe(0);
      const empty = await caller.openPack({
        userItemId: "pack-stack",
        requestId: "open-request-0003",
      });
      expect(empty.success).toBe(false);
      expect(await db.select().from(actionLog)).toHaveLength(2);
    });

    it("rejects items that are not card packs without consuming them", async () => {
      const db = await getTestDatabase();
      const caller = callerForDatabase(kessenCollectionRouter, USER, db);
      expect(
        await caller.openPack({
          userItemId: "potion-stack",
          requestId: "potion-open-01",
        }),
      ).toEqual({ success: false, message: "This item is not a card pack" });
      expect(
        await caller.openPack({ userItemId: "missing", requestId: "missing-open-01" }),
      ).toMatchObject({ success: false });
      expect(await quantityOf(db, "potion")).toBe(1);
    });

    it("raises the fifth slot at epic pity and grants an unowned legendary at legendary pity", async () => {
      const db = await getTestDatabase();
      await db.insert(kessenProgress).values(progressRow({ packsSinceEpic: 6 }));
      const caller = callerForDatabase(kessenCollectionRouter, USER, db);
      const epic = await caller.openPack({
        userItemId: "pack-stack",
        requestId: "epic-pity-open-1",
      });
      if (!epic.success || !("reveal" in epic)) throw new Error(epic.message);
      expect(epic.reveal?.cards.at(-1)).toMatchObject({ itemId: E1, isNew: true });
      expect(await progressOf(db)).toMatchObject({
        packsSinceEpic: 0,
        packsSinceLegendary: 1,
      });
      await db
        .update(kessenProgress)
        .set({ packsSinceLegendary: KESSEN_LEGENDARY_PITY_PACKS - 1 })
        .where(eq(kessenProgress.userId, USER));
      await insertUserItems([
        { id: "owned-legendary", userId: USER, itemId: L1, quantity: 1 },
      ]);
      const legendary = await caller.openPack({
        userItemId: "pack-stack",
        requestId: "legendary-pity-1",
      });
      if (!legendary.success || !("reveal" in legendary))
        throw new Error(legendary.message);
      expect(legendary.reveal?.cards.at(-1)).toMatchObject({ itemId: L2, isNew: true });
      expect(legendary.reveal?.pity).toEqual({
        epicIn: 7,
        legendaryIn: KESSEN_LEGENDARY_PITY_PACKS,
      });
      expect(await quantityOf(db, L2)).toBe(1);
    });

    it("re-rolls maxed cards counting auction listings and auto-sells surplus", async () => {
      const db = await getTestDatabase();
      await insertUserItems([
        { id: "c1-held", userId: USER, itemId: C1, quantity: 2 },
        { id: "c1-listed", userId: USER, itemId: C1, quantity: 1, isInAuction: true },
      ]);
      const caller = callerForDatabase(kessenCollectionRouter, USER, db);
      expect((await caller.setAutoSell({ enabled: true })).success).toBe(true);
      const opened = await caller.openPack({
        userItemId: "pack-stack",
        requestId: "auto-sell-open-1",
      });
      if (!opened.success || !("reveal" in opened)) throw new Error(opened.message);
      const commons = opened.reveal?.cards.slice(0, 4) ?? [];
      expect(
        commons.filter((card) => card.itemId === C2 && !card.surplus),
      ).toHaveLength(3);
      expect(commons.filter((card) => card.surplus)).toEqual([
        expect.objectContaining({ soldFor: KESSEN_CARD_SELL_VALUES.COMMON }),
      ]);
      expect(await quantityOf(db, C1)).toBe(3);
      expect(await quantityOf(db, C2)).toBe(3);
      const [user] = await db
        .select({ money: userData.money })
        .from(userData)
        .where(eq(userData.userId, USER));
      expect(user?.money).toBe(KESSEN_CARD_SELL_VALUES.COMMON);
    });

    it("guarantees the First Bundle's fifth slot through the item page's use", async () => {
      const db = await getTestDatabase();
      await insertUserItems([
        {
          id: "first-stack",
          userId: USER,
          itemId: KESSEN_FIRST_BUNDLE_ITEM_ID,
          quantity: 1,
        },
      ]);
      const response = await callerForDatabase(itemRouter, USER, db).consume({
        userItemId: "first-stack",
        requestId: "first-bundle-open",
      });
      if (!response.success || !("kessenReveal" in response))
        throw new Error(response.message);
      expect(response.kessenReveal?.packItemId).toBe(KESSEN_FIRST_BUNDLE_ITEM_ID);
      expect(response.kessenReveal?.cards.at(-1)).toMatchObject({ itemId: E1 });
      expect(await progressOf(db)).toMatchObject({
        firstBundleOpened: true,
        packsSinceEpic: 0,
      });
    });

    it("refuses to commit an opening whose pity counters moved meanwhile", async () => {
      const db = await getTestDatabase();
      const [stack] = await db
        .select()
        .from(item)
        .where(eq(item.id, "kessen-pack-test"));
      const caches = (stack?.effects ?? []).flatMap((effect) =>
        effect.type === "noncombatconsumereward" && effect.weightedCache
          ? [effect.weightedCache]
          : [],
      );
      const prepared = await prepareKessenPackOpening({
        client: db,
        userId: USER,
        item: { id: "kessen-pack-test" },
        caches,
      });
      if (!prepared?.success) throw new Error("Pack was not prepared");
      const opening = prepared.open();
      await db
        .update(kessenProgress)
        .set({ packsSinceEpic: 3 })
        .where(eq(kessenProgress.userId, USER));
      await expect(db.transaction((tx) => opening.commit(tx))).rejects.toBeInstanceOf(
        KessenPackRaceError,
      );
      expect(await progressOf(db)).toMatchObject({ packsSinceEpic: 3 });
    });

    describe("while asleep", () => {
      // An unsettled regeneration window: waking would settle it and move regenAt.
      const regenAt = new Date(Date.now() - 10 * 60 * 1000);
      regenAt.setMilliseconds(0);
      const sleep = async (autoWakeUp: boolean) => {
        const db = await getTestDatabase();
        await db
          .update(userData)
          .set({ status: "ASLEEP", autoWakeUp, curHealth: 10, maxHealth: 100, regenAt })
          .where(eq(userData.userId, USER));
        return db;
      };
      const sleeper = async (db: DrizzleClient) =>
        (await db.query.userData.findFirst({ where: eq(userData.userId, USER) }))!;

      it.each([true, false])(
        "opens a pack without waking the player (autoWakeUp %p)",
        async (autoWakeUp) => {
          const db = await sleep(autoWakeUp);
          const opened = await callerForDatabase(
            kessenCollectionRouter,
            USER,
            db,
          ).openPack({
            userItemId: "pack-stack",
            requestId: `asleep-open-${autoWakeUp}`,
          });
          expect(opened.success).toBe(true);
          if (!opened.success || !("reveal" in opened)) throw new Error(opened.message);
          expect(opened.reveal?.cards).toHaveLength(5);
          expect(opened).not.toHaveProperty("actionNotice");
          expect(await quantityOf(db, "kessen-pack-test")).toBe(1);
          // Still asleep, with the sleeping regeneration left for waking to settle.
          expect(await sleeper(db)).toMatchObject({
            status: "ASLEEP",
            autoWakeUp,
            curHealth: 10,
            regenAt,
          });
          // The item page's use takes the same path.
          const used = await callerForDatabase(itemRouter, USER, db).consume({
            userItemId: "pack-stack",
            requestId: `asleep-use-${autoWakeUp}`,
          });
          expect(used.success).toBe(true);
          expect(await quantityOf(db, "kessen-pack-test")).toBe(0);
          expect(await sleeper(db)).toMatchObject({ status: "ASLEEP", regenAt });
        },
      );

      it("still wakes or refuses a sleeping player for other consumables", async () => {
        await insertItems([
          {
            id: "tonic",
            name: "Tonic",
            itemType: "CONSUMABLE",
            target: "SELF",
            method: "SINGLE",
            destroyOnUse: true,
            preventBattleUsage: true,
            canStack: true,
            stackSize: 99,
            effects: [
              HealTag.parse({
                power: 5,
                calculation: "static",
                poolsAffected: ["Health"],
              }),
            ],
          },
        ]);
        await insertUserItems([
          { id: "tonic-stack", userId: USER, itemId: "tonic", quantity: 2 },
        ]);
        const refused = await callerForDatabase(
          itemRouter,
          USER,
          await sleep(false),
        ).consume({ userItemId: "tonic-stack" });
        expect(refused).toEqual({
          success: false,
          message: "You are asleep. Wake up before taking this action.",
        });
        const db = await sleep(true);
        expect(await quantityOf(db, "tonic")).toBe(2);
        const woken = await callerForDatabase(itemRouter, USER, db).consume({
          userItemId: "tonic-stack",
        });
        expect(woken).toMatchObject({ success: true, actionNotice: AUTO_WAKE_MESSAGE });
        expect(await quantityOf(db, "tonic")).toBe(1);
        expect((await sleeper(db)).status).toBe("AWAKE");
      });
    });
  });

  describe("chooseStarter", () => {
    it("needs the lesson, grants once per account and saves the starter deck", async () => {
      const db = await getTestDatabase();
      const caller = callerForDatabase(kessenCollectionRouter, USER, db);
      expect(await caller.chooseStarter({ faction: "HYORIN" })).toMatchObject({
        success: false,
        message: expect.stringContaining("lesson"),
      });
      await db
        .insert(kessenProgress)
        .values(progressRow({ academy: { "first-blood": "earlier-match" } }));
      const granted = await caller.chooseStarter({ faction: "HYORIN" });
      if (!granted.success) throw new Error(granted.message);
      const starter = starterDeck("HYORIN");
      expect(granted.deck).toMatchObject({ leaderItemId: starter.leaderId });
      for (const entry of starter.cards)
        expect(await quantityOf(db, entry.itemId)).toBe(entry.count);
      expect(await quantityOf(db, starter.leaderId)).toBe(1);
      expect(await quantityOf(db, KESSEN_FIRST_BUNDLE_ITEM_ID)).toBe(1);
      expect(await progressOf(db)).toMatchObject({
        starterGranted: true,
        starterFaction: "HYORIN",
      });
      expect(
        await db.select().from(kessenDeck).where(eq(kessenDeck.userId, USER)),
      ).toHaveLength(1);
      expect(await caller.chooseStarter({ faction: "AKIKAZE" })).toMatchObject({
        success: false,
      });
      expect(await quantityOf(db, starter.leaderId)).toBe(1);
      expect(await quantityOf(db, starterDeck("AKIKAZE").leaderId)).toBe(0);
    });

    it("grants a single starter to concurrent claims", async () => {
      const db = await getTestDatabase();
      await db
        .insert(kessenProgress)
        .values(progressRow({ academy: { "first-blood": "earlier-match" } }));
      const caller = callerForDatabase(kessenCollectionRouter, USER, db);
      const results = await Promise.all([
        caller.chooseStarter({ faction: "HYORIN" }),
        caller.chooseStarter({ faction: "SYNDICATE" }),
      ]);
      expect(results.filter((result) => result.success)).toHaveLength(1);
      expect(await quantityOf(db, KESSEN_FIRST_BUNDLE_ITEM_ID)).toBe(1);
    });
  });

  describe("decks", () => {
    const ownStarter = async (faction: "HYORIN" | "AKIKAZE") => {
      const deck = starterDeck(faction);
      await insertUserItems(
        [...deck.cards, { itemId: deck.leaderId, count: 1 }].map((entry, index) => ({
          id: `${faction}-${index}`,
          userId: USER,
          itemId: entry.itemId,
          quantity: entry.count,
        })),
      );
      return deck;
    };

    it("saves valid owned decks, updates and deletes them, and rejects invalid ones", async () => {
      const db = await getTestDatabase();
      const deck = await ownStarter("HYORIN");
      const caller = callerForDatabase(kessenCollectionRouter, USER, db);
      const saved = await caller.saveDeck({
        name: "Frost",
        leaderItemId: deck.leaderId,
        cards: deck.cards,
      });
      if (!saved.success) throw new Error(saved.message);
      const renamed = await caller.saveDeck({
        id: saved.deck.id,
        name: "Frost II",
        leaderItemId: deck.leaderId,
        cards: deck.cards,
      });
      expect(renamed).toMatchObject({
        success: true,
        deck: { name: "Frost II" },
        needsFill: false,
      });
      expect(
        await db.query.kessenDeck.findFirst({
          where: eq(kessenDeck.id, saved.deck.id),
        }),
      ).toMatchObject({ name: "Frost II", userId: USER });
      // Another faction's starter is not owned.
      const other = starterDeck("AKIKAZE");
      expect(
        await caller.saveDeck({
          name: "Borrowed",
          leaderItemId: other.leaderId,
          cards: other.cards,
        }),
      ).toMatchObject({ success: false, message: expect.stringContaining("own") });
      // Another player's deck cannot be overwritten or deleted.
      const rival = callerForDatabase(kessenCollectionRouter, OTHER, db);
      expect(
        await rival.saveDeck({
          id: saved.deck.id,
          name: "Stolen",
          leaderItemId: deck.leaderId,
          cards: deck.cards,
        }),
      ).toMatchObject({ success: false });
      expect(await rival.deleteDeck({ id: saved.deck.id })).toMatchObject({
        success: false,
      });
      expect(await caller.deleteDeck({ id: saved.deck.id })).toMatchObject({
        success: true,
      });
      expect(await db.select().from(kessenDeck)).toHaveLength(0);
    });

    it("saves a short owned deck for borrowed fill and rejects decks fill cannot repair", async () => {
      const db = await getTestDatabase();
      const deck = await ownStarter("HYORIN");
      const caller = callerForDatabase(kessenCollectionRouter, USER, db);
      const short = deck.cards.slice(0, 3);
      const saved = await caller.saveDeck({
        name: "Short",
        leaderItemId: deck.leaderId,
        cards: short,
      });
      expect(saved).toMatchObject({ success: true, needsFill: true });
      if (!saved.success) throw new Error(saved.message);
      const stored = await db.query.kessenDeck.findFirst({
        where: eq(kessenDeck.id, saved.deck.id),
      });
      expect(stored?.name).toBe("Short");
      expect(stored?.cards.map((entry) => entry.itemId).sort()).toEqual(
        short.map((entry) => entry.itemId).sort(),
      );
      // A leader the player does not own cannot be filled.
      const other = starterDeck("AKIKAZE");
      expect(
        await caller.saveDeck({
          name: "Not mine",
          leaderItemId: other.leaderId,
          cards: [],
        }),
      ).toMatchObject({ success: false, message: expect.stringContaining("own") });
      // A rule other than size or ownership (another faction's cards) still rejects.
      expect(
        await caller.saveDeck({
          name: "Mixed",
          leaderItemId: deck.leaderId,
          cards: [
            ...short,
            {
              itemId: KESSEN_SEED_CATALOG.find(
                (card) =>
                  card.faction === "AKIKAZE" &&
                  card.kind !== "LEADER" &&
                  card.isCollectible,
              )!.id,
              count: 1,
            },
          ],
        }),
      ).toMatchObject({ success: false });
      // Too many cards are never filled.
      expect(
        await caller.saveDeck({
          name: "Long",
          leaderItemId: deck.leaderId,
          cards: [...deck.cards, ...deck.cards],
        }),
      ).toMatchObject({ success: false });
      expect(await db.select().from(kessenDeck)).toHaveLength(1);
    });

    it("saves decks with copies listed in the auction house for fill and stops at the limit", async () => {
      const db = await getTestDatabase();
      const deck = await ownStarter("HYORIN");
      const caller = callerForDatabase(kessenCollectionRouter, USER, db);
      const listedCard = deck.cards[0]!.itemId;
      await db
        .update(userItem)
        .set({ isInAuction: true })
        .where(and(eq(userItem.userId, USER), eq(userItem.itemId, listedCard)));
      // Listed copies are not owned for decks: matches lend them instead.
      expect(
        await caller.saveDeck({
          name: "Listed",
          leaderItemId: deck.leaderId,
          cards: deck.cards,
        }),
      ).toMatchObject({ success: true, needsFill: true });
      await db
        .update(userItem)
        .set({ isInAuction: false })
        .where(eq(userItem.itemId, listedCard));
      for (let index = 1; index < KESSEN_MAX_DECKS; index++)
        expect(
          (
            await caller.saveDeck({
              name: `Deck ${index}`,
              leaderItemId: deck.leaderId,
              cards: deck.cards,
            })
          ).success,
        ).toBe(true);
      expect(
        await caller.saveDeck({
          name: "One too many",
          leaderItemId: deck.leaderId,
          cards: deck.cards,
        }),
      ).toMatchObject({ success: false });
    });
  });

  it("lists the stall's packs and cards for the Card Master and hides them elsewhere", async () => {
    const db = await getTestDatabase();
    const paper = KESSEN_PACKS.find((pack) => pack.kind === "paper")!;
    const lacquer = KESSEN_PACKS.find((pack) => pack.kind === "lacquer")!;
    await db.delete(item).where(eq(item.id, "kessen-pack-test"));
    await insertItems(
      [paper, lacquer].map((pack) => ({
        ...packRow(pack.id, pack.name),
        effects: buildKessenPackEffects(pack, KESSEN_SEED_CATALOG),
        inShop: pack.listing !== null,
        cost: pack.listing?.cost ?? 0,
        purchaseLimit: pack.listing?.purchaseLimit ?? null,
        purchaseLimitPeriod: pack.listing?.purchaseLimitPeriod ?? "NONE",
      })),
    );
    await db.update(item).set({ inShop: false }).where(eq(item.itemType, "CARD"));
    await db.update(item).set({ inShop: true, cost: 1500 }).where(eq(item.id, C1));
    const list = (input: Parameters<typeof itemDatabaseFilter>[0]) =>
      listItemForGetAll(
        db,
        0,
        { limit: 100 },
        itemDatabaseFilter({ onlyInShop: true, hidden: false, ...input }),
      );
    const stallPacks = await list({ itemType: "CONSUMABLE", kessenGoods: "only" });
    expect(stallPacks.map((row) => row.id)).toEqual([paper.id]);
    const stallCards = await list({ itemType: "CARD", kessenGoods: "only" });
    expect(stallCards.map((row) => row.id)).toEqual([C1]);
    const general = await list({ itemType: "CONSUMABLE", kessenGoods: "exclude" });
    expect(general.map((row) => row.id)).toEqual(["potion"]);
    // A stall pack opens through the item page with its generated pools.
    await insertUserItems([
      { id: "paper-stack", userId: USER, itemId: paper.id, quantity: 1 },
    ]);
    const opened = await callerForDatabase(kessenCollectionRouter, USER, db).openPack({
      userItemId: "paper-stack",
      requestId: "paper-open-0001",
    });
    if (!opened.success || !("reveal" in opened)) throw new Error(opened.message);
    expect(opened.reveal?.cards).toHaveLength(5);
    expect(opened.cacheRewards?.map((cache) => cache.displayName)).toEqual([
      "Paper Bundle",
      "Paper Bundle: fifth card",
    ]);
  });
});
