import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";
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
import type { DrizzleClient } from "@/server/db";
import * as nativePush from "@/server/utils/push/defer";
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import {
  beforeStatements,
  failStatements,
  holdReads,
  inTransactions,
} from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  recordQueries,
} from "../../../../setup/testDatabase";

describeWithDatabase("auction bid atomicity", () => {
  beforeEach(async () => {
    vi.spyOn(nativePush, "deferPushToUsers").mockImplementation(() => {});
    await resetTables(
      actionLog,
      notification,
      auctionBid,
      auctionListing,
      userItem,
      item,
      userData,
    );
    await insertUsers([
      { userId: "seller", level: 50, bank: 1000, reputationPoints: 1000 },
      { userId: "bidder", level: 50, bank: 1000, reputationPoints: 1000 },
      { userId: "rival", level: 50, bank: 1000, reputationPoints: 1000 },
    ]);
    await insertItems([{ id: "lot", name: "Auction lot", canBeTraded: true }]);
    await insertUserItems([
      { id: "lot-instance", itemId: "lot", userId: "seller", isInAuction: true },
    ]);
    await (await getTestDatabase()).insert(auctionListing).values({
      id: "auction",
      sellerId: "seller",
      userItemId: "lot-instance",
      listingType: "AUCTION",
      startingPrice: 10,
      currentPrice: 10,
      expiresAt: new Date(Date.now() + 3600000),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const saved = async () => {
    const db = await getTestDatabase();
    const [users, bids, listings, logs, notifications] = await Promise.all([
      db.select().from(userData),
      db.select().from(auctionBid),
      db.select().from(auctionListing),
      db.select().from(actionLog),
      db.select().from(notification),
    ]);
    return {
      users: Object.fromEntries(users.map((user) => [user.userId, user])),
      bids,
      listing: listings[0]!,
      logs,
      notifications,
    };
  };
  const seedBid = async (currency: "MONEY" | "REPUTATION" = "MONEY") => {
    const db = await getTestDatabase();
    await db
      .update(auctionListing)
      .set({ currencyType: currency, currentPrice: 50 })
      .where(eq(auctionListing.id, "auction"));
    await db
      .insert(auctionBid)
      .values({ id: "existing", auctionId: "auction", bidderId: "bidder", amount: 50 });
  };

  it.each(["MONEY", "REPUTATION"] as const)(
    "charges a duplicate 50→100 raise only once in %s",
    async (currency) => {
      await seedBid(currency);
      const api = callerForDatabase(
        auctionRouter,
        "bidder",
        synchronizeAuctionReads(await getTestDatabase()),
      );
      const results = await Promise.all([
        api.placeBid({ auctionId: "auction", amount: 100 }),
        api.placeBid({ auctionId: "auction", amount: 100 }),
      ]);
      expect(results.filter((result) => result.success)).toHaveLength(1);
      const state = await saved();
      expect(
        state.users.bidder?.[currency === "MONEY" ? "bank" : "reputationPoints"],
      ).toBe(950);
      expect(state.bids).toHaveLength(1);
      expect(state.bids[0]?.amount).toBe(100);
      expect(state.listing.currentPrice).toBe(100);
      expect(state.logs).toHaveLength(1);
    },
  );

  it.each(["MONEY", "REPUTATION"] as const)(
    "uses one guarded UPDATE without a transaction for an existing %s raise",
    async (currency) => {
      await seedBid(currency);
      const api = await callerFor(auctionRouter, "bidder");
      const recorded = await recordQueries(() =>
        api.placeBid({ auctionId: "auction", amount: 100 }),
      );
      expect(recorded.result).toMatchObject({ success: true, amountToDeduct: 50 });
      expect(
        recorded.statements.filter((statement) => /^update /i.test(statement.trim())),
      ).toHaveLength(1);
      expect(
        recorded.statements.some((statement) =>
          /^(begin|start transaction|commit|rollback)/i.test(statement.trim()),
        ),
      ).toBe(false);
      const state = await saved();
      expect(state.bids[0]?.amount).toBe(100);
      expect(state.listing.currentPrice).toBe(100);
      expect(
        state.users.bidder?.[currency === "MONEY" ? "bank" : "reputationPoints"],
      ).toBe(950);
    },
  );

  it("serializes different existing bidders without charging the lost claim", async () => {
    await seedBid();
    const db = await getTestDatabase();
    await db
      .insert(auctionBid)
      .values({ id: "rival-bid", auctionId: "auction", bidderId: "rival", amount: 75 });
    await db
      .update(auctionListing)
      .set({ currentPrice: 75 })
      .where(eq(auctionListing.id, "auction"));
    const synchronized = synchronizeAuctionReads(db);
    const bidder = callerForDatabase(auctionRouter, "bidder", synchronized);
    const rival = callerForDatabase(auctionRouter, "rival", synchronized);
    const [raised, rivalRaised] = await Promise.all([
      bidder.placeBid({ auctionId: "auction", amount: 100 }),
      rival.placeBid({ auctionId: "auction", amount: 150 }),
    ]);
    expect(Number(raised.success) + Number(rivalRaised.success)).toBe(1);
    const state = await saved();
    expect(state.listing.currentPrice).toBe(raised.success ? 100 : 150);
    expect(state.users.bidder?.bank).toBe(raised.success ? 950 : 1000);
    expect(state.users.rival?.bank).toBe(rivalRaised.success ? 925 : 1000);
    expect(state.bids.find((bid) => bid.id === "existing")?.amount).toBe(
      raised.success ? 100 : 50,
    );
    expect(state.bids.find((bid) => bid.id === "rival-bid")?.amount).toBe(
      rivalRaised.success ? 150 : 75,
    );
    expect(state.logs).toHaveLength(1);
    expect(state.notifications).toHaveLength(0);
  });

  it("serializes a standalone raise against a new bidder's transaction", async () => {
    await seedBid();
    const db = synchronizeAuctionReads(await getTestDatabase());
    const bidder = callerForDatabase(auctionRouter, "bidder", db);
    const rival = callerForDatabase(auctionRouter, "rival", db);
    const [raised, placed] = await Promise.all([
      bidder.placeBid({ auctionId: "auction", amount: 100 }),
      rival.placeBid({ auctionId: "auction", amount: 150 }),
    ]);
    expect(Number(raised.success) + Number(placed.success)).toBe(1);
    const state = await saved();
    expect(state.listing.currentPrice).toBe(raised.success ? 100 : 150);
    expect(state.users.bidder?.bank).toBe(raised.success ? 950 : 1000);
    expect(state.users.rival?.bank).toBe(placed.success ? 850 : 1000);
    expect(state.bids).toHaveLength(placed.success ? 2 : 1);
  });

  it.each(["MONEY", "REPUTATION"] as const)(
    "does not publish an existing %s raise after its available balance changes",
    async (currency) => {
      await seedBid(currency);
      const db = await getTestDatabase();
      const spent = beforeStatements(db, auctionListing, [
        async () => {
          await db
            .update(userData)
            .set(currency === "MONEY" ? { bank: 0 } : { reputationPoints: 0 })
            .where(eq(userData.userId, "bidder"));
        },
      ]);
      const api = callerForDatabase(auctionRouter, "bidder", spent);
      expect((await api.placeBid({ auctionId: "auction", amount: 100 })).success).toBe(
        false,
      );
      const state = await saved();
      expect(state.listing.currentPrice).toBe(50);
      expect(state.bids[0]?.amount).toBe(50);
      expect(state.logs).toHaveLength(0);
      expect(
        state.users.bidder?.[currency === "MONEY" ? "bank" : "reputationPoints"],
      ).toBe(0);
    },
  );

  it.each(["isBanned", "isTradeBanned", "level"] as const)(
    "guards %s again in the standalone raise",
    async (field) => {
      await seedBid();
      const db = await getTestDatabase();
      const changed = beforeStatements(db, auctionListing, [
        async () => {
          await db
            .update(userData)
            .set(field === "level" ? { level: 1 } : { [field]: true })
            .where(eq(userData.userId, "bidder"));
        },
      ]);
      const api = callerForDatabase(auctionRouter, "bidder", changed);
      expect((await api.placeBid({ auctionId: "auction", amount: 100 })).success).toBe(
        false,
      );
      const state = await saved();
      expect(state.users.bidder?.bank).toBe(1000);
      expect(state.listing.currentPrice).toBe(50);
      expect(state.bids[0]?.amount).toBe(50);
    },
  );

  it.each(["status", "amount"] as const)(
    "does not overwrite an existing bid whose %s changed",
    async (field) => {
      await seedBid();
      const db = await getTestDatabase();
      const changed = beforeStatements(db, auctionListing, [
        async () => {
          await db
            .update(auctionBid)
            .set(field === "status" ? { status: "REFUNDED" } : { amount: 70 })
            .where(eq(auctionBid.id, "existing"));
        },
      ]);
      const api = callerForDatabase(auctionRouter, "bidder", changed);
      expect((await api.placeBid({ auctionId: "auction", amount: 100 })).success).toBe(
        false,
      );
      const state = await saved();
      expect(state.users.bidder?.bank).toBe(1000);
      expect(state.listing.currentPrice).toBe(50);
      expect(state.bids[0]?.[field]).toBe(field === "status" ? "REFUNDED" : 70);
      expect(state.logs).toHaveLength(0);
    },
  );

  it.each(["SOLD", "EXPIRED", "DEADLINE"] as const)(
    "does not publish a standalone raise after %s",
    async (change) => {
      await seedBid();
      const db = await getTestDatabase();
      const changed = beforeStatements(db, auctionListing, [
        async () => {
          await db
            .update(auctionListing)
            .set(
              change === "DEADLINE" ? { expiresAt: new Date(0) } : { status: change },
            )
            .where(eq(auctionListing.id, "auction"));
        },
      ]);
      const api = callerForDatabase(auctionRouter, "bidder", changed);
      expect((await api.placeBid({ auctionId: "auction", amount: 100 })).success).toBe(
        false,
      );
      const state = await saved();
      expect(state.users.bidder?.bank).toBe(1000);
      expect(state.listing.currentPrice).toBe(50);
      expect(state.bids[0]?.amount).toBe(50);
    },
  );

  it("does not debit an existing bid when the guarded statement fails", async () => {
    await seedBid();
    const api = callerForDatabase(
      auctionRouter,
      "bidder",
      failStatements(await getTestDatabase(), auctionListing),
    );
    await expect(api.placeBid({ auctionId: "auction", amount: 100 })).rejects.toThrow(
      "Statement failed on purpose",
    );
    const state = await saved();
    expect(state.users.bidder?.bank).toBe(1000);
    expect(state.bids[0]?.amount).toBe(50);
    expect(state.listing.currentPrice).toBe(50);
    expect(state.logs).toHaveLength(0);
  });

  it("retries a deadlocked standalone raise without double-debiting or duplicating its log", async () => {
    await seedBid();
    const db = beforeStatements(await getTestDatabase(), auctionListing, [
      async () => {
        throw new Error("Deadlock found when trying to get lock");
      },
    ]);
    const api = callerForDatabase(auctionRouter, "bidder", db);
    expect((await api.placeBid({ auctionId: "auction", amount: 100 })).success).toBe(
      true,
    );
    const state = await saved();
    expect(state.users.bidder?.bank).toBe(950);
    expect(state.bids[0]?.amount).toBe(100);
    expect(state.logs).toHaveLength(1);
  });

  it("keeps a committed raise successful when activity recording fails", async () => {
    await seedBid();
    const db = await getTestDatabase();
    await db
      .insert(auctionBid)
      .values({ id: "rival-bid", auctionId: "auction", bidderId: "rival", amount: 75 });
    await db
      .update(auctionListing)
      .set({ currentPrice: 75 })
      .where(eq(auctionListing.id, "auction"));
    const report = vi
      .spyOn(Sentry, "captureException")
      .mockReturnValue("auction-activity-error");
    const api = callerForDatabase(
      auctionRouter,
      "bidder",
      failStatements(db, actionLog),
    );
    expect(await api.placeBid({ auctionId: "auction", amount: 100 })).toMatchObject({
      success: true,
      amountToDeduct: 50,
    });
    const state = await saved();
    expect(state.users.bidder?.bank).toBe(950);
    expect(state.listing.currentPrice).toBe(100);
    expect(state.bids.find((bid) => bid.id === "existing")?.amount).toBe(100);
    expect(report).toHaveBeenCalledTimes(1);
    expect(state.logs).toHaveLength(0);
    expect(nativePush.deferPushToUsers).toHaveBeenCalledWith(
      expect.anything(),
      ["rival"],
      expect.objectContaining({ collapseId: "outbid-auction" }),
    );
    expect((await api.placeBid({ auctionId: "auction", amount: 100 })).success).toBe(
      false,
    );
    expect((await saved()).users.bidder?.bank).toBe(950);
  });

  it("creates one first bid when the same bidder submits different amounts together", async () => {
    const api = callerForDatabase(
      auctionRouter,
      "bidder",
      synchronizeAuctionReads(await getTestDatabase()),
    );
    const results = await Promise.all([
      api.placeBid({ auctionId: "auction", amount: 100 }),
      api.placeBid({ auctionId: "auction", amount: 150 }),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const state = await saved();
    expect(state.bids).toHaveLength(1);
    expect(state.users.bidder?.bank).toBe(1000 - state.listing.currentPrice);
    expect(state.bids[0]?.amount).toBe(state.listing.currentPrice);
  });

  it("rejects a stale competing bidder without lowering the price or debiting the loser", async () => {
    const db = synchronizeAuctionReads(await getTestDatabase());
    const bidder = callerForDatabase(auctionRouter, "bidder", db);
    const rival = callerForDatabase(auctionRouter, "rival", db);
    const results = await Promise.all([
      bidder.placeBid({ auctionId: "auction", amount: 100 }),
      rival.placeBid({ auctionId: "auction", amount: 150 }),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const state = await saved();
    expect(state.bids).toHaveLength(1);
    expect(state.bids[0]?.amount).toBe(state.listing.currentPrice);
    expect((state.users.bidder?.bank ?? 0) + (state.users.rival?.bank ?? 0)).toBe(
      2000 - state.listing.currentPrice,
    );
    expect(state.notifications).toHaveLength(0);
  });

  it("can raise again after refreshing, charging only each increment", async () => {
    await seedBid();
    const api = await callerFor(auctionRouter, "bidder");
    expect(await api.placeBid({ auctionId: "auction", amount: 100 })).toMatchObject({
      success: true,
      amountToDeduct: 50,
    });
    expect(await api.placeBid({ auctionId: "auction", amount: 150 })).toMatchObject({
      success: true,
      amountToDeduct: 50,
    });
    const state = await saved();
    expect(state.users.bidder?.bank).toBe(900);
    expect(state.bids).toHaveLength(1);
    expect(state.bids[0]?.amount).toBe(150);
  });

  it.each([auctionBid, actionLog])(
    "rolls back the debit and listing if a later write fails",
    async (table) => {
      await seedBid();
      const db = await getTestDatabase();
      const failing = inTransactions(db, (tx) => failStatements(tx, table));
      const api = callerForDatabase(auctionRouter, "rival", failing);
      await expect(api.placeBid({ auctionId: "auction", amount: 100 })).rejects.toThrow(
        "Statement failed on purpose",
      );
      const state = await saved();
      expect(state.users.rival?.bank).toBe(1000);
      expect(state.listing.currentPrice).toBe(50);
      expect(state.bids).toHaveLength(1);
      expect(state.bids[0]?.amount).toBe(50);
      expect(state.logs).toHaveLength(0);
      expect(state.notifications).toHaveLength(0);
      expect(state.users.bidder?.unreadNotifications).toBe(0);
    },
  );

  it.each(["CANCELLED", "SOLD", "EXPIRED"] as const)(
    "rejects an in-flight bid after the listing becomes %s",
    async (status) => {
      const db = await getTestDatabase();
      const changed = inTransactions(db, (tx) =>
        beforeStatements(tx, auctionListing, [
          async () => {
            await db
              .update(auctionListing)
              .set({ status })
              .where(eq(auctionListing.id, "auction"));
          },
        ]),
      );
      const api = callerForDatabase(auctionRouter, "bidder", changed);
      expect((await api.placeBid({ auctionId: "auction", amount: 100 })).success).toBe(
        false,
      );
      const state = await saved();
      expect(state.listing.status).toBe(status);
      expect(state.users.bidder?.bank).toBe(1000);
      expect(state.bids).toHaveLength(0);
      expect(state.logs).toHaveLength(0);
    },
  );

  it("does not charge when the seller cancels before the bid claim", async () => {
    const db = await getTestDatabase();
    const seller = await callerFor(auctionRouter, "seller");
    const cancelled = inTransactions(db, (tx) =>
      beforeStatements(tx, auctionListing, [
        async () => {
          expect((await seller.cancelAuction({ auctionId: "auction" })).success).toBe(
            true,
          );
        },
      ]),
    );
    const api = callerForDatabase(auctionRouter, "bidder", cancelled);
    expect((await api.placeBid({ auctionId: "auction", amount: 100 })).success).toBe(
      false,
    );
    const state = await saved();
    expect(state.listing.status).toBe("CANCELLED");
    expect(state.users.bidder?.bank).toBe(1000);
    expect(state.bids).toHaveLength(0);
    expect((await db.select().from(userItem))[0]?.isInAuction).toBe(false);
  });

  it("prevents cancellation after a bid commits", async () => {
    const bidder = await callerFor(auctionRouter, "bidder");
    const seller = await callerFor(auctionRouter, "seller");
    expect((await bidder.placeBid({ auctionId: "auction", amount: 100 })).success).toBe(
      true,
    );
    expect((await seller.cancelAuction({ auctionId: "auction" })).success).toBe(false);
    const state = await saved();
    expect(state.listing.status).toBe("ACTIVE");
    expect(state.bids).toHaveLength(1);
  });

  it("a bid racing seller cancellation either reserves funds or returns the item", async () => {
    const db = synchronizeAuctionReads(await getTestDatabase());
    const bidder = callerForDatabase(auctionRouter, "bidder", db);
    const seller = callerForDatabase(auctionRouter, "seller", db);
    const [bid, cancel] = await Promise.all([
      bidder.placeBid({ auctionId: "auction", amount: 100 }),
      seller.cancelAuction({ auctionId: "auction" }),
    ]);
    expect(Number(bid.success) + Number(cancel.success)).toBe(1);
    const state = await saved();
    expect(state.listing.status).toBe(bid.success ? "ACTIVE" : "CANCELLED");
    expect(state.users.bidder?.bank).toBe(bid.success ? 900 : 1000);
    expect(state.bids).toHaveLength(bid.success ? 1 : 0);
    expect(
      (await (await getTestDatabase()).select().from(userItem))[0]?.isInAuction,
    ).toBe(bid.success);
  });

  it("does not charge a bid whose listing settles after its snapshot", async () => {
    await seedBid();
    const db = await getTestDatabase();
    const settled = inTransactions(db, (tx) =>
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
    const rival = callerForDatabase(auctionRouter, "rival", settled);
    expect((await rival.placeBid({ auctionId: "auction", amount: 100 })).success).toBe(
      false,
    );
    const state = await saved();
    expect(state.listing.status).toBe("SOLD");
    expect(state.users.rival?.bank).toBe(1000);
    expect(state.users.seller?.bank).toBe(1045);
    expect(state.bids).toHaveLength(1);
    expect(state.bids[0]).toMatchObject({ amount: 50, status: "WON" });
  });

  it("rejects a non-raise even if a stale listing price is below the existing bid", async () => {
    await seedBid();
    const db = await getTestDatabase();
    await db
      .update(auctionListing)
      .set({ currentPrice: 10 })
      .where(eq(auctionListing.id, "auction"));
    const api = await callerFor(auctionRouter, "bidder");
    expect((await api.placeBid({ auctionId: "auction", amount: 25 })).success).toBe(
      false,
    );
    expect((await saved()).users.bidder?.bank).toBe(1000);
  });

  it("cannot publish after the deadline passes between the read and claim", async () => {
    const db = await getTestDatabase();
    const expired = inTransactions(db, (tx) =>
      beforeStatements(tx, auctionListing, [
        async () => {
          await db
            .update(auctionListing)
            .set({ expiresAt: new Date(0) })
            .where(eq(auctionListing.id, "auction"));
        },
      ]),
    );
    const api = callerForDatabase(auctionRouter, "bidder", expired);
    expect((await api.placeBid({ auctionId: "auction", amount: 100 })).success).toBe(
      false,
    );
    expect((await saved()).users.bidder?.bank).toBe(1000);
  });

  it("rolls the listing claim back if the available balance changes", async () => {
    const db = await getTestDatabase();
    const spent = inTransactions(db, (tx) =>
      beforeStatements(tx, userData, [
        async () => {
          await db
            .update(userData)
            .set({ bank: 0 })
            .where(eq(userData.userId, "bidder"));
        },
      ]),
    );
    const api = callerForDatabase(auctionRouter, "bidder", spent);
    expect((await api.placeBid({ auctionId: "auction", amount: 100 })).success).toBe(
      false,
    );
    const state = await saved();
    expect(state.listing.currentPrice).toBe(10);
    expect(state.bids).toHaveLength(0);
    expect(state.users.bidder?.bank).toBe(0);
  });

  it("logs a successful outbid and pushes the notice only to the previous bidder", async () => {
    await seedBid();
    const api = await callerFor(auctionRouter, "rival");
    expect((await api.placeBid({ auctionId: "auction", amount: 100 })).success).toBe(
      true,
    );
    const state = await saved();
    expect(state.users.rival?.bank).toBe(900);
    // Notification is the global announcement feed, so the notice is not posted there.
    expect(state.users.bidder?.unreadNotifications).toBe(0);
    expect(state.notifications).toHaveLength(0);
    expect(nativePush.deferPushToUsers).toHaveBeenCalledWith(
      expect.anything(),
      ["bidder"],
      expect.objectContaining({ collapseId: "outbid-auction" }),
    );
    expect(state.logs).toHaveLength(1);
  });

  it("settles a buyout with the committed raised amount", async () => {
    await seedBid();
    const db = await getTestDatabase();
    await db
      .update(auctionListing)
      .set({ buyoutPrice: 100 })
      .where(eq(auctionListing.id, "auction"));
    const api = await callerFor(auctionRouter, "bidder");
    const recorded = await recordQueries(() =>
      api.placeBid({ auctionId: "auction", amount: 100 }),
    );
    expect(recorded.result.success).toBe(true);
    expect(
      recorded.statements.filter((statement) => /STRAIGHT_JOIN/i.test(statement)),
    ).toHaveLength(1);
    expect(
      recorded.statements.some((statement) =>
        /^(begin|start transaction)/i.test(statement.trim()),
      ),
    ).toBe(false);
    const state = await saved();
    expect(state.listing.status).toBe("SOLD");
    expect(state.users.bidder?.bank).toBe(950);
    expect(state.users.seller?.bank).toBe(1090);
    expect(state.bids[0]).toMatchObject({ amount: 100, status: "WON" });
  });

  it("does not overtake a buyout awaiting settlement", async () => {
    await seedBid();
    const db = await getTestDatabase();
    await db
      .update(auctionListing)
      .set({ buyoutPrice: 50 })
      .where(eq(auctionListing.id, "auction"));
    const api = await callerFor(auctionRouter, "rival");
    expect((await api.placeBid({ auctionId: "auction", amount: 100 })).success).toBe(
      false,
    );
    const state = await saved();
    expect(state.users.rival?.bank).toBe(1000);
    expect(state.listing.currentPrice).toBe(50);
  });
});

/** Both resolvers must finish the same listing snapshot before either can mutate it. */
const synchronizeAuctionReads = (db: DrizzleClient) =>
  holdReads(db, "auctionListing", 2);
