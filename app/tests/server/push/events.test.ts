import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import * as next from "next/server";
import { userData } from "@/drizzle/schema";
import { completeAuctionInternal } from "@/server/api/routers/auction";
import type { DrizzleClient } from "@/server/db";
import * as push from "@/server/utils/push";
import { notifyWarVillages } from "@/server/utils/push/war";
import { deferred as createDeferred } from "../../setup/deferred";

const deferred: Array<() => unknown> = [];
const send = vi.fn();
const enabled = vi.fn();
beforeEach(() => {
  deferred.length = 0;
  send.mockReset().mockResolvedValue({ sent: 1, failed: 0, expiredTokens: [] });
  enabled.mockReset().mockReturnValue(true);
  vi.spyOn(push, "isPushEnabled").mockImplementation(enabled);
  vi.spyOn(push, "sendPushToUsers").mockImplementation(send);
  vi.spyOn(next, "after").mockImplementation((callback) => {
    deferred.push(callback as () => unknown);
  });
  vi.spyOn(Sentry, "captureException").mockReturnValue("test-event");
});
afterEach(() => vi.restoreAllMocks());

describe("war native alerts", () => {
  it("loads village recipients and fans out only after the response", async () => {
    const where = vi.fn().mockResolvedValue([{ userId: "native-member" }]);
    const selectDistinct = vi.fn(() => ({
      from: () => ({ innerJoin: () => ({ where }) }),
    }));
    const client = { selectDistinct } as unknown as DrizzleClient;
    notifyWarVillages(client, ["attacker", "defender", "attacker"], "war-one");
    expect(selectDistinct).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    await deferred[0]?.();
    expect(where).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      client,
      ["native-member"],
      expect.objectContaining({
        category: "war",
        url: "/townhall",
        collapseId: "war-war-one",
      }),
    );
  });
  it("does not schedule empty villages or unconfigured transports", () => {
    const client = {} as DrizzleClient;
    notifyWarVillages(client, [], "one");
    enabled.mockReturnValue(false);
    notifyWarVillages(client, ["village"], "one");
    expect(deferred).toHaveLength(0);
  });
  it("contains roster-read failures without failing the committed game action", async () => {
    const client = {
      selectDistinct: () => {
        throw new Error("database unavailable");
      },
    } as unknown as DrizzleClient;
    notifyWarVillages(client, ["village"], "one");
    await deferred[0]?.();
    expect(send).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});

describe("auction result native alerts", () => {
  const auction = {
    id: "auction-one",
    sellerId: "seller",
    userItemId: "item-one",
    currencyType: "MONEY",
    currentPrice: 200,
    bids: [
      {
        id: "bid-one",
        bidderId: "winner",
        amount: 200,
        status: "ACTIVE",
        createdAt: new Date(0),
      },
      {
        id: "bid-two",
        bidderId: "refunded",
        amount: 100,
        status: "ACTIVE",
        createdAt: new Date(0),
      },
    ],
  };
  const settlementClient = (bids = auction.bids) => {
    const update = vi.fn(() => ({
      set: () => ({ where: () => Promise.resolve({ rowsAffected: 1 }) }),
    }));
    const tx = {
      update,
      query: { auctionListing: { findFirst: async () => ({ ...auction, bids }) } },
    };
    // The batched payment touches seller, winner and refund recipient together.
    const payment = vi.fn(() => ({
      set: () => ({ where: () => Promise.resolve({ rowsAffected: 3 }) }),
    }));
    const transaction = vi.fn(async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        ...tx,
        update: (table: unknown) => (table === userData ? payment() : update()),
      }),
    );
    const execute = vi.fn(async () => ({ rowsAffected: 2 }));
    return {
      client: { transaction, execute, query: tx.query } as unknown as DrizzleClient,
      transaction,
      execute,
    };
  };
  it("waits for the settlement commit before notifying participants", async () => {
    const { client, transaction } = settlementClient();
    const { promise: commit, resolve: committed } = createDeferred<void>();
    const run = transaction.getMockImplementation()!;
    transaction.mockImplementation(async (work) => {
      const result = await run(work);
      await commit;
      expect(deferred).toHaveLength(0);
      return result;
    });
    const finishing = completeAuctionInternal(client, auction.id);
    expect(deferred).toHaveLength(0);
    committed();
    expect(await finishing).toEqual(
      expect.objectContaining({
        success: true,
        winningBid: expect.objectContaining(auction.bids[0]!),
      }),
    );
    expect(deferred).toHaveLength(1);
    await deferred[0]?.();
    expect(send).toHaveBeenCalledWith(
      client,
      ["seller", "winner", "refunded"],
      expect.objectContaining({
        category: "trade",
        url: "/auctionhouse",
        collapseId: "trade-auction-one",
      }),
    );
  });
  it("notifies only the seller for an expired listing with no bids", async () => {
    const { client } = settlementClient([]);
    expect(await completeAuctionInternal(client, auction.id)).toMatchObject({
      success: true,
      winningBid: null,
    });
    await deferred[0]?.();
    expect(send.mock.calls[0]?.[1]).toEqual(["seller"]);
  });
  it("waits for a no-bid statement before notifying its seller", async () => {
    const { client, execute, transaction } = settlementClient([]);
    const { promise: statement, resolve: finish } = createDeferred<void>();
    execute.mockImplementation(async () => {
      expect(deferred).toHaveLength(0);
      await statement;
      return { rowsAffected: 2 };
    });
    const finishing = completeAuctionInternal(client, auction.id);
    expect(deferred).toHaveLength(0);
    finish();
    expect((await finishing).success).toBe(true);
    expect(transaction).not.toHaveBeenCalled();
    expect(deferred).toHaveLength(1);
  });
  it("does not announce completion when the transaction fails", async () => {
    const { client, transaction } = settlementClient();
    transaction.mockRejectedValue(new Error("write failed"));
    await expect(completeAuctionInternal(client, auction.id)).rejects.toThrow(
      "write failed",
    );
    expect(deferred).toHaveLength(0);
  });
});
