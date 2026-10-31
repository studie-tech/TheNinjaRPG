import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { CRAFTING_REQUIRED_EXP, HOME_FURNITURE_STORAGE_CAPACITY } from "@/drizzle/constants";
import { actionLog, auctionOffer, craftingRequirement, farmCollectionLog, farmPlot, item, userData, userItem, userItemImbuement, userQueue, storeUserIdAlias } from "@/drizzle/schema";
import { occupationRouter } from "@/server/api/routers/occupation";
import { auctionRouter } from "@/server/api/routers/auction";
import { farmingRouter } from "@/server/api/routers/farming";
import { homeRouter } from "@/server/api/routers/home";
import * as nativePush from "@/server/utils/push/defer";
import { tradeUpdate } from "@/server/utils/push/messages";
import { beforeStatements, failStatements } from "../../../../setup/statements";
import type { DrizzleClient } from "@/server/db";
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

describeWithDatabase("Auction House fixed-term requests and trades", () => {
  const queuePush = vi.fn();
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    queuePush.mockReset();
    vi.spyOn(nativePush, "deferPushToUsers").mockImplementation(queuePush);
    await resetTables(storeUserIdAlias, actionLog, auctionOffer, farmCollectionLog, farmPlot, userQueue, craftingRequirement, userItemImbuement, userItem, item, userData);
    await insertUsers([
      { userId: "owner", username: "Requester", level: 50, bank: 1000 },
      { userId: "supplier", username: "Supplier", level: 50, bank: 100 },
      { userId: "rival", username: "Rival", level: 50, bank: 100 },
    ]);
    await insertItems([
      { id: "ore", name: "Silver ore", canBeTraded: true, canStack: true, stackSize: 100, auctionMinPrice: 1, auctionMaxPrice: 100 },
      { id: "gem", name: "Unobtanium", canBeTraded: true, canStack: true, stackSize: 100 },
      { id: "sword", name: "Sword", itemType: "WEAPON", canBeTraded: true, canStack: false },
      { id: "bound", name: "Bound material", canBeTraded: false, canStack: true },
    ]);
    await insertUserItems([
      { id: "owner-gems", userId: "owner", itemId: "gem", quantity: 50, activeVariantId: "cosmetic" },
      { id: "supplier-ore", userId: "supplier", itemId: "ore", quantity: 100 },
      { id: "rival-ore", userId: "rival", itemId: "ore", quantity: 100 },
      { id: "supplier-sword", userId: "supplier", itemId: "sword", level: 8, experience: 123, durability: 60, activeVariantId: "cosmetic" },
    ]);
  });

  const postRequest = async (ryo = 300, quantity = 10) => {
    const api = await callerFor(auctionRouter, "owner");
    const result = await api.createAuctionOffer({ offerType: "REQUEST", requestedItemId: "ore", requestedQuantity: quantity, ryo });
    expect(result.success).toBe(true);
    const rows = await (await getTestDatabase()).select().from(auctionOffer);
    return rows[0]!;
  };
  const postTrade = async (quantity = 20, requestedItemId = "ore", requestedQuantity = 10) => {
    const api = await callerFor(auctionRouter, "owner");
    const result = await api.createAuctionOffer({ offerType: "TRADE", requestedItemId, requestedQuantity, offeredUserItemId: "owner-gems", offeredQuantity: quantity });
    expect(result.success).toBe(true);
    const rows = await (await getTestDatabase()).select().from(auctionOffer);
    return rows[0]!;
  };
  const balances = async () => {
    const rows = await (await getTestDatabase()).select().from(userData);
    return Object.fromEntries(rows.map((row) => [row.userId, row.bank]));
  };
  const prepareImbuing = async (quantity = 1) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ status: "AWAKE", sector: 1, occupation: "CRAFTING", craftingExperience: CRAFTING_REQUIRED_EXP.APPRENTICE, updatedAt: new Date(Date.now() - 60000) }).where(eq(userData.userId, "owner"));
    await db.update(item).set({ canBeImbued: true }).where(eq(item.id, "sword"));
    await insertItems([{ id: "crystal", name: "Crystal", itemType: "CRYSTAL", canBeTraded: true, canStack: quantity > 1, crystalTargetTypes: "WEAPON", craftingExperience: 20 }]);
    await insertUserItems([{ id: "owner-crystal", userId: "owner", itemId: "crystal", quantity }, { id: "owner-sword", userId: "owner", itemId: "sword" }]);
  };
  const postCrystalTrade = async (quantity = 1) => {
    const owner = await callerFor(auctionRouter, "owner");
    expect((await owner.createAuctionOffer({ offerType: "TRADE", requestedItemId: "ore", requestedQuantity: 1, offeredUserItemId: "owner-crystal", offeredQuantity: quantity })).success).toBe(true);
    return (await (await getTestDatabase()).select().from(auctionOffer))[0]!;
  };
  const prepareQueuedCraft = async (quantity: number) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ status: "AWAKE", sector: 1, occupation: "CRAFTING", craftingExperience: 100000, federalStatus: "GOLD", updatedAt: new Date(Date.now() - 60000) }).where(eq(userData.userId, "owner"));
    await insertItems([{ id: "output", name: "Crafted sword", itemType: "WEAPON", canBeCrafted: true, canStack: false, stackSize: 1 }]);
    await insertUserItems([{ id: "owner-ore", userId: "owner", itemId: "ore", quantity: 10 }, { id: "running-craft", userId: "owner", itemId: "output", craftingFinishedAt: new Date(Date.now() + 3600000) }]);
    await db.insert(craftingRequirement).values({ id: "ore-requirement", craftItemId: "output", requirementItemId: "ore", quantity });
  };
  const postCraftMaterialTrade = async () => {
    const owner = await callerFor(auctionRouter, "owner");
    expect((await owner.createAuctionOffer({ offerType: "TRADE", requestedItemId: "ore", requestedQuantity: 1, offeredUserItemId: "owner-ore", offeredQuantity: 10 })).success).toBe(true);
  };

  it("reserves a request's bank funds, transfers only the requested quantity and pays once", async () => {
    const offer = await postRequest();
    expect(await balances()).toMatchObject({ owner: 700, supplier: 100 });
    const supplier = await callerFor(auctionRouter, "supplier");
    expect((await supplier.acceptAuctionOffer({ offerId: offer.id, userItemId: "supplier-ore" })).success).toBe(true);
    expect((await supplier.acceptAuctionOffer({ offerId: offer.id, userItemId: "supplier-ore" })).success).toBe(false);
    expect(await balances()).toMatchObject({ owner: 700, supplier: 400 });
    const rows = await (await getTestDatabase()).select().from(userItem).where(eq(userItem.itemId, "ore"));
    expect(rows.find((row) => row.userId === "owner")?.quantity).toBe(10);
    expect(rows.find((row) => row.id === "supplier-ore")?.quantity).toBe(90);
    const logs = await (await getTestDatabase()).select().from(actionLog);
    expect(logs).toHaveLength(2);
    expect(queuePush).toHaveBeenCalledTimes(1);
    expect(queuePush).toHaveBeenCalledWith(expect.anything(), ["owner"], tradeUpdate(offer.id));
  });

  it("refunds cancellation exactly once and requires ownership", async () => {
    const offer = await postRequest();
    const rival = await callerFor(auctionRouter, "rival");
    expect((await rival.cancelAuctionOffer({ offerId: offer.id })).success).toBe(false);
    const owner = await callerFor(auctionRouter, "owner");
    const results = await Promise.all([owner.cancelAuctionOffer({ offerId: offer.id }), owner.cancelAuctionOffer({ offerId: offer.id })]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect((await balances()).owner).toBe(1000);
  });

  it("cannot overspend when two requests compete for the bank balance", async () => {
    const api = await callerFor(auctionRouter, "owner");
    const input = { offerType: "REQUEST" as const, requestedItemId: "ore", requestedQuantity: 10, ryo: 800 };
    const results = await Promise.all([api.createAuctionOffer(input), api.createAuctionOffer(input)]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect((await balances()).owner).toBe(200);
    expect(await (await getTestDatabase()).select().from(auctionOffer)).toHaveLength(1);
  });

  it("two suppliers racing for one request exchange exactly once", async () => {
    const offer = await postRequest();
    const [supplier, rival] = await Promise.all([callerFor(auctionRouter, "supplier"), callerFor(auctionRouter, "rival")]);
    const results = await Promise.all([supplier.acceptAuctionOffer({ offerId: offer.id, userItemId: "supplier-ore" }), rival.acceptAuctionOffer({ offerId: offer.id, userItemId: "rival-ore" })]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const bank = await balances();
    expect(queuePush).toHaveBeenCalledTimes(1);
    expect(bank.owner).toBe(700);
    expect((bank.supplier ?? 0) + (bank.rival ?? 0)).toBe(500);
    const rows = await (await getTestDatabase()).select().from(userItem).where(eq(userItem.itemId, "ore"));
    expect(rows.filter((row) => row.userId === "owner").reduce((sum, row) => sum + row.quantity, 0)).toBe(10);
    expect(rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(200);
  });

  it("accept racing cancellation either refunds or pays, without losing or duplicating value", async () => {
    const offer = await postRequest();
    const [owner, supplier] = await Promise.all([callerFor(auctionRouter, "owner"), callerFor(auctionRouter, "supplier")]);
    const [cancel, accept] = await Promise.all([owner.cancelAuctionOffer({ offerId: offer.id }), supplier.acceptAuctionOffer({ offerId: offer.id, userItemId: "supplier-ore" })]);
    expect(Number(cancel.success) + Number(accept.success)).toBe(1);
    const bank = await balances();
    expect((bank.owner ?? 0) + (bank.supplier ?? 0)).toBe(1100);
    expect(bank.owner).toBe(cancel.success ? 1000 : 700);
    const rows = await (await getTestDatabase()).select().from(userItem).where(eq(userItem.userId, "owner"));
    expect(rows.some((row) => row.itemId === "ore")).toBe(accept.success);
  });

  it("reserves a partial trade stack and transfers both sides while clearing cosmetics", async () => {
    const offer = await postTrade();
    const db = await getTestDatabase();
    const initial = await db.select().from(userItem).where(eq(userItem.userId, "owner"));
    expect(initial.find((row) => row.id === "owner-gems")?.quantity).toBe(30);
    expect(initial.find((row) => row.id === offer.offeredUserItemId)).toMatchObject({ quantity: 20, isInAuction: true, activeVariantId: "cosmetic" });
    const supplier = await callerFor(auctionRouter, "supplier");
    expect((await supplier.acceptAuctionOffer({ offerId: offer.id, userItemId: "supplier-ore" })).success).toBe(true);
    const transferred = await db.select().from(userItem).where(eq(userItem.id, offer.offeredUserItemId!));
    expect(transferred[0]).toMatchObject({ userId: "supplier", quantity: 20, isInAuction: false, activeVariantId: null });
    expect(await balances()).toMatchObject({ owner: 1000, supplier: 100 });
  });

  it("releases the reserved trade stack on cancellation", async () => {
    const offer = await postTrade();
    const owner = await callerFor(auctionRouter, "owner");
    expect((await owner.cancelAuctionOffer({ offerId: offer.id })).success).toBe(true);
    const rows = await (await getTestDatabase()).select().from(userItem).where(eq(userItem.userId, "owner"));
    expect(rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(50);
    expect(rows.every((row) => !row.isInAuction)).toBe(true);
  });

  it("reclaims a trade stack changed by an in-flight farm harvest without accepting changed terms", async () => {
    const db = await getTestDatabase();
    await db.update(item).set({ farmSellValue: 40 }).where(eq(item.id, "gem"));
    await insertItems([{ id: "seed", name: "Seed", canStack: true, isFarmSeed: true, farmYieldItemId: "gem" }]);
    await db.insert(farmPlot).values({ id: "ready-plot", userId: "owner", slotIndex: 0, seedItemId: "seed", plantedAt: new Date(0), finishAt: new Date(0) });
    // Reserve the full stack after harvest snapshots the inventory, before its fill writes.
    const harvestDb = beforeStatements(db, userItem, [() => postTrade(50)]);
    const farmer = callerForDatabase(farmingRouter, "owner", harvestDb);
    expect((await farmer.harvestPlot({ plotId: "ready-plot" })).success).toBe(true);
    const [offer] = await db.select().from(auctionOffer);
    expect(offer?.offeredQuantity).toBe(50);
    expect((await db.select().from(userItem).where(eq(userItem.id, "owner-gems")))[0]).toMatchObject({ quantity: 51, isInAuction: true });
    const supplier = await callerFor(auctionRouter, "supplier");
    expect(await supplier.acceptAuctionOffer({ offerId: offer!.id, userItemId: "supplier-ore" })).toMatchObject({ success: false, message: "Offered item is no longer available" });
    const rival = await callerFor(auctionRouter, "rival");
    expect((await rival.cancelAuctionOffer({ offerId: offer!.id })).success).toBe(false);
    expect((await db.select().from(auctionOffer))[0]?.status).toBe("ACTIVE");
    const owner = await callerFor(auctionRouter, "owner");
    expect((await owner.cancelAuctionOffer({ offerId: offer!.id })).success).toBe(true);
    expect((await owner.cancelAuctionOffer({ offerId: offer!.id })).success).toBe(false);
    expect((await db.select().from(auctionOffer))[0]?.status).toBe("CANCELLED");
    expect((await db.select().from(userItem).where(eq(userItem.id, "owner-gems")))[0]).toMatchObject({ userId: "owner", quantity: 51, isInAuction: false, activeVariantId: "cosmetic" });
    expect((await db.select().from(userItem).where(eq(userItem.id, "supplier-ore")))[0]?.quantity).toBe(100);
    expect(await balances()).toMatchObject({ owner: 1000, supplier: 100, rival: 100 });
    expect(await db.select().from(actionLog)).toHaveLength(2);
  });

  it("can trade materials for equipment while preserving progression, durability and imbuements", async () => {
    const db = await getTestDatabase();
    await db.insert(userItemImbuement).values({ id: "imbuement", userItemId: "supplier-sword", imbuementItemId: "gem", craftingFinishedAt: new Date(0) });
    const offer = await postTrade(50, "sword", 1);
    const supplier = await callerFor(auctionRouter, "supplier");
    expect((await supplier.acceptAuctionOffer({ offerId: offer.id, userItemId: "supplier-sword" })).success).toBe(true);
    const rows = await db.select().from(userItem).where(eq(userItem.id, "supplier-sword"));
    expect(rows[0]).toMatchObject({ userId: "owner", level: 8, experience: 123, durability: 60, activeVariantId: null });
    expect(await db.select().from(userItemImbuement)).toHaveLength(1);
  });

  it("trades placed furniture without carrying its room position to the new owner", async () => {
    await insertItems([{ id: "chair", name: "Chair", itemType: "FURNITURE", canBeTraded: true, canStack: false }]);
    await insertUserItems([{ id: "supplier-chair", userId: "supplier", itemId: "chair", homeX: 24, homeY: 68, homeRotation: 1 }]);
    const offer = await postTrade(50, "chair", 1);
    const supplier = await callerFor(auctionRouter, "supplier");
    expect((await supplier.acceptAuctionOffer({ offerId: offer.id, userItemId: "supplier-chair" })).success).toBe(true);
    const [transferred] = await (await getTestDatabase()).select().from(userItem).where(eq(userItem.id, "supplier-chair"));
    expect(transferred).toMatchObject({ userId: "owner", homeX: null, homeY: null, homeRotation: 0 });
  });

  it("preserves a concurrent room move when furniture is reserved and released by its owner", async () => {
    await insertItems([{ id: "chair", name: "Chair", itemType: "FURNITURE", canBeTraded: true, canStack: false }]);
    await insertUserItems([{ id: "owner-chair", userId: "owner", itemId: "chair", homeX: 24, homeY: 68 }]);
    const database = await getTestDatabase();
    const reservationDatabase = new Proxy(database, {
      get(target, key, receiver) {
        if (key !== "transaction") return Reflect.get(target, key, receiver);
        return (work: Parameters<DrizzleClient["transaction"]>[0]) => target.transaction((tx) => work(beforeStatements(tx as DrizzleClient, userItem, [async () => {
          await database.update(userItem).set({ homeX: 31, homeY: 72, homeRotation: 1 }).where(eq(userItem.id, "owner-chair"));
        }]) as typeof tx));
      },
    });
    const owner = callerForDatabase(auctionRouter, "owner", reservationDatabase);
    expect((await owner.createAuctionOffer({ offerType: "TRADE", requestedItemId: "ore", requestedQuantity: 1, offeredUserItemId: "owner-chair", offeredQuantity: 1 })).success).toBe(true);
    const [offer] = await database.select().from(auctionOffer);
    const cancellation = await callerFor(auctionRouter, "owner");
    expect((await cancellation.cancelAuctionOffer({ offerId: offer!.id })).success).toBe(true);
    const [returned] = await database.select().from(userItem).where(eq(userItem.id, "owner-chair"));
    expect(returned).toMatchObject({ userId: "owner", isInAuction: false, homeX: 31, homeY: 72, homeRotation: 1 });
  });

  it.each([false, true])("keeps a placed furniture trade fulfillable after a home downgrade with full storage %s", async (isStorageFull) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ homeType: "TOWN_HOUSE" }).where(eq(userData.userId, "owner"));
    await insertItems([{ id: "chair", name: "Chair", itemType: "FURNITURE", canBeTraded: true, canStack: false }]);
    await insertUserItems([
      { id: "offered-chair", userId: "owner", itemId: "chair", homeRoom: "room-4", homeX: 24, homeY: 68, homeRotation: 1 },
      { id: "ordinary-chair", userId: "owner", itemId: "chair", storedAtHome: isStorageFull, homeRoom: "room-4", homeX: 60, homeY: 60 },
      ...Array.from({ length: isStorageFull ? HOME_FURNITURE_STORAGE_CAPACITY - 1 : 0 }, (_, i) => ({ id: `stored-chair-${i}`, userId: "owner", itemId: "chair", storedAtHome: true })),
    ]);
    const owner = await callerFor(auctionRouter, "owner");
    expect((await owner.createAuctionOffer({ offerType: "TRADE", requestedItemId: "ore", requestedQuantity: 1, offeredUserItemId: "offered-chair", offeredQuantity: 1 })).success).toBe(true);
    const [offer] = await db.select().from(auctionOffer);
    expect((await db.select().from(userItem).where(eq(userItem.id, "offered-chair")))[0]).toMatchObject({ isInAuction: true, storedAtHome: false, homeRoom: "room-4", homeX: 24, homeY: 68 });
    const home = await callerFor(homeRouter, "owner");
    expect((await home.upgradeHome({ homeType: "TWO_BED_HOUSE" })).success).toBe(true);
    const removed = await db.select().from(userItem).where(eq(userItem.itemId, "chair"));
    expect(removed.filter(({ storedAtHome }) => storedAtHome)).toHaveLength(isStorageFull ? HOME_FURNITURE_STORAGE_CAPACITY : 1);
    const supplier = await callerFor(auctionRouter, "supplier");
    expect((await supplier.acceptAuctionOffer({ offerId: offer!.id, userItemId: "supplier-ore" })).success).toBe(true);
    expect(removed.find(({ id }) => id === "offered-chair")).toMatchObject({ userId: "owner", isInAuction: true, storedAtHome: false, homeRoom: "main", homeX: null, homeY: null, homeRotation: 0 });
    expect(removed.find(({ id }) => id === "ordinary-chair")).toMatchObject({ userId: "owner", isInAuction: false, storedAtHome: true, homeRoom: "main", homeX: null, homeY: null, homeRotation: 0 });
    expect((await db.select().from(userItem).where(eq(userItem.id, "offered-chair")))[0]).toMatchObject({ userId: "supplier", isInAuction: false, storedAtHome: false, homeX: null, homeY: null });
    expect((await db.select().from(auctionOffer))[0]?.status).toBe("SOLD");
  });

  it("keeps reserved trade items out of home storage so the offer stays fulfillable", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ homeType: "TOWN_HOUSE" }).where(eq(userData.userId, "owner"));
    const offer = await postTrade(50);
    const home = await callerFor(homeRouter, "owner");
    expect(await home.toggleStoreItem({ userItemId: "owner-gems" })).toMatchObject({ success: false, message: "This item is reserved in an auction or trade offer and can't be stored" });
    expect((await db.select().from(userItem).where(eq(userItem.id, "owner-gems")))[0]).toMatchObject({ isInAuction: true, storedAtHome: false });
    const supplier = await callerFor(auctionRouter, "supplier");
    expect((await supplier.acceptAuctionOffer({ offerId: offer.id, userItemId: "supplier-ore" })).success).toBe(true);
  });

  it("explains a stored reserved item on accept and lets its owner retrieve it to recover the offer", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ homeType: "TOWN_HOUSE" }).where(eq(userData.userId, "owner"));
    const offer = await postTrade(50);
    // Rows stored before the escrow guard existed.
    await db.update(userItem).set({ storedAtHome: true }).where(eq(userItem.id, "owner-gems"));
    const supplier = await callerFor(auctionRouter, "supplier");
    expect(await supplier.acceptAuctionOffer({ offerId: offer.id, userItemId: "supplier-ore" })).toMatchObject({ success: false, message: "The seller's offered item is currently unavailable; ask them to retrieve it or cancel the offer" });
    expect((await db.select().from(auctionOffer))[0]?.status).toBe("ACTIVE");
    const home = await callerFor(homeRouter, "owner");
    expect((await home.toggleStoreItem({ userItemId: "owner-gems" })).success).toBe(true);
    expect((await db.select().from(userItem).where(eq(userItem.id, "owner-gems")))[0]).toMatchObject({ isInAuction: true, storedAtHome: false });
    expect((await supplier.acceptAuctionOffer({ offerId: offer.id, userItemId: "supplier-ore" })).success).toBe(true);
    expect((await db.select().from(userItem).where(eq(userItem.id, "owner-gems")))[0]).toMatchObject({ userId: "supplier", isInAuction: false, storedAtHome: false });
  });

  it("rejects unavailable inventory, insufficient quantities and mismatched items", async () => {
    const offer = await postRequest();
    const db = await getTestDatabase();
    const supplier = await callerFor(auctionRouter, "supplier");
    for (const changes of [{ equipped: "ITEM_1" as const }, { storedAtHome: true }, { isInAuction: true }, { quantity: 9 }, { quantity: -100 }, { craftingFinishedAt: new Date(Date.now() + 60000) }]) {
      await db.update(userItem).set({ equipped: "NONE", storedAtHome: false, isInAuction: false, quantity: 100, craftingFinishedAt: null, ...changes }).where(eq(userItem.id, "supplier-ore"));
      expect((await supplier.acceptAuctionOffer({ offerId: offer.id, userItemId: "supplier-ore" })).success).toBe(false);
    }
    expect((await supplier.acceptAuctionOffer({ offerId: offer.id, userItemId: "supplier-sword" })).success).toBe(false);
    expect((await balances()).supplier).toBe(100);
  });

  it("rejects active imbuements and does not split completed imbuements", async () => {
    const db = await getTestDatabase();
    await db.insert(userItemImbuement).values({ id: "imbuement", userItemId: "owner-gems", imbuementItemId: "ore", craftingFinishedAt: new Date(Date.now() + 60000) });
    const owner = await callerFor(auctionRouter, "owner");
    const input = { offerType: "TRADE" as const, requestedItemId: "ore", requestedQuantity: 1, offeredUserItemId: "owner-gems", offeredQuantity: 20 };
    expect((await owner.createAuctionOffer(input)).success).toBe(false);
    await db.update(userItemImbuement).set({ craftingFinishedAt: new Date(0) }).where(eq(userItemImbuement.id, "imbuement"));
    expect((await owner.createAuctionOffer(input)).success).toBe(false);
  });

  it("rejects self-acceptance, banned accounts and low-level users, but allows refunds", async () => {
    const offer = await postRequest();
    const db = await getTestDatabase();
    const owner = await callerFor(auctionRouter, "owner");
    expect((await owner.acceptAuctionOffer({ offerId: offer.id, userItemId: "owner-gems" })).success).toBe(false);
    const supplier = await callerFor(auctionRouter, "supplier");
    for (const changes of [{ isTradeBanned: true }, { isBanned: true }, { level: 1 }]) {
      await db.update(userData).set({ isTradeBanned: false, isBanned: false, level: 50, ...changes }).where(eq(userData.userId, "supplier"));
      expect((await supplier.acceptAuctionOffer({ offerId: offer.id, userItemId: "supplier-ore" })).success).toBe(false);
    }
    await db.update(userData).set({ isTradeBanned: true }).where(eq(userData.userId, "owner"));
    expect((await owner.cancelAuctionOffer({ offerId: offer.id })).success).toBe(true);
    expect((await balances()).owner).toBe(1000);
  });

  it("enforces tradability, material-only requests, price bounds and stack quantities", async () => {
    const owner = await callerFor(auctionRouter, "owner");
    const input = { offerType: "REQUEST" as const, requestedItemId: "ore", requestedQuantity: 10, ryo: 300 };
    for (const changes of [{ requestedItemId: "bound" }, { requestedItemId: "sword" }, { ryo: 9 }, { ryo: 1001 }]) expect((await owner.createAuctionOffer({ ...input, ...changes })).success).toBe(false);
    expect((await owner.createAuctionOffer({ offerType: "TRADE", requestedItemId: "sword", requestedQuantity: 2, offeredUserItemId: "owner-gems", offeredQuantity: 20 })).success).toBe(false);
    expect(await (await getTestDatabase()).select().from(auctionOffer)).toHaveLength(0);
    expect((await balances()).owner).toBe(1000);
  });

  it("rolls back acceptance if the reserved trade item is no longer tradable", async () => {
    const offer = await postTrade();
    const db = await getTestDatabase();
    await db.update(item).set({ canBeTraded: false }).where(eq(item.id, "gem"));
    const supplier = await callerFor(auctionRouter, "supplier");
    expect((await supplier.acceptAuctionOffer({ offerId: offer.id, userItemId: "supplier-ore" })).success).toBe(false);
    const rows = await db.select().from(userItem).where(eq(userItem.id, "supplier-ore"));
    expect(rows[0]?.quantity).toBe(100);
    expect((await db.select().from(auctionOffer))[0]?.status).toBe("ACTIVE");
  });

  it("rolls back a split, offer claim and payment if delivery fails", async () => {
    const offer = await postTrade();
    const db = await getTestDatabase();
    const failed = new Proxy(db, {
      get(target, key, receiver) {
        if (key === "transaction") return (work: Parameters<DrizzleClient["transaction"]>[0]) => target.transaction((tx) => work(failStatements(tx as DrizzleClient, actionLog) as typeof tx));
        return Reflect.get(target, key, receiver);
      },
    });
    const supplier = callerForDatabase(auctionRouter, "supplier", failed);
    await expect(supplier.acceptAuctionOffer({ offerId: offer.id, userItemId: "supplier-ore" })).rejects.toThrow("Statement failed on purpose");
    expect(queuePush).not.toHaveBeenCalled();
    expect((await db.select().from(auctionOffer))[0]?.status).toBe("ACTIVE");
    expect(await db.select().from(userItem)).toHaveLength(5);
    expect(await balances()).toMatchObject({ owner: 1000, supplier: 100 });
    expect((await db.select().from(userItem).where(eq(userItem.id, "supplier-ore")))[0]?.quantity).toBe(100);
    expect((await db.select().from(userItem).where(eq(userItem.id, offer.offeredUserItemId ?? "")))[0]?.isInAuction).toBe(true);
  });

  it("rolls back a bank reservation if creating the offer fails", async () => {
    const db = await getTestDatabase();
    const failed = new Proxy(db, {
      get(target, key, receiver) {
        if (key === "transaction") return (work: Parameters<DrizzleClient["transaction"]>[0]) => target.transaction((tx) => work(failStatements(tx as DrizzleClient, auctionOffer) as typeof tx));
        return Reflect.get(target, key, receiver);
      },
    });
    const owner = callerForDatabase(auctionRouter, "owner", failed);
    await expect(owner.createAuctionOffer({ offerType: "REQUEST", requestedItemId: "ore", requestedQuantity: 10, ryo: 300 })).rejects.toThrow("Statement failed on purpose");
    expect((await balances()).owner).toBe(1000);
    expect(await db.select().from(auctionOffer)).toHaveLength(0);
  });

  it("blocks imbuement removal from reserved items", async () => {
    const db = await getTestDatabase();
    await db.insert(userItemImbuement).values({ id: "reserved-imbuement", userItemId: "owner-gems", imbuementItemId: "ore", craftingFinishedAt: new Date(0) });
    await postTrade(50);
    const owner = await callerFor(occupationRouter, "owner");
    expect((await owner.removeImbuement({ userItemImbuementId: "reserved-imbuement" })).success).toBe(false);
    expect(await db.select().from(userItemImbuement)).toHaveLength(1);
  });

  it("preserves a reserved crystal and permits imbuing after the trade is cancelled", async () => {
    await prepareImbuing();
    const offer = await postCrystalTrade();
    const db = await getTestDatabase();
    const [userBefore] = await db.select().from(userData).where(eq(userData.userId, "owner"));
    const [targetBefore] = await db.select().from(userItem).where(eq(userItem.id, "owner-sword"));
    const crafter = await callerFor(occupationRouter, "owner");
    const input = { userItemId: "owner-sword", userCrystalItemId: "owner-crystal" };
    expect(await crafter.imbueItem(input)).toMatchObject({ success: false, message: "Cannot use a crystal reserved for auction or trade" });
    expect((await db.select().from(userItem).where(eq(userItem.id, "owner-crystal")))[0]).toMatchObject({ quantity: 1, isInAuction: true });
    expect((await db.select().from(userData).where(eq(userData.userId, "owner")))[0]).toMatchObject({ craftingExperience: userBefore!.craftingExperience, money: userBefore!.money, bank: userBefore!.bank });
    expect((await db.select().from(userItem).where(eq(userItem.id, "owner-sword")))[0]).toEqual(targetBefore);
    expect(await db.select().from(userItemImbuement)).toHaveLength(0);
    const owner = await callerFor(auctionRouter, "owner");
    expect((await owner.cancelAuctionOffer({ offerId: offer.id })).success).toBe(true);
    expect((await crafter.imbueItem(input)).success).toBe(true);
    expect(await db.select().from(userItem).where(eq(userItem.id, "owner-crystal"))).toHaveLength(0);
    expect(await db.select().from(userItemImbuement)).toHaveLength(1);
    expect((await db.select().from(userData).where(eq(userData.userId, "owner")))[0]?.craftingExperience).toBe(CRAFTING_REQUIRED_EXP.APPRENTICE + 10);
  });

  for (const quantity of [1, 2]) {
    it(`does not consume a ${quantity}-crystal stack reserved after the imbue snapshot`, async () => {
      await prepareImbuing(quantity);
      const db = await getTestDatabase();
      // Reserve after the target guard but before the crystal's delete or decrement executes.
      const imbueDb = beforeStatements(db, userItem, [async () => {}, () => postCrystalTrade(quantity)]);
      const crafter = callerForDatabase(occupationRouter, "owner", imbueDb);
      expect(await crafter.imbueItem({ userItemId: "owner-sword", userCrystalItemId: "owner-crystal" })).toMatchObject({ success: false, message: "Crystal no longer available" });
      expect((await db.select().from(userItem).where(eq(userItem.id, "owner-crystal")))[0]).toMatchObject({ quantity, isInAuction: true });
      expect(await db.select().from(userItemImbuement)).toHaveLength(0);
      expect((await db.select().from(userData).where(eq(userData.userId, "owner")))[0]?.craftingExperience).toBe(CRAFTING_REQUIRED_EXP.APPRENTICE);
      const [offer] = await db.select().from(auctionOffer);
      const supplier = await callerFor(auctionRouter, "supplier");
      expect((await supplier.acceptAuctionOffer({ offerId: offer!.id, userItemId: "supplier-ore" })).success).toBe(true);
      expect((await db.select().from(userItem).where(eq(userItem.id, "owner-crystal")))[0]).toMatchObject({ quantity, userId: "supplier", isInAuction: false });
      expect((await db.select().from(auctionOffer))[0]?.status).toBe("SOLD");
    });
  }

  for (const quantity of [5, 10]) {
    it(`preserves material escrow reserved before a queued craft consumes ${quantity} of 10 items`, async () => {
      await prepareQueuedCraft(quantity);
      const db = await getTestDatabase();
      // Reserve after the craft claims its user snapshot, before the material write.
      const craftDb = beforeStatements(db, userItem, [postCraftMaterialTrade]);
      const crafter = callerForDatabase(occupationRouter, "owner", craftDb);
      expect(await crafter.craftItem({ itemId: "output", quantity: 1 })).toMatchObject({ success: false, message: "Could not start crafting — materials changed, please try again" });
      expect((await db.select().from(userItem).where(eq(userItem.id, "owner-ore")))[0]).toMatchObject({ quantity: 10, isInAuction: true });
      expect(await db.select().from(userQueue)).toHaveLength(0);
      const [offer] = await db.select().from(auctionOffer);
      expect(offer).toMatchObject({ status: "ACTIVE", offeredQuantity: 10 });
      const owner = await callerFor(auctionRouter, "owner");
      expect((await owner.cancelAuctionOffer({ offerId: offer!.id })).success).toBe(true);
      expect((await db.select().from(userItem).where(eq(userItem.id, "owner-ore")))[0]).toMatchObject({ quantity: 10, isInAuction: false });
      expect((await crafter.craftItem({ itemId: "output", quantity: 1 })).success).toBe(true);
      expect(await db.select().from(userQueue)).toHaveLength(1);
    });
  }

  it("returns other consumed materials when a queued craft loses a material stack to trade escrow", async () => {
    await prepareQueuedCraft(10);
    const db = await getTestDatabase();
    await db.insert(craftingRequirement).values({ id: "gem-requirement", craftItemId: "output", requirementItemId: "gem", quantity: 3 });
    let finishReservation!: () => void;
    const reserved = new Promise<void>((resolve) => { finishReservation = resolve; });
    const craftDb = beforeStatements(db, userItem, [async () => {
      try { await postCraftMaterialTrade(); } finally { finishReservation(); }
    }, () => reserved, async () => {
      // The other material was taken; this statement returns it after the conflict.
      expect((await db.select().from(userItem).where(eq(userItem.id, "owner-gems")))[0]?.quantity).toBe(47);
    }]);
    const crafter = callerForDatabase(occupationRouter, "owner", craftDb);
    expect(await crafter.craftItem({ itemId: "output", quantity: 1 })).toMatchObject({ success: false, message: "Could not start crafting — materials changed, please try again" });
    expect((await db.select().from(userItem).where(eq(userItem.id, "owner-gems")))[0]).toMatchObject({ quantity: 50, isInAuction: false });
    expect((await db.select().from(userItem).where(eq(userItem.id, "owner-ore")))[0]).toMatchObject({ quantity: 10, isInAuction: true });
    expect(await db.select().from(userQueue)).toHaveLength(0);
    const [offer] = await db.select().from(auctionOffer);
    const owner = await callerFor(auctionRouter, "owner");
    expect((await owner.cancelAuctionOffer({ offerId: offer!.id })).success).toBe(true);
  });

  it("rejects a retired account identity while allowing its escrow refund", async () => {
    const offer = await postRequest();
    const db = await getTestDatabase();
    await db.insert(storeUserIdAlias).values([{ oldUserId: "supplier", newUserId: "renamed" }, { oldUserId: "owner", newUserId: "renamed-owner" }]);
    const supplier = await callerFor(auctionRouter, "supplier");
    expect((await supplier.acceptAuctionOffer({ offerId: offer.id, userItemId: "supplier-ore" })).success).toBe(false);
    expect((await db.select().from(auctionOffer))[0]?.status).toBe("ACTIVE");
    const owner = await callerFor(auctionRouter, "owner");
    expect((await owner.cancelAuctionOffer({ offerId: offer.id })).success).toBe(true);
    expect((await balances()).owner).toBe(1000);
  });

  it("filters by requested name, offer type, status, ownership and paginates", async () => {
    await postRequest();
    await postTrade();
    const owner = await callerFor(auctionRouter, "owner");
    expect((await owner.getAuctionOffers({ offerType: "REQUEST", search: "Silver" })).data).toHaveLength(1);
    expect((await owner.getAuctionOffers({ offerType: "REQUEST", search: "no match" })).data).toHaveLength(0);
    const supplier = await callerFor(auctionRouter, "supplier");
    expect((await supplier.getAuctionOffers({ offerType: "REQUEST", onlyMine: true })).data).toHaveLength(0);
    await postRequest();
    const page = await owner.getAuctionOffers({ offerType: "REQUEST", limit: 1 });
    expect(page.nextCursor).toBe(1);
    expect((await owner.getAuctionOffers({ offerType: "REQUEST", limit: 1, cursor: 1 })).nextCursor).toBeNull();
    expect((await owner.getAuctionOffers({ offerType: "REQUEST", status: "SOLD" })).data).toHaveLength(0);
  });
});
