import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import {
  aiProfile,
  battle,
  battleHistory,
  clan,
  logQueueLengths,
  logRankedPicks,
  mpvpBattleQueue,
  mpvpBattleUser,
  rankedLoadout,
  rankedPvpQueue,
  rankedSeason,
  userData,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { clanRouter } from "@/server/api/routers/clan";
import { initiateBattle } from "@/server/api/routers/combat";
import { deleteUserRankedQueueRow, pvpRankRouter } from "@/server/api/routers/pvprank";
import { deleteClanBattle } from "@/server/utils/clanBattle";
import { battleClaimRollbackStatus } from "@/server/utils/concurrency";
import * as ranked from "@/server/utils/ranked";
import { deferred } from "../../../../setup/deferred";
import {
  insertClans,
  insertDefaultAiProfile,
  insertUsers,
} from "../../../../setup/factories";
import {
  beforeStatements,
  interceptExecute,
  overrideQuery,
} from "../../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../../../../setup/testDatabase";
import { readUser } from "../../../../setup/userReads";

describeWithDatabase("ranked queue ownership across clan cleanup", () => {
  beforeEach(async () => {
    await resetTables(
      battleHistory,
      battle,
      aiProfile,
      logQueueLengths,
      logRankedPicks,
      mpvpBattleUser,
      mpvpBattleQueue,
      clan,
      rankedPvpQueue,
      rankedLoadout,
      rankedSeason,
      userData,
    );
    await insertUsers(
      ["member", "leader", "enemy"].map((userId) => ({
        userId,
        username: userId,
        clanId: userId === "enemy" ? "b" : "a",
        rank: "JONIN" as const,
        rankedLp: 1000,
        isOutlaw: true,
      })),
    );
    const db = await getTestDatabase();
    await insertClans(
      ["a", "b"].map((id) => ({
        id,
        villageId: "v",
        leaderId: id === "a" ? "leader" : "enemy",
        leaderOrderId: id,
      })),
    );
    await db.insert(mpvpBattleQueue).values({
      id: "q",
      attackerEntityId: "a",
      defenderEntityId: "b",
      createdAt: new Date(0),
    });
    await insertDefaultAiProfile();
    await db.insert(rankedLoadout).values(
      ["member", "leader"].map((userId) => ({
        id: userId,
        userId,
        loadout: { jutsuIds: [], weaponIds: [], consumableIds: [], skillIds: [] },
      })),
    );
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  const storedUser = (userId = "member") => readUser(userId);
  const queueRows = async () =>
    (await getTestDatabase()).query.rankedPvpQueue.findMany();
  const claimClanQueue = async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ status: "QUEUED" })
      .where(eq(userData.userId, "member"));
    await db.insert(mpvpBattleUser).values({
      id: "member-q",
      clanBattleId: "q",
      userId: "member",
      side: "ATTACKER",
      slot: 0,
    });
  };
  /** Every user queued, with both sides of the `q` lobby filled. */
  const queueFullLobby = async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ status: "QUEUED" });
    await db.insert(mpvpBattleUser).values([
      {
        id: "leader-q",
        clanBattleId: "q",
        userId: "leader",
        side: "ATTACKER",
        slot: 0,
        createdAt: new Date(0),
      },
      {
        id: "member-q",
        clanBattleId: "q",
        userId: "member",
        side: "ATTACKER",
        slot: 1,
        createdAt: new Date(1),
      },
      {
        id: "enemy-q",
        clanBattleId: "q",
        userId: "enemy",
        side: "DEFENDER",
        slot: 0,
        createdAt: new Date(0),
      },
    ]);
  };
  const depart = (
    caller: ReturnType<typeof clanRouter.createCaller>,
    operation: "leave" | "kick",
  ) =>
    operation === "leave"
      ? caller.leaveClanBattle({ clanBattleId: "q" })
      : caller.kickFromClanBattle({
          clanBattleId: "q",
          targetId: "member",
          clanId: "a",
        });

  it("keeps existing queue entries claimed when applying the migration", async () => {
    const db = await getTestDatabase();
    const migration = await readFile(
      new URL(
        "../../../../../drizzle/migrations/0075_watery_moondragon.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await runRawSql("ALTER TABLE RankedPvpQueue DROP COLUMN hasClaimed");
    try {
      await runRawSql(
        "INSERT INTO RankedPvpQueue (id, userId, rankedLp) VALUES ('existing', 'member', 1000)",
      );
    } finally {
      await runRawSql(migration);
    }
    expect(await db.query.rankedPvpQueue.findFirst()).toMatchObject({
      id: "existing",
      hasClaimed: true,
    });
  });

  it("rejects a user already queued for a clan without publishing a ranked row", async () => {
    const db = await getTestDatabase();
    await claimClanQueue();
    expect(
      (await callerForDatabase(pvpRankRouter, "member", db).queueForRankedPvp())
        .success,
    ).toBe(false);
    expect(await queueRows()).toHaveLength(0);
    expect(await storedUser()).toMatchObject({ status: "QUEUED", battleId: null });
  });

  for (const deleteBeforeClaim of [false, true]) {
    it(`releases a concurrent clan claim with deletion ${deleteBeforeClaim ? "before" : "after"} the ranked claim`, async () => {
      const db = await getTestDatabase();
      const published = beforeStatements(db, rankedPvpQueue, [claimClanQueue]);
      const client = deleteBeforeClaim
        ? beforeStatements(published, userData, [
            async () => {
              expect(await queueRows()).toEqual([
                expect.objectContaining({ hasClaimed: false }),
              ]);
              expect(await deleteClanBattle(db, { id: "q", battleId: null })).toBe(
                true,
              );
              expect(await storedUser()).toMatchObject({ status: "AWAKE" });
            },
          ])
        : published;
      expect(
        (await callerForDatabase(pvpRankRouter, "member", client).queueForRankedPvp())
          .success,
      ).toBe(deleteBeforeClaim);
      if (!deleteBeforeClaim)
        expect(await deleteClanBattle(db, { id: "q", battleId: null })).toBe(true);
      expect(await storedUser()).toMatchObject({
        status: deleteBeforeClaim ? "QUEUED" : "AWAKE",
        battleId: null,
      });
      expect(await queueRows()).toHaveLength(deleteBeforeClaim ? 1 : 0);
      if (deleteBeforeClaim) expect((await queueRows())[0]?.hasClaimed).toBe(true);
      expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(0);
    });
  }

  it("hides a provisional ranked row from reads and matchmaking while a clan owns status", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ status: "QUEUED" })
      .where(eq(userData.userId, "leader"));
    await db
      .insert(rankedPvpQueue)
      .values({ id: "opponent", userId: "leader", rankedLp: 1000 });
    const published = beforeStatements(db, rankedPvpQueue, [claimClanQueue]);
    const client = beforeStatements(published, userData, [
      async () => {
        expect(await queueRows()).toHaveLength(2);
        const member = callerForDatabase(pvpRankRouter, "member", db);
        expect(await member.getRankedPvpQueue()).toMatchObject({
          inQueue: false,
          queueCount: 1,
        });
        expect(await member.getRankedQueueCount()).toBe(1);
        expect((await member.checkRankedPvpMatches()).success).toBe(false);
        expect(
          (await callerForDatabase(pvpRankRouter, "leader", db).checkRankedPvpMatches())
            .success,
        ).toBe(false);
        expect(await storedUser()).toMatchObject({ status: "QUEUED", battleId: null });
        expect(await db.query.battle.findMany()).toHaveLength(0);
      },
    ]);
    expect(
      (await callerForDatabase(pvpRankRouter, "member", client).queueForRankedPvp())
        .success,
    ).toBe(false);
    expect(await queueRows()).toEqual([
      expect.objectContaining({ id: "opponent", hasClaimed: true }),
    ]);
    expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(1);
  });

  it("signals the aggregate after a successful match removes both queue entries", async () => {
    const db = await getTestDatabase();
    const member = callerForDatabase(pvpRankRouter, "member", db);
    const leader = callerForDatabase(pvpRankRouter, "leader", db);
    expect((await member.queueForRankedPvp()).success).toBe(true);
    expect((await leader.queueForRankedPvp()).success).toBe(true);
    expect(await member.getRankedQueueCount()).toBe(2);
    vi.clearAllMocks();
    expect(await member.checkRankedPvpMatches()).toMatchObject({
      success: true,
      message: "Match found!",
    });
    expect(await queueRows()).toHaveLength(0);
    expect(await member.getRankedQueueCount()).toBe(0);
    expect(Pusher.prototype.trigger).toHaveBeenCalledWith(
      "ranked-queue",
      "updated",
      {},
    );
  });

  it("logs every pick of both loadouts, counting selections they share", async () => {
    const db = await getTestDatabase();
    const clean = ranked.cleanRankedProhibitedSelections;
    vi.spyOn(ranked, "cleanRankedProhibitedSelections").mockImplementation(
      async (...args) => {
        const cleaned = await clean(...args);
        const { userId } = args[1];
        return {
          ...cleaned,
          loadout: {
            ...cleaned.loadout,
            loadout: {
              ...cleaned.loadout.loadout,
              jutsuIds: [`jutsu-${userId}`, "shared"],
              weaponIds: [`weapon-${userId}`],
              consumableIds: ["shared"],
            },
          },
        };
      },
    );
    const member = callerForDatabase(pvpRankRouter, "member", db);
    expect((await member.queueForRankedPvp()).success).toBe(true);
    expect(
      (await callerForDatabase(pvpRankRouter, "leader", db).queueForRankedPvp())
        .success,
    ).toBe(true);
    expect(await member.checkRankedPvpMatches()).toMatchObject({ success: true });
    const picks = await db.query.logRankedPicks.findMany();
    expect(
      picks
        .map(
          ({ type, contentId, battleType, count }) =>
            `${type} ${contentId} ${battleType} ${count}`,
        )
        .sort(),
    ).toEqual([
      "consumable shared RANKED_PVP 2",
      "item weapon-leader RANKED_PVP 1",
      "item weapon-member RANKED_PVP 1",
      "jutsu jutsu-leader RANKED_PVP 1",
      "jutsu jutsu-member RANKED_PVP 1",
      "jutsu shared RANKED_PVP 2",
    ]);
  });

  it("requires claimed ranked ownership at the final combat claim and rollback", async () => {
    const db = await getTestDatabase();
    await claimClanQueue();
    await db
      .update(userData)
      .set({ status: "QUEUED" })
      .where(eq(userData.userId, "leader"));
    await db.insert(rankedPvpQueue).values([
      { id: "provisional", userId: "member", rankedLp: 1000, hasClaimed: false },
      { id: "opponent", userId: "leader", rankedLp: 1000 },
    ]);
    const result = await initiateBattle(
      {
        client: db,
        userIds: ["member"],
        targetIds: ["leader"],
        biome: "arena",
      },
      "RANKED_PVP",
    );
    expect(result.success).toBe(false);
    expect(await db.query.battle.findMany()).toHaveLength(0);
    expect(await storedUser("leader")).toMatchObject({
      status: "QUEUED",
      battleId: null,
    });
    const restored = await db
      .select({
        status: sql`${battleClaimRollbackStatus(db, "RANKED_PVP")}`,
      })
      .from(userData)
      .where(eq(userData.userId, "member"));
    expect(restored).toEqual([{ status: "AWAKE" }]);
  });

  it("allows one of two simultaneous joins to own status and keeps only its row", async () => {
    const db = await getTestDatabase();
    let published = 0;
    const { promise: ready, resolve: release } = deferred<void>();
    const barrier = async () => {
      published += 1;
      if (published === 2) release();
      await ready;
    };
    const client = beforeStatements(db, rankedPvpQueue, [barrier, barrier]);
    const caller = callerForDatabase(pvpRankRouter, "member", client);
    const results = await Promise.all([
      caller.queueForRankedPvp(),
      caller.queueForRankedPvp(),
    ]);
    expect(published).toBe(2);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(await queueRows()).toEqual([
      expect.objectContaining({ userId: "member", hasClaimed: true }),
    ]);
    expect(await storedUser()).toMatchObject({ status: "QUEUED", battleId: null });
  });

  it("cannot claim status if an intentional leave removed the provisional row", async () => {
    const db = await getTestDatabase();
    const client = beforeStatements(db, userData, [
      async () => {
        expect(await queueRows()).toEqual([
          expect.objectContaining({ hasClaimed: false }),
        ]);
        await deleteUserRankedQueueRow(db, "member");
      },
    ]);
    expect(
      (await callerForDatabase(pvpRankRouter, "member", client).queueForRankedPvp())
        .success,
    ).toBe(false);
    expect(await storedUser()).toMatchObject({ status: "AWAKE", battleId: null });
    expect(await queueRows()).toHaveLength(0);
  });

  it("ignores an abandoned unclaimed row and removes all rows on intentional leave", async () => {
    const db = await getTestDatabase();
    await db
      .insert(rankedPvpQueue)
      .values({ id: "abandoned", userId: "member", rankedLp: 1000, hasClaimed: false });
    const caller = callerForDatabase(pvpRankRouter, "member", db);
    expect((await caller.queueForRankedPvp()).success).toBe(true);
    expect(await caller.getRankedPvpQueue()).toMatchObject({
      inQueue: true,
      queueCount: 1,
    });
    expect(await queueRows()).toHaveLength(2);
    expect((await caller.leaveRankedPvpQueue()).success).toBe(true);
    expect(await storedUser()).toMatchObject({ status: "AWAKE" });
    expect(await queueRows()).toHaveLength(0);
  });

  it("preserves ownership when a committed claim loses its response", async () => {
    const db = await getTestDatabase();
    const client = interceptExecute(db, async (_query, run) => {
      await run();
      throw new Error("Claim response lost");
    });
    await expect(
      callerForDatabase(pvpRankRouter, "member", client).queueForRankedPvp(),
    ).rejects.toThrow("Claim response lost");
    expect(await storedUser()).toMatchObject({ status: "QUEUED", battleId: null });
    expect(await queueRows()).toEqual([expect.objectContaining({ hasClaimed: true })]);
    expect(
      await callerForDatabase(pvpRankRouter, "member", db).getRankedPvpQueue(),
    ).toMatchObject({ inQueue: true });
  });

  it("does not sleep a successful ranked join after an orphan-status read", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ status: "QUEUED" })
      .where(eq(userData.userId, "member"));
    const client = beforeStatements(db, userData, [
      async () => {
        await db
          .update(userData)
          .set({ status: "AWAKE" })
          .where(eq(userData.userId, "member"));
        expect(
          (await callerForDatabase(pvpRankRouter, "member", db).queueForRankedPvp())
            .success,
        ).toBe(true);
      },
    ]);
    await callerForDatabase(pvpRankRouter, "member", client).getRankedPvpQueue();
    expect(await storedUser()).toMatchObject({ status: "QUEUED" });
    expect(await queueRows()).toEqual([expect.objectContaining({ hasClaimed: true })]);
  });

  it("preserves a newer ranked owner during delayed failed-clan-join compensation", async () => {
    const db = await getTestDatabase();
    let reads = 0;
    const queried = overrideQuery(db, "mpvpBattleQueue", {
      findFirst: async (read, ...args) => {
        reads += 1;
        if (reads === 2)
          expect(await deleteClanBattle(db, { id: "q", battleId: null })).toBe(true);
        return read(...args);
      },
    });
    const client = beforeStatements(queried, userData, [
      async () => {},
      async () => {
        expect(
          (await callerForDatabase(pvpRankRouter, "member", db).queueForRankedPvp())
            .success,
        ).toBe(true);
      },
    ]);
    expect(
      (
        await callerForDatabase(clanRouter, "member", client).joinClanBattle({
          clanBattleId: "q",
        })
      ).success,
    ).toBe(false);
    expect(await storedUser()).toMatchObject({ status: "QUEUED", battleId: null });
    await callerForDatabase(pvpRankRouter, "member", db).checkRankedPvpMatches();
    expect(await queueRows()).toEqual([expect.objectContaining({ hasClaimed: true })]);
  });

  for (const operation of ["leave", "kick"] as const) {
    for (const hasOtherParticipant of [false, true]) {
      it(`releases a clan member on ${operation} with ${hasOtherParticipant ? "another" : "no other"} participant`, async () => {
        const db = await getTestDatabase();
        await claimClanQueue();
        if (hasOtherParticipant)
          expect(
            (
              await callerForDatabase(clanRouter, "leader", db).joinClanBattle({
                clanBattleId: "q",
              })
            ).success,
          ).toBe(true);
        const caller = callerForDatabase(
          clanRouter,
          operation === "leave" ? "member" : "leader",
          db,
        );
        const result = await depart(caller, operation);
        expect(result.success).toBe(true);
        expect(await storedUser()).toMatchObject({ status: "AWAKE", battleId: null });
        expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(
          Number(hasOtherParticipant),
        );
        expect(await db.query.mpvpBattleQueue.findMany()).toHaveLength(
          Number(hasOtherParticipant),
        );
        if (hasOtherParticipant)
          expect(await storedUser("leader")).toMatchObject({ status: "QUEUED" });
        if (operation === "kick")
          expect(Pusher.prototype.trigger).toHaveBeenCalledWith("member", "event", {
            type: "userMessage",
            message: "leader kicked you out of a faction battle.",
            route: "/clanhall",
            routeText: "To faction Hall",
          });
      });
    }

    it(`preserves a ranked claim acquired after deletion during delayed clan ${operation}`, async () => {
      const db = await getTestDatabase();
      await claimClanQueue();
      let replacement: Promise<void> | undefined;
      const replaceQueue = () =>
        (replacement ??= (async () => {
          expect(
            (
              await callerForDatabase(clanRouter, "leader", db).deleteClanBattle({
                clanBattleId: "q",
              })
            ).success,
          ).toBe(true);
          expect(
            (await callerForDatabase(pvpRankRouter, "member", db).queueForRankedPvp())
              .success,
          ).toBe(true);
        })());
      // Every cleanup write waits for the replacement, regardless of write ordering.
      let client = beforeStatements(db, mpvpBattleQueue, [replaceQueue]);
      client = beforeStatements(client, mpvpBattleUser, [replaceQueue]);
      client = beforeStatements(client, userData, [replaceQueue]);
      const caller = callerForDatabase(
        clanRouter,
        operation === "leave" ? "member" : "leader",
        client,
      );
      const result = await depart(caller, operation);
      expect(result.success).toBe(true);
      expect(await storedUser()).toMatchObject({ status: "QUEUED", battleId: null });
      await callerForDatabase(pvpRankRouter, "member", db).checkRankedPvpMatches();
      expect(await queueRows()).toEqual([
        expect.objectContaining({ userId: "member", hasClaimed: true }),
      ]);
      expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(0);
      expect(await db.query.mpvpBattleQueue.findMany()).toHaveLength(0);
    });
  }

  it("preserves a newer queue when deletion races the final surplus-player wake", async () => {
    const db = await getTestDatabase();
    await queueFullLobby();
    const client = beforeStatements(db, userData, [
      async () => {},
      async () => {
        const lobby = await db.query.mpvpBattleQueue.findFirst();
        if (!lobby) throw new Error("Missing reserved lobby");
        expect(await deleteClanBattle(db, lobby)).toBe(true);
        expect(
          (await callerForDatabase(pvpRankRouter, "member", db).queueForRankedPvp())
            .success,
        ).toBe(true);
      },
    ]);
    expect(
      (
        await callerForDatabase(clanRouter, "leader", client).initiateClanBattle({
          clanBattleId: "q",
        })
      ).success,
    ).toBe(true);
    expect(await storedUser()).toMatchObject({ status: "QUEUED", battleId: null });
    expect(await queueRows()).toEqual([expect.objectContaining({ hasClaimed: true })]);
    expect(await db.query.battle.findMany()).toHaveLength(0);
  });

  it("retries a deadlocked surplus wake without tearing down started clan combat", async () => {
    const db = await getTestDatabase();
    await queueFullLobby();
    const client = beforeStatements(db, userData, [
      async () => {},
      async () => {
        throw new Error("Deadlock found when trying to get lock");
      },
    ]);
    const result = await callerForDatabase(
      clanRouter,
      "leader",
      client,
    ).initiateClanBattle({ clanBattleId: "q" });
    expect(result.success).toBe(true);
    expect(await storedUser()).toMatchObject({ status: "AWAKE", battleId: null });
    expect(await storedUser("leader")).toMatchObject({
      status: "BATTLE",
      battleId: result.battleId,
    });
    expect(await storedUser("enemy")).toMatchObject({
      status: "BATTLE",
      battleId: result.battleId,
    });
    expect(await db.query.battle.findMany()).toHaveLength(1);
    expect(await db.query.mpvpBattleQueue.findFirst()).toMatchObject({
      battleId: result.battleId,
    });
  });
});
