import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  battle,
  battleAction,
  battleHistory,
  clan,
  mpvpBattleQueue,
  mpvpBattleUser,
  rankedLoadout,
  rankedPvpQueue,
  rankedSeason,
  userData,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import * as socialQueries from "@/queries/socialUserCache";
import { clanRouter } from "@/server/api/routers/clan";
import { pvpRankRouter } from "@/server/api/routers/pvprank";
import { deleteClanBattle } from "@/server/utils/clanBattle";
import { insertUsers } from "../../../../setup/factories";
import { beforeStatements, failStatements } from "../../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("clan queue claim ownership", () => {
  beforeEach(async () => {
    await resetTables(
      battleAction,
      battleHistory,
      battle,
      mpvpBattleUser,
      mpvpBattleQueue,
      clan,
      rankedPvpQueue,
      rankedLoadout,
      rankedSeason,
      userData,
    );
    await insertUsers(
      ["leader", "enemy"].map((userId) => ({
        userId,
        username: userId,
        clanId: userId === "leader" ? "a" : "b",
        rank: "JONIN" as const,
        rankedLp: 1000,
      })),
    );
    const db = await getTestDatabase();
    await db.insert(clan).values(
      ["a", "b"].map((id) => ({
        id,
        name: id,
        image: "/clan.png",
        villageId: "v",
        founderId: id === "a" ? "leader" : "enemy",
        leaderId: id === "a" ? "leader" : "enemy",
        leaderOrderId: id,
      })),
    );
    await db.insert(mpvpBattleQueue).values(
      ["old", "new"].map((id) => ({
        id,
        attackerEntityId: "a",
        defenderEntityId: "b",
      })),
    );
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  const storedUser = async () =>
    (await getTestDatabase()).query.userData.findFirst({
      where: eq(userData.userId, "leader"),
      columns: { status: true, battleId: true },
    });
  const oldMembership = async () => {
    const db = await getTestDatabase();
    await db.insert(mpvpBattleUser).values({
      id: "old-member",
      clanBattleId: "old",
      userId: "leader",
      side: "ATTACKER",
      slot: 0,
    });
  };

  it("keeps a completed queue departure successful when optional status confirmation fails", async () => {
    const db = await getTestDatabase();
    await oldMembership();
    await db.update(userData).set({ status: "QUEUED" }).where(eq(userData.userId, "leader"));
    vi.spyOn(socialQueries, "findQueueUserCache").mockRejectedValueOnce(new Error("Queue confirmation unavailable"));
    const result = await callerForDatabase(clanRouter, "leader", db).leaveClanBattle({ clanBattleId: "old" });
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
    expect(await storedUser()).toEqual({ status: "AWAKE", battleId: null });
    expect(await db.query.mpvpBattleUser.findMany()).toEqual([]);
  });

  for (const operation of ["challenge", "join"] as const) {
    const join = (client: Awaited<ReturnType<typeof getTestDatabase>>) => {
      const caller = callerForDatabase(clanRouter, "leader", client);
      return operation === "challenge"
        ? caller.challengeClan({ challengerClanId: "a", targetClanId: "b" })
        : caller.joinClanBattle({ clanBattleId: "new" });
    };

    it(`rejects ${operation} while concluded history still owns the membership`, async () => {
      const db = await getTestDatabase();
      await oldMembership();
      await db
        .update(mpvpBattleQueue)
        .set({ battleId: "old-combat", winnerId: "a" })
        .where(eq(mpvpBattleQueue.id, "old"));
      const client = beforeStatements(db, mpvpBattleUser, [
        () => deleteClanBattle(db, { id: "old", battleId: "old-combat" }),
      ]);
      expect((await join(client)).success).toBe(false);
      expect(await storedUser()).toEqual({ status: "AWAKE", battleId: null });
      expect(await db.query.mpvpBattleUser.findMany()).toEqual([
        expect.objectContaining({ id: "old-member", clanBattleId: "old" }),
      ]);
      expect(await db.query.mpvpBattleQueue.findMany()).toHaveLength(2);
    });

    it(`allows ${operation} after history cleanup completes despite a stale preload`, async () => {
      const db = await getTestDatabase();
      await oldMembership();
      await db
        .update(mpvpBattleQueue)
        .set({ battleId: "old-combat", winnerId: "a" })
        .where(eq(mpvpBattleQueue.id, "old"));
      const client = beforeStatements(db, userData, [
        () => deleteClanBattle(db, { id: "old", battleId: "old-combat" }),
      ]);
      expect((await join(client)).success).toBe(true);
      expect(await storedUser()).toEqual({ status: "QUEUED", battleId: null });
      expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(1);
    });

    it(`retries a deadlocked ${operation} claim without duplicating membership`, async () => {
      const db = await getTestDatabase();
      const client = beforeStatements(db, userData, [
        async () => {
          throw new Error("Deadlock found when trying to get lock");
        },
      ]);
      expect((await join(client)).success).toBe(true);
      expect(await storedUser()).toEqual({ status: "QUEUED", battleId: null });
      expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(1);
    });

    for (const cleanup of ["leave", "kick", "undo"] as const) {
      for (const publishBeforeCleanup of [false, true]) {
        it(`${operation} ${publishBeforeCleanup ? "preserves its published membership" : "rejects its lost claim"} after delayed ${cleanup}`, async () => {
          const db = await getTestDatabase();
          if (cleanup !== "undo") {
            await oldMembership();
            await db
              .update(userData)
              .set({ status: "QUEUED" })
              .where(eq(userData.userId, "leader"));
          }
          let signalReady = () => {};
          let releaseInsert = () => {};
          const ready = new Promise<void>((resolve) => {
            signalReady = resolve;
          });
          const wait = new Promise<void>((resolve) => {
            releaseInsert = resolve;
          });
          let joining: ReturnType<typeof join> | undefined;
          let replacement: Promise<void> | undefined;
          const replace = () =>
            (replacement ??= (async () => {
              expect(await deleteClanBattle(db, { id: "old", battleId: null })).toBe(
                true,
              );
              const joiningClient = publishBeforeCleanup
                ? db
                : beforeStatements(db, mpvpBattleUser, [
                    async () => {
                      signalReady();
                      await wait;
                    },
                  ]);
              joining = join(joiningClient);
              if (publishBeforeCleanup) expect((await joining).success).toBe(true);
              else await ready;
            })());
          let client = db;
          if (cleanup === "undo") {
            let reads = 0;
            client = new Proxy(db, {
              get(target, property, receiver) {
                if (property !== "query")
                  return Reflect.get(target, property, receiver);
                return {
                  ...target.query,
                  mpvpBattleQueue: {
                    ...target.query.mpvpBattleQueue,
                    findFirst: async (
                      ...args: Parameters<typeof target.query.mpvpBattleQueue.findFirst>
                    ) => {
                      // Delete the old join's lobby after insertion but before validation.
                      if (++reads === 2) await replace();
                      return target.query.mpvpBattleQueue.findFirst(...args);
                    },
                  },
                };
              },
            });
          } else {
            // Delay every old cleanup write until the replacement has claimed QUEUED.
            client = beforeStatements(db, mpvpBattleQueue, [replace]);
            client = beforeStatements(client, mpvpBattleUser, [replace]);
            client = beforeStatements(client, userData, [replace]);
          }
          const caller = callerForDatabase(clanRouter, "leader", client);
          try {
            const result =
              cleanup === "leave"
                ? await caller.leaveClanBattle({ clanBattleId: "old" })
                : cleanup === "kick"
                  ? await caller.kickFromClanBattle({
                      clanBattleId: "old",
                      targetId: "leader",
                      clanId: "a",
                    })
                  : await caller.joinClanBattle({ clanBattleId: "old" });
            expect(result.success).toBe(cleanup !== "undo");
            releaseInsert();
            expect((await joining)?.success).toBe(publishBeforeCleanup);
            expect(await storedUser()).toEqual({
              status: publishBeforeCleanup ? "QUEUED" : "AWAKE",
              battleId: null,
            });
            expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(
              Number(publishBeforeCleanup),
            );
            expect(await db.query.mpvpBattleQueue.findMany()).toHaveLength(
              operation === "challenge" && publishBeforeCleanup ? 2 : 1,
            );
          } finally {
            releaseInsert();
            await joining;
          }
        });
      }
    }

    it(`rejects ${operation} when ranked PvP acquires QUEUED before membership publication`, async () => {
      const db = await getTestDatabase();
      const client = beforeStatements(db, mpvpBattleUser, [
        async () => {
          // A delayed cleanup can release the unpublished clan claim.
          await db
            .update(userData)
            .set({ status: "AWAKE" })
            .where(eq(userData.userId, "leader"));
          expect(
            (await callerForDatabase(pvpRankRouter, "leader", db).queueForRankedPvp())
              .success,
          ).toBe(true);
        },
      ]);
      expect((await join(client)).success).toBe(false);
      expect(await storedUser()).toEqual({ status: "QUEUED", battleId: null });
      expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(0);
      expect(await db.query.rankedPvpQueue.findMany()).toEqual([
        expect.objectContaining({ userId: "leader", hasClaimed: true }),
      ]);
      expect(
        (await callerForDatabase(pvpRankRouter, "leader", db).getRankedPvpQueue())
          .inQueue,
      ).toBe(true);
      expect(await db.query.mpvpBattleQueue.findMany()).toHaveLength(2);
    });

    it(`rejects ${operation} until a leaving ranked owner's row is removed`, async () => {
      const db = await getTestDatabase();
      const ranked = callerForDatabase(pvpRankRouter, "leader", db);
      expect((await ranked.queueForRankedPvp()).success).toBe(true);
      const client = beforeStatements(db, rankedPvpQueue, [
        async () => {
          // Ranked leave wakes in parallel; keep its old claimed row until clan queuing finishes.
          for (let attempts = 0; attempts < 100; attempts++) {
            if ((await storedUser())?.status === "AWAKE") break;
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
          expect(await storedUser()).toEqual({ status: "AWAKE", battleId: null });
          expect((await join(db)).success).toBe(false);
        },
      ]);
      expect(
        (await callerForDatabase(pvpRankRouter, "leader", client).leaveRankedPvpQueue())
          .success,
      ).toBe(true);
      expect(await storedUser()).toEqual({ status: "AWAKE", battleId: null });
      expect(await db.query.rankedPvpQueue.findMany()).toHaveLength(0);
      expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(0);
    });

    it(`preserves newer combat when ${operation} loses its status claim`, async () => {
      const db = await getTestDatabase();
      const client = beforeStatements(db, mpvpBattleUser, [
        () =>
          db
            .update(userData)
            .set({ status: "BATTLE", battleId: "newer-combat" })
            .where(eq(userData.userId, "leader")),
      ]);
      expect((await join(client)).success).toBe(false);
      expect(await storedUser()).toEqual({
        status: "BATTLE",
        battleId: "newer-combat",
      });
      expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(0);
      expect(await db.query.mpvpBattleQueue.findMany()).toHaveLength(2);
    });

    it(`preserves a newer clan owner when ${operation}'s membership insert loses`, async () => {
      const db = await getTestDatabase();
      let winningEntryId = "";
      const client = beforeStatements(db, mpvpBattleUser, [
        async () => {
          await db
            .update(userData)
            .set({ status: "AWAKE" })
            .where(eq(userData.userId, "leader"));
          expect(
            (
              await callerForDatabase(clanRouter, "leader", db).joinClanBattle({
                clanBattleId: "new",
              })
            ).success,
          ).toBe(true);
          winningEntryId = (await db.query.mpvpBattleUser.findFirst())?.id ?? "";
        },
      ]);
      expect((await join(client)).success).toBe(false);
      expect(await storedUser()).toEqual({ status: "QUEUED", battleId: null });
      expect(await db.query.mpvpBattleUser.findMany()).toEqual([
        expect.objectContaining({ id: winningEntryId, clanBattleId: "new" }),
      ]);
      expect(await db.query.mpvpBattleQueue.findMany()).toHaveLength(2);
    });

    it(`rejects ${operation} after the lobby reserves combat before member publication`, async () => {
      const db = await getTestDatabase();
      const client = beforeStatements(db, mpvpBattleUser, [
        async () => {
          if (operation === "challenge") {
            // Wait for the parallel challenge-lobby insert before reserving it.
            for (let attempts = 0; attempts < 100; attempts++) {
              if ((await db.query.mpvpBattleQueue.findMany()).length === 3) break;
              await new Promise((resolve) => setTimeout(resolve, 1));
            }
          }
          const lobbies = await db.query.mpvpBattleQueue.findMany();
          const lobby = lobbies.find((q) =>
            operation === "challenge" ? !["old", "new"].includes(q.id) : q.id === "new",
          );
          expect(lobby).toBeDefined();
          if (!lobby) throw new Error("Challenge lobby was not published");
          await db
            .update(mpvpBattleQueue)
            .set({ battleId: "reserved-combat" })
            .where(eq(mpvpBattleQueue.id, lobby.id));
        },
      ]);
      expect((await join(client)).success).toBe(false);
      expect(await storedUser()).toEqual({ status: "AWAKE", battleId: null });
      expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(0);
      expect(
        await db.query.mpvpBattleQueue.findMany({
          where: eq(mpvpBattleQueue.battleId, "reserved-combat"),
        }),
      ).toHaveLength(1);
    });
  }

  it("settles a delayed challenge-lobby insert before compensating a lost membership", async () => {
    const db = await getTestDatabase();
    let signalMemberFailed = () => {};
    const memberFailed = new Promise<void>((resolve) => {
      signalMemberFailed = resolve;
    });
    // Hold the lobby insertion until the membership insertion has already rejected.
    let client = beforeStatements(db, mpvpBattleQueue, [
      async () => {
        await memberFailed;
        await new Promise((resolve) => setTimeout(resolve, 10));
      },
    ]);
    client = beforeStatements(client, mpvpBattleUser, [
      async () => {
        await db
          .update(userData)
          .set({ status: "AWAKE" })
          .where(eq(userData.userId, "leader"));
        expect(
          (
            await callerForDatabase(clanRouter, "leader", db).joinClanBattle({
              clanBattleId: "new",
            })
          ).success,
        ).toBe(true);
        signalMemberFailed();
        throw new Error("Duplicate entry for MpvpBattleUser_userId_key");
      },
    ]);
    const result = await callerForDatabase(clanRouter, "leader", client).challengeClan({
      challengerClanId: "a",
      targetClanId: "b",
    });
    expect(result.success).toBe(false);
    expect(await storedUser()).toEqual({ status: "QUEUED", battleId: null });
    expect(await db.query.mpvpBattleQueue.findMany()).toHaveLength(2);
    expect(await db.query.mpvpBattleUser.findMany()).toEqual([
      expect.objectContaining({ clanBattleId: "new", userId: "leader" }),
    ]);
  });

  it("releases a failed challenge claim and propagates unexpected insertion errors", async () => {
    const db = await getTestDatabase();
    const caller = callerForDatabase(
      clanRouter,
      "leader",
      failStatements(db, mpvpBattleUser),
    );
    await expect(
      caller.challengeClan({ challengerClanId: "a", targetClanId: "b" }),
    ).rejects.toThrow("Statement failed on purpose");
    expect(await storedUser()).toEqual({ status: "AWAKE", battleId: null });
    expect(await db.query.mpvpBattleQueue.findMany()).toHaveLength(2);
    expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(0);
  });
});
