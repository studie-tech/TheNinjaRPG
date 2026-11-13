import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { and, eq } from "drizzle-orm";
import { GET as expireAuctions } from "@/app/api/auction-expire/route";
import { AUCTION_HOUSE_MIN_LEVEL } from "@/drizzle/constants";
import {
  actionLog,
  auctionBid,
  auctionListing,
  auctionOffer,
  gameSetting,
  item,
  userData,
  userItem,
} from "@/drizzle/schema";
import { auctionRouter, mergeDeliveredItems } from "@/server/api/routers/auction";
import * as itemStacks from "@/server/utils/itemStacks";
import * as nativePush from "@/server/utils/push/defer";
import { restoreEnvAfterEach } from "../../../../setup/env";
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import { aroundStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase(
  "items coming back from the Auction House join carried stacks",
  () => {
    restoreEnvAfterEach("CRON_SECRET");
    afterEach(() => vi.restoreAllMocks());
    beforeEach(async () => {
      process.env.CRON_SECRET = "auction-cron";
      vi.spyOn(nativePush, "deferPushToUsers").mockImplementation(() => {});
      await resetTables(
        actionLog,
        auctionBid,
        auctionListing,
        auctionOffer,
        gameSetting,
        userItem,
        item,
        userData,
      );
      await insertUsers(
        ["seller", "buyer"].map((userId) => ({
          userId,
          username: userId,
          level: AUCTION_HOUSE_MIN_LEVEL,
          money: 1000,
          bank: 1000,
          status: "AWAKE" as const,
        })),
      );
      await insertItems([
        {
          id: "ore",
          name: "Silver ore",
          canBeTraded: true,
          canStack: true,
          stackSize: 100,
          auctionMinPrice: 1,
          auctionMaxPrice: 100,
        },
        {
          id: "gem",
          name: "Gem",
          canBeTraded: true,
          canStack: true,
          stackSize: 100,
        },
      ]);
      await insertUserItems([
        { id: "seller-ore", userId: "seller", itemId: "ore", quantity: 10 },
        { id: "seller-gem", userId: "seller", itemId: "gem", quantity: 3 },
        {
          id: "seller-stored-ore",
          userId: "seller",
          itemId: "ore",
          quantity: 7,
          storedAtHome: true,
        },
        { id: "buyer-ore", userId: "buyer", itemId: "ore", quantity: 5 },
        { id: "buyer-gem", userId: "buyer", itemId: "gem", quantity: 10 },
      ]);
    });

    /** Positive carried quantities of an item for a player, largest first. */
    const carried = async (userId: string, itemId: string) =>
      (
        await (
          await getTestDatabase()
        )
          .select({ quantity: userItem.quantity })
          .from(userItem)
          .where(
            and(
              eq(userItem.userId, userId),
              eq(userItem.itemId, itemId),
              eq(userItem.storedAtHome, false),
            ),
          )
      )
        .map((row) => row.quantity)
        .filter((quantity) => quantity > 0)
        .sort((a, b) => b - a);

    /** List part of the seller's carried ore (10 to begin with). */
    const listOre = async (quantity = 4) => {
      const seller = await callerFor(auctionRouter, "seller");
      expect(
        await seller.createAuctionListing({
          userItemId: "seller-ore",
          quantity,
          listingType: "AUCTION",
          startingPrice: quantity,
          buyoutPrice: quantity * 2,
          durationHours: 24,
          currencyType: "MONEY",
        }),
      ).toMatchObject({ success: true });
      const listings = await (await getTestDatabase()).select().from(auctionListing);
      return listings.at(-1)!;
    };

    /** Let listings run out and settle them through the scheduled expiry job. */
    const expireAll = async () => {
      const db = await getTestDatabase();
      await db.update(auctionListing).set({ expiresAt: new Date(Date.now() - 1000) });
      const response = await expireAuctions(
        new Request("https://example.com/api/auction-expire", {
          headers: { authorization: "Bearer auction-cron" },
        }),
      );
      expect(response.status).toBe(200);
    };

    it("joins a cancelled listing to the stack it was split from", async () => {
      const listing = await listOre();
      expect(await carried("seller", "ore")).toEqual([6, 4]);
      const seller = await callerFor(auctionRouter, "seller");
      expect(await seller.cancelAuction({ auctionId: listing.id })).toMatchObject({
        success: true,
      });
      expect(await carried("seller", "ore")).toEqual([10]);
    });

    it("joins an unsold listing to the seller's stack when it expires", async () => {
      await listOre();
      await expireAll();
      expect(await carried("seller", "ore")).toEqual([10]);
    });

    it("joins several of a seller's listings of one item when they expire together", async () => {
      await listOre();
      await listOre(3);
      expect(await carried("seller", "ore")).toEqual([4, 3, 3]);
      await expireAll();
      expect(await carried("seller", "ore")).toEqual([10]);
    });

    it("joins an expired listing to the winning bidder's stack", async () => {
      const listing = await listOre();
      const buyer = await callerFor(auctionRouter, "buyer");
      expect(await buyer.placeBid({ auctionId: listing.id, amount: 5 })).toMatchObject({
        success: true,
      });
      await expireAll();
      expect(await carried("buyer", "ore")).toEqual([9]);
      expect(await carried("seller", "ore")).toEqual([6]);
    });

    it("leaves an expired listing apart while the seller is in a battle", async () => {
      await listOre();
      await (await getTestDatabase())
        .update(userData)
        .set({ status: "BATTLE", battleId: "battle" })
        .where(eq(userData.userId, "seller"));
      await expireAll();
      expect(await carried("seller", "ore")).toEqual([6, 4]);
    });

    it("joins a bought listing to the buyer's stack", async () => {
      const listing = await listOre();
      const buyer = await callerFor(auctionRouter, "buyer");
      expect(await buyer.placeBid({ auctionId: listing.id, amount: 8 })).toMatchObject({
        success: true,
      });
      expect(await carried("buyer", "ore")).toEqual([9]);
      expect(await carried("seller", "ore")).toEqual([6]);
    });

    it("joins a listing the only bidder buys out to the buyer's stack", async () => {
      const listing = await listOre();
      const buyer = await callerFor(auctionRouter, "buyer");
      expect(await buyer.placeBid({ auctionId: listing.id, amount: 5 })).toMatchObject({
        success: true,
      });
      expect(await buyer.placeBid({ auctionId: listing.id, amount: 8 })).toMatchObject({
        success: true,
      });
      expect(await carried("buyer", "ore")).toEqual([9]);
    });

    it("keeps home storage apart and the cancel successful when the merge fails", async () => {
      const listing = await listOre();
      let failedClaims = 0;
      const failing = aroundStatements(
        await getTestDatabase(),
        userItem,
        async () => {
          failedClaims++;
          throw new TypeError("fetch failed");
        },
        { when: (values) => "quantity" in values },
      );
      const seller = callerForDatabase(auctionRouter, "seller", failing);
      expect(await seller.cancelAuction({ auctionId: listing.id })).toMatchObject({
        success: true,
      });
      expect(failedClaims).toBeGreaterThan(0);
      expect(await carried("seller", "ore")).toEqual([6, 4]);
      const [stored] = await (await getTestDatabase())
        .select({ quantity: userItem.quantity })
        .from(userItem)
        .where(eq(userItem.id, "seller-stored-ore"));
      expect(stored?.quantity).toBe(7);
    });

    it("joins a cancelled trade offer's item to the stack it was split from", async () => {
      const seller = await callerFor(auctionRouter, "seller");
      expect(
        await seller.createAuctionOffer({
          offerType: "TRADE",
          requestedItemId: "gem",
          requestedQuantity: 2,
          offeredUserItemId: "seller-ore",
          offeredQuantity: 4,
        }),
      ).toMatchObject({ success: true });
      expect(await carried("seller", "ore")).toEqual([6, 4]);
      const [offer] = await (await getTestDatabase()).select().from(auctionOffer);
      expect(await seller.cancelAuctionOffer({ offerId: offer!.id })).toMatchObject({
        success: true,
      });
      expect(await carried("seller", "ore")).toEqual([10]);
    });

    it("joins both sides of an accepted trade to their stacks", async () => {
      const seller = await callerFor(auctionRouter, "seller");
      expect(
        await seller.createAuctionOffer({
          offerType: "TRADE",
          requestedItemId: "gem",
          requestedQuantity: 2,
          offeredUserItemId: "seller-ore",
          offeredQuantity: 4,
        }),
      ).toMatchObject({ success: true });
      const [offer] = await (await getTestDatabase()).select().from(auctionOffer);
      const buyer = await callerFor(auctionRouter, "buyer");
      expect(
        await buyer.acceptAuctionOffer({ offerId: offer!.id, userItemId: "buyer-gem" }),
      ).toMatchObject({ success: true });
      expect(await carried("buyer", "ore")).toEqual([9]);
      expect(await carried("seller", "gem")).toEqual([5]);
      expect(await carried("buyer", "gem")).toEqual([8]);
    });

    it("merges each player's deliveries once, with every item they received", async () => {
      const merge = vi.spyOn(itemStacks, "mergeUserItemStacks").mockResolvedValue([]);
      await mergeDeliveredItems(await getTestDatabase(), [
        { ownerId: "seller", itemId: "ore" },
        { ownerId: "buyer", itemId: "ore" },
        { ownerId: "seller", itemId: "gem" },
        { ownerId: "seller", itemId: "ore" },
        { ownerId: "buyer", itemId: undefined },
      ]);
      expect(
        merge.mock.calls.map(([, ownerId, itemIds]) => [ownerId, [...itemIds]]),
      ).toEqual([
        ["seller", ["ore", "gem"]],
        ["buyer", ["ore"]],
      ]);
    });
  },
);
