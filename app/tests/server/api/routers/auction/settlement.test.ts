import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  actionLog,
  auctionBid,
  auctionListing,
  item,
  notification,
  userData,
  userItem,
} from "@/drizzle/schema";
import { auctionRouter, completeAuctionInternal } from "@/server/api/routers/auction";
import * as nativePush from "@/server/utils/push/defer";
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import {
  barrier,
  beforeStatements,
  beforeTransaction,
  failStatements,
  inTransactions,
  interceptExecute,
} from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("auction settlement", () => {
  const queuePush = vi.fn();
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    queuePush.mockReset();
    vi.spyOn(nativePush, "deferPushToUsers").mockImplementation(queuePush);
    await resetTables(
      actionLog,
      notification,
      auctionBid,
      auctionListing,
      userItem,
      item,
      userData,
    );
    // Balances are what remains after the winning 100 and losing 70 are escrowed.
    await insertUsers([
      {
        userId: "seller",
        username: "Seller",
        level: 50,
        bank: 1000,
        reputationPoints: 1000,
      },
      {
        userId: "winner",
        username: "Winner",
        level: 50,
        bank: 900,
        reputationPoints: 900,
      },
      {
        userId: "loser",
        username: "Loser",
        level: 50,
        bank: 930,
        reputationPoints: 930,
      },
    ]);
    await insertItems([{ id: "lot", name: "Auction lot", canBeTraded: true }]);
    await insertUserItems([
      {
        id: "escrow",
        itemId: "lot",
        userId: "seller",
        isInAuction: true,
        activeVariantId: "seller-skin",
        storedAtHome: true,
        homeX: 2,
        homeY: 3,
        homeRotation: 90,
      },
    ]);
  });

  const seedAuction = async (
    currencyType: "MONEY" | "REPUTATION",
    withBids = true,
    isExpired = true,
  ) => {
    const db = await getTestDatabase();
    await db.insert(auctionListing).values({
      id: "auction",
      sellerId: "seller",
      userItemId: "escrow",
      listingType: "AUCTION",
      startingPrice: 1,
      currentPrice: withBids ? 100 : 1,
      buyoutPrice: 150,
      currencyType,
      expiresAt: new Date(Date.now() + (isExpired ? -60000 : 60000)),
    });
    if (withBids)
      await db.insert(auctionBid).values([
        { id: "winning-bid", auctionId: "auction", bidderId: "winner", amount: 100 },
        { id: "losing-bid", auctionId: "auction", bidderId: "loser", amount: 70 },
      ]);
  };

  const balances = async (currency: "bank" | "reputationPoints") =>
    Object.fromEntries(
      (await (await getTestDatabase()).select().from(userData)).map((user) => [
        user.userId,
        user[currency],
      ]),
    );

  for (const currency of ["MONEY", "REPUTATION"] as const) {
    const balance = currency === "MONEY" ? "bank" : "reputationPoints";
    it(`settles concurrent completions once in ${currency}`, async () => {
      await seedAuction(currency);
      const db = await getTestDatabase();
      const results = await Promise.all([
        completeAuctionInternal(db, "auction"),
        completeAuctionInternal(db, "auction"),
      ]);
      expect(results.filter((result) => result.success)).toHaveLength(1);
      expect(results.filter((result) => !result.success)).toHaveLength(1);
      expect(await balances(balance)).toEqual({
        seller: 1090,
        winner: 900,
        loser: 1000,
      });
      expect((await db.select().from(auctionListing))[0]).toMatchObject({
        status: "SOLD",
        buyerId: "winner",
      });
      expect((await db.select().from(userItem))[0]).toMatchObject({
        userId: "winner",
        isInAuction: false,
        activeVariantId: null,
        storedAtHome: false,
        homeX: null,
        homeY: null,
        homeRotation: 0,
      });
      expect(
        (await db.select().from(auctionBid).where(eq(auctionBid.id, "winning-bid")))[0]
          ?.status,
      ).toBe("WON");
      expect(
        (await db.select().from(auctionBid).where(eq(auctionBid.id, "losing-bid")))[0]
          ?.status,
      ).toBe("REFUNDED");
      expect(queuePush).toHaveBeenCalledTimes(1);
      expect((await completeAuctionInternal(db, "auction")).success).toBe(false);
      expect(await balances(balance)).toEqual({
        seller: 1090,
        winner: 900,
        loser: 1000,
      });
    });

    it(`settles a single bid using one guarded statement in ${currency}`, async () => {
      await seedAuction(currency);
      const db = await getTestDatabase();
      await db.delete(auctionBid).where(eq(auctionBid.id, "losing-bid"));
      const recorded = await recordQueries(() =>
        completeAuctionInternal(db, "auction"),
      );
      expect(recorded.result.success).toBe(true);
      expect(
        recorded.statements.filter((statement) => /^\s*UPDATE/i.test(statement)),
      ).toHaveLength(1);
      expect(
        recorded.statements.some((statement) =>
          /^(begin|start transaction)/i.test(statement.trim()),
        ),
      ).toBe(false);
      expect(await balances(balance)).toEqual({
        seller: 1090,
        winner: 900,
        loser: 930,
      });
      expect((await db.select().from(userItem))[0]).toMatchObject({
        userId: "winner",
        isInAuction: false,
        activeVariantId: null,
        storedAtHome: false,
      });
      expect(queuePush).toHaveBeenCalledTimes(1);
    });

    for (const withRefunds of [false, true]) {
      it.each([
        [19, 17],
        [99, 89],
        [1000, 900],
      ])(
        `rounds down the ${currency} seller payout with refunds=${withRefunds} at %i`,
        async (amount, payout) => {
          await seedAuction(currency);
          const db = await getTestDatabase();
          await db
            .update(auctionBid)
            .set({ amount })
            .where(eq(auctionBid.id, "winning-bid"));
          if (withRefunds) {
            await db
              .update(auctionBid)
              .set({ amount: 1 })
              .where(eq(auctionBid.id, "losing-bid"));
          } else {
            await db.delete(auctionBid).where(eq(auctionBid.id, "losing-bid"));
          }
          expect((await completeAuctionInternal(db, "auction")).success).toBe(true);
          expect(await balances(balance)).toEqual({
            seller: 1000 + payout!,
            winner: 900,
            loser: withRefunds ? 931 : 930,
          });
          expect(
            (
              await db.select().from(auctionBid).where(eq(auctionBid.id, "winning-bid"))
            )[0],
          ).toMatchObject({ amount, status: "WON" });
        },
      );
    }

    it(`settles a one-unit ${currency} sale with zero seller proceeds`, async () => {
      await seedAuction(currency);
      const db = await getTestDatabase();
      await db.delete(auctionBid).where(eq(auctionBid.id, "losing-bid"));
      await db
        .update(auctionBid)
        .set({ amount: 1 })
        .where(eq(auctionBid.id, "winning-bid"));
      expect((await completeAuctionInternal(db, "auction")).success).toBe(true);
      expect(await balances(balance)).toEqual({
        seller: 1000,
        winner: 900,
        loser: 930,
      });
      expect((await db.select().from(userItem))[0]).toMatchObject({
        userId: "winner",
        isInAuction: false,
      });
    });

    it(`taxes a direct ${currency} buyout without changing the buyer charge`, async () => {
      await seedAuction(currency, false, false);
      const db = await getTestDatabase();
      await db
        .update(auctionListing)
        .set({ listingType: "DIRECT", targetUserId: "winner", buyoutPrice: 99 })
        .where(eq(auctionListing.id, "auction"));
      const buyer = await callerFor(auctionRouter, "winner");
      expect((await buyer.placeBid({ auctionId: "auction", amount: 99 })).success).toBe(
        true,
      );
      expect(await balances(balance)).toEqual({
        seller: 1089,
        winner: 801,
        loser: 930,
      });
      expect((await db.select().from(auctionListing))[0]).toMatchObject({
        currentPrice: 99,
        status: "SOLD",
        buyerId: "winner",
      });
    });

    it(`rolls back a first-bid buyout INSERT, debit and log when ${currency} delivery fails`, async () => {
      await seedAuction(currency, false, false);
      const db = await getTestDatabase();
      const failed = inTransactions(db, (tx) => failStatements(tx, userItem));
      const buyer = callerForDatabase(auctionRouter, "winner", failed);
      await expect(
        buyer.placeBid({ auctionId: "auction", amount: 150 }),
      ).rejects.toThrow("Statement failed on purpose");
      expect(await balances(balance)).toEqual({
        seller: 1000,
        winner: 900,
        loser: 930,
      });
      expect((await db.select().from(auctionListing))[0]).toMatchObject({
        status: "ACTIVE",
        currentPrice: 1,
      });
      expect(await db.select().from(auctionBid)).toHaveLength(0);
      expect(await db.select().from(actionLog)).toHaveLength(0);
      expect((await db.select().from(userItem))[0]).toMatchObject({
        userId: "seller",
        isInAuction: true,
      });
      expect(queuePush).not.toHaveBeenCalled();
    });

    it(`keeps a first-bid buyout transactional for the INSERT in ${currency}`, async () => {
      await seedAuction(currency, false, false);
      const db = await getTestDatabase();
      const buyer = await callerFor(auctionRouter, "winner");
      const recorded = await recordQueries(() =>
        buyer.placeBid({ auctionId: "auction", amount: 150 }),
      );
      expect(recorded.result.success).toBe(true);
      expect(
        recorded.statements.some((statement) =>
          /^(begin|start transaction)/i.test(statement.trim()),
        ),
      ).toBe(true);
      expect(await balances(balance)).toEqual({
        seller: 1135,
        winner: 750,
        loser: 930,
      });
      expect((await db.select().from(auctionListing))[0]).toMatchObject({
        status: "SOLD",
        buyerId: "winner",
      });
      expect((await db.select().from(auctionBid))[0]).toMatchObject({
        amount: 150,
        status: "WON",
      });
      expect(queuePush).toHaveBeenCalledTimes(1);
    });

    it(`claims a concurrent single-bid buyout raise only once in ${currency}`, async () => {
      await seedAuction(currency, true, false);
      const db = await getTestDatabase();
      await db.delete(auctionBid).where(eq(auctionBid.id, "losing-bid"));
      const bothArrived = barrier(2);
      const synchronized = interceptExecute(db, async (_query, run) => {
        await bothArrived();
        return run();
      });
      const buyer = callerForDatabase(auctionRouter, "winner", synchronized);
      const results = await Promise.all([
        buyer.placeBid({ auctionId: "auction", amount: 150 }),
        buyer.placeBid({ auctionId: "auction", amount: 175 }),
      ]);
      expect(results.filter((result) => result.success)).toHaveLength(1);
      const [listing] = await db.select().from(auctionListing);
      expect(listing?.status).toBe("SOLD");
      expect(await balances(balance)).toEqual({
        seller: 1000 + Math.floor((listing!.currentPrice * 90) / 100),
        winner: 1000 - listing!.currentPrice,
        loser: 930,
      });
      expect(queuePush).toHaveBeenCalledTimes(1);
    });

    it(`rolls back delivery, credits and the listing claim if a later ${currency} write fails`, async () => {
      await seedAuction(currency);
      const db = await getTestDatabase();
      const failed = inTransactions(db, (tx) => failStatements(tx, auctionBid));
      await expect(completeAuctionInternal(failed, "auction")).rejects.toThrow(
        "Statement failed on purpose",
      );
      expect(await balances(balance)).toEqual({
        seller: 1000,
        winner: 900,
        loser: 930,
      });
      expect((await db.select().from(auctionListing))[0]?.status).toBe("ACTIVE");
      expect((await db.select().from(userItem))[0]).toMatchObject({
        userId: "seller",
        isInAuction: true,
        activeVariantId: "seller-skin",
        storedAtHome: true,
      });
      expect(
        (await db.select().from(auctionBid)).every((bid) => bid.status === "ACTIVE"),
      ).toBe(true);
      expect(queuePush).not.toHaveBeenCalled();
      expect((await completeAuctionInternal(db, "auction")).success).toBe(true);
      expect(await balances(balance)).toEqual({
        seller: 1090,
        winner: 900,
        loser: 1000,
      });
    });

    it(`rolls back the buyout debit, bid and log if ${currency} delivery fails`, async () => {
      await seedAuction(currency, true, false);
      const db = await getTestDatabase();
      const failed = inTransactions(db, (tx) => failStatements(tx, userItem));
      const buyer = callerForDatabase(auctionRouter, "loser", failed);
      await expect(
        buyer.placeBid({ auctionId: "auction", amount: 150 }),
      ).rejects.toThrow("Statement failed on purpose");
      expect(await balances(balance)).toEqual({
        seller: 1000,
        winner: 900,
        loser: 930,
      });
      expect((await db.select().from(auctionListing))[0]).toMatchObject({
        status: "ACTIVE",
        currentPrice: 100,
      });
      expect(
        (await db.select().from(auctionBid).where(eq(auctionBid.id, "losing-bid")))[0],
      ).toMatchObject({ status: "ACTIVE", amount: 70 });
      expect((await db.select().from(userItem))[0]).toMatchObject({
        userId: "seller",
        isInAuction: true,
      });
      expect(await db.select().from(actionLog)).toHaveLength(0);
      expect(await db.select().from(notification)).toHaveLength(0);
      expect(queuePush).not.toHaveBeenCalled();
    });

    it(`commits one of two simultaneous buyout bids in ${currency}`, async () => {
      await seedAuction(currency, true, false);
      const db = await getTestDatabase();
      const bothArrived = barrier(2);
      const synchronized = beforeTransaction(db, bothArrived);
      const winner = callerForDatabase(auctionRouter, "winner", synchronized);
      const loser = callerForDatabase(auctionRouter, "loser", synchronized);
      const results = await Promise.all([
        winner.placeBid({ auctionId: "auction", amount: 150 }),
        loser.placeBid({ auctionId: "auction", amount: 180 }),
      ]);
      expect(results.filter((result) => result.success)).toHaveLength(1);
      const [listing] = await db.select().from(auctionListing);
      expect(listing?.status).toBe("SOLD");
      expect(await balances(balance)).toEqual(
        listing?.buyerId === "winner"
          ? { seller: 1135, winner: 850, loser: 1000 }
          : { seller: 1162, winner: 1000, loser: 820 },
      );
      expect(queuePush).toHaveBeenCalledTimes(1);
    });
  }

  it("expires a no-bid listing only once and returns the seller's item", async () => {
    await seedAuction("MONEY", false);
    const db = await getTestDatabase();
    const results = await Promise.all([
      completeAuctionInternal(db, "auction"),
      completeAuctionInternal(db, "auction"),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect((await db.select().from(auctionListing))[0]).toMatchObject({
      status: "EXPIRED",
      buyerId: null,
    });
    expect((await db.select().from(userItem))[0]).toMatchObject({
      userId: "seller",
      isInAuction: false,
      activeVariantId: "seller-skin",
    });
    expect(await balances("bank")).toEqual({ seller: 1000, winner: 900, loser: 930 });
  });

  it("expires an empty auction without opening a transaction", async () => {
    await seedAuction("MONEY", false);
    const db = await getTestDatabase();
    const recorded = await recordQueries(() => completeAuctionInternal(db, "auction"));
    expect(recorded.result.success).toBe(true);
    expect(
      recorded.statements.filter((statement) => /^\s*UPDATE/i.test(statement)),
    ).toHaveLength(1);
    expect(
      recorded.statements.some((statement) =>
        /^(begin|start transaction)/i.test(statement.trim()),
      ),
    ).toBe(false);
  });

  it("does not expire an empty snapshot after a bid appears", async () => {
    await seedAuction("MONEY", false);
    const db = await getTestDatabase();
    const changed = beforeStatements(db, auctionListing, [
      async () => {
        await db.insert(auctionBid).values({
          id: "late-bid",
          auctionId: "auction",
          bidderId: "winner",
          amount: 100,
        });
      },
    ]);
    expect((await completeAuctionInternal(changed, "auction")).success).toBe(false);
    expect((await db.select().from(auctionListing))[0]?.status).toBe("ACTIVE");
    expect((await db.select().from(userItem))[0]?.isInAuction).toBe(true);
    expect(queuePush).not.toHaveBeenCalled();
  });

  it("does not settle a single-bid snapshot after another bid appears", async () => {
    await seedAuction("MONEY");
    const db = await getTestDatabase();
    await db.delete(auctionBid).where(eq(auctionBid.id, "losing-bid"));
    const changed = beforeStatements(db, auctionListing, [
      async () => {
        await db.insert(auctionBid).values({
          id: "late-bid",
          auctionId: "auction",
          bidderId: "loser",
          amount: 70,
        });
      },
    ]);
    expect((await completeAuctionInternal(changed, "auction")).success).toBe(false);
    expect((await db.select().from(auctionListing))[0]?.status).toBe("ACTIVE");
    expect((await db.select().from(userItem))[0]?.isInAuction).toBe(true);
    expect(await balances("bank")).toEqual({ seller: 1000, winner: 900, loser: 930 });
  });

  it("rejects a single-bid buyout if the balance changes before its guarded statement", async () => {
    await seedAuction("MONEY", true, false);
    const db = await getTestDatabase();
    await db.delete(auctionBid).where(eq(auctionBid.id, "losing-bid"));
    const changed = beforeStatements(db, auctionListing, [
      async () => {
        await db.update(userData).set({ bank: 0 }).where(eq(userData.userId, "winner"));
      },
    ]);
    const buyer = callerForDatabase(auctionRouter, "winner", changed);
    expect((await buyer.placeBid({ auctionId: "auction", amount: 150 })).success).toBe(
      false,
    );
    expect((await db.select().from(auctionListing))[0]).toMatchObject({
      status: "ACTIVE",
      currentPrice: 100,
    });
    expect((await db.select().from(auctionBid))[0]).toMatchObject({
      amount: 100,
      status: "ACTIVE",
    });
    expect((await db.select().from(userItem))[0]?.isInAuction).toBe(true);
    expect((await balances("bank")).seller).toBe(1000);
    expect(queuePush).not.toHaveBeenCalled();
  });

  it("rejects a single-bid buyout if its deadline passes before the guarded statement", async () => {
    await seedAuction("MONEY", true, false);
    const db = await getTestDatabase();
    await db.delete(auctionBid).where(eq(auctionBid.id, "losing-bid"));
    const changed = beforeStatements(db, auctionListing, [
      async () => {
        await db
          .update(auctionListing)
          .set({ expiresAt: new Date(0) })
          .where(eq(auctionListing.id, "auction"));
      },
    ]);
    const buyer = callerForDatabase(auctionRouter, "winner", changed);
    expect((await buyer.placeBid({ auctionId: "auction", amount: 150 })).success).toBe(
      false,
    );
    expect((await db.select().from(auctionListing))[0]).toMatchObject({
      status: "ACTIVE",
      currentPrice: 100,
    });
    expect(await balances("bank")).toEqual({ seller: 1000, winner: 900, loser: 930 });
    expect(queuePush).not.toHaveBeenCalled();
  });

  it.each(["seller", "winner"])(
    "rejects single-bid settlement when the %s account disappears after preload",
    async (userId) => {
      await seedAuction("MONEY");
      const db = await getTestDatabase();
      await db.delete(auctionBid).where(eq(auctionBid.id, "losing-bid"));
      const changed = beforeStatements(db, auctionListing, [
        async () => {
          await db.delete(userData).where(eq(userData.userId, userId));
        },
      ]);
      expect((await completeAuctionInternal(changed, "auction")).success).toBe(false);
      expect((await db.select().from(auctionListing))[0]?.status).toBe("ACTIVE");
      expect((await db.select().from(auctionBid))[0]?.status).toBe("ACTIVE");
      expect((await db.select().from(userItem))[0]).toMatchObject({
        userId: "seller",
        isInAuction: true,
      });
      expect(queuePush).not.toHaveBeenCalled();
    },
  );

  it("rolls back every payment when one of 75 refund recipients is missing", async () => {
    await seedAuction("MONEY");
    const db = await getTestDatabase();
    const recipients = Array.from({ length: 75 }, (_, index) => ({
      userId: `refund-${index}`,
      username: `Refund${index}`,
      bank: 0,
    }));
    await insertUsers(recipients);
    await db.insert(auctionBid).values(
      recipients.map((user, index) => ({
        id: `extra-${index}`,
        auctionId: "auction",
        bidderId: user.userId,
        amount: index + 1,
      })),
    );
    await db.delete(userData).where(eq(userData.userId, "refund-74"));
    expect((await completeAuctionInternal(db, "auction")).success).toBe(false);
    const pending = await balances("bank");
    expect(pending.seller).toBe(1000);
    for (let index = 0; index < 74; index++) expect(pending[`refund-${index}`]).toBe(0);
    expect((await db.select().from(auctionListing))[0]?.status).toBe("ACTIVE");
    expect((await db.select().from(userItem))[0]?.isInAuction).toBe(true);
    expect(queuePush).not.toHaveBeenCalled();
    await insertUsers([{ userId: "refund-74", username: "Refund74", bank: 0 }]);
    expect((await completeAuctionInternal(db, "auction")).success).toBe(true);
    const delivered = await balances("bank");
    expect(delivered.seller).toBe(1090);
    for (let index = 0; index < 75; index++)
      expect(delivered[`refund-${index}`]).toBe(index + 1);
    expect(queuePush).toHaveBeenCalledTimes(1);
  });

  it("rolls back a no-bid expiration when releasing the item fails", async () => {
    await seedAuction("MONEY", false);
    const db = await getTestDatabase();
    const failed = failStatements(db, userItem);
    await expect(completeAuctionInternal(failed, "auction")).rejects.toThrow(
      "Statement failed on purpose",
    );
    expect((await db.select().from(auctionListing))[0]?.status).toBe("ACTIVE");
    expect((await db.select().from(userItem))[0]?.isInAuction).toBe(true);
    expect(queuePush).not.toHaveBeenCalled();
  });

  it("does not settle inconsistent bid escrow", async () => {
    await seedAuction("MONEY");
    const db = await getTestDatabase();
    await db
      .update(auctionBid)
      .set({ status: "REFUNDED" })
      .where(eq(auctionBid.id, "losing-bid"));
    expect((await completeAuctionInternal(db, "auction")).success).toBe(false);
    expect((await db.select().from(auctionListing))[0]?.status).toBe("ACTIVE");
    expect(await balances("bank")).toEqual({ seller: 1000, winner: 900, loser: 930 });
    expect(queuePush).not.toHaveBeenCalled();
  });

  it("retries a deadlock only after rolling back the entire settlement", async () => {
    await seedAuction("MONEY");
    const db = await getTestDatabase();
    let attempts = 0;
    const retrying = inTransactions(db, (tx, attempt) => {
      attempts = attempt;
      return beforeStatements(tx, auctionBid, [
        async () => {
          if (attempt === 1) throw new Error("Deadlock found when trying to get lock");
        },
      ]);
    });
    expect((await completeAuctionInternal(retrying, "auction")).success).toBe(true);
    expect(attempts).toBe(2);
    expect(await balances("bank")).toEqual({ seller: 1090, winner: 900, loser: 1000 });
    expect(queuePush).toHaveBeenCalledTimes(1);
  });

  it("rejects an in-flight buyout if expiration settles before its listing claim", async () => {
    await seedAuction("MONEY", true, false);
    const db = await getTestDatabase();
    const expired = inTransactions(db, (tx) =>
      beforeStatements(tx, auctionListing, [
        async () => {
          await db
            .update(auctionListing)
            .set({ expiresAt: new Date(0) })
            .where(eq(auctionListing.id, "auction"));
          expect((await completeAuctionInternal(db, "auction")).success).toBe(true);
        },
      ]),
    );
    const buyer = callerForDatabase(auctionRouter, "loser", expired);
    expect((await buyer.placeBid({ auctionId: "auction", amount: 150 })).success).toBe(
      false,
    );
    expect(await balances("bank")).toEqual({ seller: 1090, winner: 900, loser: 1000 });
    expect((await db.select().from(auctionListing))[0]).toMatchObject({
      status: "SOLD",
      buyerId: "winner",
    });
    expect(queuePush).toHaveBeenCalledTimes(1);
  });

  it("rejects early completion without consuming the claim", async () => {
    await seedAuction("MONEY", true, false);
    const db = await getTestDatabase();
    expect((await completeAuctionInternal(db, "auction")).success).toBe(false);
    expect((await db.select().from(auctionListing))[0]?.status).toBe("ACTIVE");
    expect(queuePush).not.toHaveBeenCalled();
  });

  it("rolls back when the reserved item or a refund account has disappeared", async () => {
    await seedAuction("MONEY");
    const db = await getTestDatabase();
    await db
      .update(userItem)
      .set({ isInAuction: false })
      .where(eq(userItem.id, "escrow"));
    expect((await completeAuctionInternal(db, "auction")).success).toBe(false);
    await db
      .update(userItem)
      .set({ isInAuction: true })
      .where(eq(userItem.id, "escrow"));
    await db.delete(userData).where(eq(userData.userId, "loser"));
    expect((await completeAuctionInternal(db, "auction")).success).toBe(false);
    expect((await db.select().from(auctionListing))[0]?.status).toBe("ACTIVE");
    expect((await db.select().from(userItem))[0]).toMatchObject({
      userId: "seller",
      isInAuction: true,
    });
    expect((await balances("bank")).seller).toBe(1000);
    expect(queuePush).not.toHaveBeenCalled();
  });
});
