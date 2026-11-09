import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  rankedLoadout,
  rankedPvpQueue,
  rankedSeason,
  userData,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { pvpRankRouter } from "@/server/api/routers/pvprank";
import { deferred } from "../../../../setup/deferred";
import { insertUsers } from "../../../../setup/factories";
import { beforeStatements, failStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const USER = "ranked-player";

describeWithDatabase("ranked queue claims and cleanup", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(rankedPvpQueue, rankedLoadout, rankedSeason, userData);
    await insertUsers([
      { userId: USER, username: USER, rank: "JONIN", rankedLp: 1000, status: "AWAKE" },
    ]);
  });

  const storedUser = async () =>
    (await getTestDatabase()).query.userData.findFirst({
      where: eq(userData.userId, USER),
    });
  const storedQueue = async () =>
    (await getTestDatabase()).query.rankedPvpQueue.findMany({
      where: eq(rankedPvpQueue.userId, USER),
    });

  it("joins once and intentionally leaves a QUEUED user's row", async () => {
    const caller = await callerFor(pvpRankRouter, USER);
    expect(await caller.getRankedQueueCount()).toBe(0);
    expect((await caller.queueForRankedPvp()).success).toBe(true);
    expect(await caller.getRankedQueueCount()).toBe(1);
    expect(Pusher.prototype.trigger).toHaveBeenCalledWith(
      "ranked-queue",
      "updated",
      {},
    );
    expect((await storedUser())?.status).toBe("QUEUED");
    expect(await storedQueue()).toHaveLength(1);
    expect(await caller.queueForRankedPvp()).toMatchObject({
      success: false,
      message: "Already in queue",
    });
    expect((await caller.leaveRankedPvpQueue()).success).toBe(true);
    expect((await storedUser())?.status).toBe("AWAKE");
    expect(await storedQueue()).toHaveLength(0);
    expect(await caller.getRankedQueueCount()).toBe(0);
    expect(Pusher.prototype.trigger).toHaveBeenCalledTimes(2);
  });

  it("removes only a losing join's row after another preloaded join wins", async () => {
    const db = await getTestDatabase();
    const winner = await callerFor(pvpRankRouter, USER);
    let winningQueueId = "";
    const client = beforeStatements(db, rankedPvpQueue, [
      async () => {
        // Both requests read an empty queue before either publishes its row.
        expect((await winner.queueForRankedPvp()).success).toBe(true);
        winningQueueId = (await storedQueue())[0]?.id ?? "";
      },
    ]);
    expect(
      await callerForDatabase(pvpRankRouter, USER, client).queueForRankedPvp(),
    ).toMatchObject({ success: false, message: "Need to be awake to queue" });
    expect((await storedUser())?.status).toBe("QUEUED");
    expect((await storedQueue()).map((entry) => entry.id)).toEqual([winningQueueId]);
    expect(await winner.getRankedQueueCount()).toBe(1);
    expect(Pusher.prototype.trigger).toHaveBeenCalledTimes(1);
  });

  it("ignores a provisional row until its join claims QUEUED", async () => {
    const db = await getTestDatabase();
    const matcher = await callerFor(pvpRankRouter, USER);
    const client = beforeStatements(db, userData, [
      async () => {
        expect((await storedUser())?.status).toBe("AWAKE");
        expect(await storedQueue()).toHaveLength(1);
        expect((await storedQueue())[0]?.hasClaimed).toBe(false);
        expect((await matcher.checkRankedPvpMatches()).success).toBe(false);
        expect(await storedQueue()).toHaveLength(1);
      },
    ]);
    expect(
      await callerForDatabase(pvpRankRouter, USER, client).queueForRankedPvp(),
    ).toMatchObject({ success: true });
    expect((await storedUser())?.status).toBe("QUEUED");
    expect(await storedQueue()).toEqual([
      expect.objectContaining({ hasClaimed: true }),
    ]);
  });

  it("rejects a preloaded join after a concurrent leave removes its row", async () => {
    const db = await getTestDatabase();
    const winner = await callerFor(pvpRankRouter, USER);
    const publishing = beforeStatements(db, rankedPvpQueue, [
      async () => {
        expect((await winner.queueForRankedPvp()).success).toBe(true);
      },
    ]);
    const client = beforeStatements(publishing, userData, [
      async () => {
        expect(await storedQueue()).toHaveLength(2);
        expect((await winner.leaveRankedPvpQueue()).success).toBe(true);
      },
    ]);
    expect(
      await callerForDatabase(pvpRankRouter, USER, client).queueForRankedPvp(),
    ).toMatchObject({ success: false, message: "Need to be awake to queue" });
    expect((await storedUser())?.status).toBe("AWAKE");
    expect(await storedQueue()).toHaveLength(0);
  });

  for (const endpoint of ["checkRankedPvpMatches", "getRankedPvpQueue"] as const) {
    it(`${endpoint} preserves a join claimed after its stale status read`, async () => {
      const db = await getTestDatabase();
      const { promise: ready, resolve: claimReady } = deferred<void>();
      const { promise: wait, resolve: releaseClaim } = deferred<void>();
      const joiningClient = beforeStatements(db, rankedPvpQueue, [
        async () => {
          // The join has preloaded an empty queue. Publish an old claimed orphan
          // for cleanup to read while this new join waits before its own insert.
          await db
            .insert(rankedPvpQueue)
            .values({ id: "orphan", userId: USER, rankedLp: 1000 });
          claimReady();
          await wait;
        },
      ]);
      const joining = callerForDatabase(
        pvpRankRouter,
        USER,
        joiningClient,
      ).queueForRankedPvp();
      await ready;
      try {
        expect((await storedUser())?.status).toBe("AWAKE");
        expect(await storedQueue()).toHaveLength(1);
        const cleanerClient = beforeStatements(db, rankedPvpQueue, [
          async () => {
            // Another cleanup removes the old row; the guarded DELETE must preserve
            // the fresh owner that claims QUEUED after this endpoint read AWAKE.
            await db.delete(rankedPvpQueue).where(eq(rankedPvpQueue.id, "orphan"));
            releaseClaim();
            expect((await joining).success).toBe(true);
            expect((await storedUser())?.status).toBe("QUEUED");
          },
        ]);
        await callerForDatabase(pvpRankRouter, USER, cleanerClient)[endpoint]();
        expect((await storedUser())?.status).toBe("QUEUED");
        expect(await storedQueue()).toEqual([
          expect.objectContaining({ hasClaimed: true }),
        ]);
      } finally {
        releaseClaim();
        await joining;
      }
    });

    it(`${endpoint} still removes an orphaned row`, async () => {
      const db = await getTestDatabase();
      await db
        .insert(rankedPvpQueue)
        .values({ id: "orphan", userId: USER, rankedLp: 1000 });
      await (await callerFor(pvpRankRouter, USER))[endpoint]();
      expect((await storedUser())?.status).toBe("AWAKE");
      expect(await storedQueue()).toHaveLength(0);
    });
  }

  it("counts claimed entries within expiry without requiring cleaner deletion", async () => {
    const db = await getTestDatabase();
    await db.insert(rankedPvpQueue).values([
      {
        id: "expired",
        userId: "expired",
        rankedLp: 1000,
        createdAt: new Date(Date.now() - 25 * 3_600_000),
      },
      { id: "live", userId: "live", rankedLp: 1000 },
      { id: "provisional", userId: "provisional", rankedLp: 1000, hasClaimed: false },
    ]);
    const caller = await callerFor(pvpRankRouter, USER);
    expect(await caller.getRankedQueueCount()).toBe(1);
    expect((await caller.getRankedPvpQueue()).queueCount).toBe(1);
    expect(await db.query.rankedPvpQueue.findMany()).toHaveLength(3);
    await db.delete(rankedPvpQueue).where(eq(rankedPvpQueue.id, "live"));
    expect(await caller.getRankedQueueCount()).toBe(0);
  });

  it("keeps committed joins and leaves successful when push delivery fails", async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockRejectedValue(
      new Error("Socket unavailable"),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const caller = await callerFor(pvpRankRouter, USER);
    expect((await caller.queueForRankedPvp()).success).toBe(true);
    expect(await caller.getRankedQueueCount()).toBe(1);
    expect((await caller.leaveRankedPvpQueue()).success).toBe(true);
    expect(await caller.getRankedQueueCount()).toBe(0);
    expect(warning).toHaveBeenCalledTimes(2);
  });

  it("retries a deadlocked claim without publishing another row", async () => {
    const db = await getTestDatabase();
    const client = beforeStatements(db, userData, [
      async () => {
        expect(await storedQueue()).toHaveLength(1);
        throw new Error("Deadlock found when trying to get lock");
      },
    ]);
    expect(
      (await callerForDatabase(pvpRankRouter, USER, client).queueForRankedPvp())
        .success,
    ).toBe(true);
    expect((await storedUser())?.status).toBe("QUEUED");
    expect(await storedQueue()).toHaveLength(1);
  });

  it("cleans the provisional row and propagates an unexpected claim failure", async () => {
    const db = await getTestDatabase();
    const caller = callerForDatabase(pvpRankRouter, USER, failStatements(db, userData));
    await expect(caller.queueForRankedPvp()).rejects.toThrow(
      "Statement failed on purpose",
    );
    expect((await storedUser())?.status).toBe("AWAKE");
    expect(await storedQueue()).toHaveLength(0);
  });

  it("leaves status untouched when publishing the queue row fails", async () => {
    const db = await getTestDatabase();
    const caller = callerForDatabase(
      pvpRankRouter,
      USER,
      failStatements(db, rankedPvpQueue),
    );
    await expect(caller.queueForRankedPvp()).rejects.toThrow(
      "Statement failed on purpose",
    );
    expect((await storedUser())?.status).toBe("AWAKE");
    expect(await storedQueue()).toHaveLength(0);
    expect(Pusher.prototype.trigger).not.toHaveBeenCalled();
  });
});
