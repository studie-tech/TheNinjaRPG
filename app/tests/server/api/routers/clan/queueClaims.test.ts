import type { UserPatch, UserUpdateOptions } from "@/deltas/profile";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
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
import { AUTO_WAKE_MESSAGE } from "@/libs/actionReadiness";
import { clanRouter } from "@/server/api/routers/clan";
import { pvpRankRouter } from "@/server/api/routers/pvprank";
import { profileRouter } from "@/server/api/routers/profile";
import { deleteClanBattle } from "@/server/utils/clanBattle";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { insertUsers, insertClans } from "../../../../setup/factories";
import {
  beforeStatements,
  failStatements,
  pollUntil,
  overrideQuery,
} from "../../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";
import { deferred } from "../../../../setup/deferred";

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
    await insertClans(
      ["a", "b"].map((id) => ({
        id,
        villageId: "v",
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

  it.each(["before", "after", "lost", "disconnected", "reconnected"] as const)(
    "recovers clan deletion once and preserves other sockets (%s)",
    async (delivery) => {
      const db = await getTestDatabase();
      await oldMembership();
      await db.insert(mpvpBattleUser).values({
        id: "enemy-old",
        clanBattleId: "old",
        userId: "enemy",
        side: "DEFENDER",
        slot: 0,
      });
      await db.update(userData).set({ status: "QUEUED" });
      const key = [["profile", "getUser"], { type: "query" }];
      for (const userId of ["leader", "enemy"])
        await callerForDatabase(profileRouter, userId, db).getUser();
      const tabs = await Promise.all(
        ["leader", "leader", "enemy"].map(async (userId, index) => {
          const profile = callerForDatabase(profileRouter, userId, db);
          const initial = await profile.getUser();
          const client = new QueryClient({
            defaultOptions: { queries: { retry: false } },
          });
          client.setQueryData(key, initial);
          const read = vi.fn(() => profile.getUser());
          const observer = new QueryObserver(client, {
            queryKey: key,
            queryFn: read,
            staleTime: Infinity,
          });
          const stop = observer.subscribe(() => {});
          return {
            userId,
            client,
            read,
            stop,
            connection: {
              socket_id:
                delivery === "disconnected" && index === 0
                  ? undefined
                  : `${index + 1}.1`,
            },
          };
        }),
      );
      const actor = tabs[0]!;
      const source = readFileSync(
        join(import.meta.dirname, "../../../../../src/layout/clan/ClanBattles.tsx"),
        "utf8",
      );
      const callbacks = source
        .slice(source.indexOf("api.clan.deleteClanBattle.useMutation("))
        .match(/useMutation\((\{[\s\S]*?\n    \})\);/)?.[1];
      const action = source.match(
        /const onDeleteBattle = (async [\s\S]*?\n  \});/,
      )?.[1];
      if (!callbacks || !action)
        throw new Error("Clan deletion callbacks were not found");
      const utilsFor = (tab: typeof actor) => ({
        profile: {
          getUser: {
            cancel: () => tab.client.cancelQueries({ queryKey: key, exact: true }),
            invalidate: () =>
              tab.client.invalidateQueries({ queryKey: key, exact: true }),
          },
        },
        clan: { getClanBattles: { invalidate: vi.fn() } },
        combat: { getBattle: { invalidate: vi.fn() } },
      });
      const options = new Function(
        "prepareUserUpdate",
        "updateUser",
        "utils",
        `return (${callbacks});`,
      )(
        () => prepareUserUpdate(actor.client, key),
        (patch: UserPatch | undefined, update: UserUpdateOptions) =>
          updateUserCache(actor.client, key, patch, update),
        utilsFor(actor),
      ) as {
        onMutate?: () => number | undefined;
        onSuccess: (
          data: unknown,
          input: unknown,
          revision: number | undefined,
        ) => Promise<void>;
        onSettled: (data: unknown, error: unknown) => Promise<unknown> | undefined;
      };
      const handlerSource = readFileSync(
        join(import.meta.dirname, "../../../../../src/layout/PusherHandler.tsx"),
        "utf8",
      );
      const callback = handlerSource.match(
        /channel.bind\("event", (async [\s\S]*?\n      \})\);/,
      )?.[1];
      if (!callback) throw new Error("User event callback was not found");
      const transpiler = new (require("bun").Transpiler)({
        loader: "tsx",
        tsconfig: { compilerOptions: { jsx: "react" } },
      }) as { transformSync(source: string): string };
      const factory = transpiler.transformSync(
        `function createHandler() { return (${callback}); }`,
      );
      const receivers = tabs.map(
        (tab) =>
          new Function("utils", "pusher", `${factory}\nreturn createHandler();`)(
            utilsFor(tab),
            { connection: tab.connection },
          ) as (event: { type: string; originSocketId?: string }) => Promise<void>,
      );
      const trigger = vi
        .spyOn(Pusher.prototype, "trigger")
        .mockResolvedValue(undefined);
      const deliver = async () => {
        for (const [index, tab] of tabs.entries()) {
          if (delivery === "disconnected" && index === 0) continue;
          const event = trigger.mock.calls.find(
            ([recipient]) => recipient === tab.userId,
          )?.[2];
          if (event)
            await receivers[index]!(event as { type: string; originSocketId?: string });
        }
      };
      const defaultError = vi.fn();
      const removeBattle = vi.fn(
        async (input: { clanBattleId: string; originSocketId?: string }) => {
          const revision = options.onMutate?.();
          const result = await callerForDatabase(
            clanRouter,
            "leader",
            db,
          ).deleteClanBattle(input);
          expect(result.success).toBe(true);
          expect(result).not.toHaveProperty("userPatch");
          if (delivery === "before" || delivery === "lost") await deliver();
          if (delivery === "lost") {
            const error = new Error("Response lost after deletion");
            defaultError(error);
            await options.onSettled(undefined, error);
            throw error;
          }
          await options.onSuccess(result, input, revision);
          await options.onSettled(result, undefined);
          return result;
        },
      );
      // Read the mutable connection at submission, including a newly connected socket.
      if (delivery !== "disconnected") actor.connection.socket_id = "4.1";
      const setDeleteError = vi.fn();
      const invoke = new Function(
        "deletingBattleId",
        "deleteFlight",
        "setDeleteError",
        "removeBattle",
        "pusher",
        "showMutationToast",
        "setDeletedBattleIds",
        "setDeletingBattleId",
        "joinedBattleId",
        "setJoinedBattleId",
        "utils",
        `return (${action});`,
      )(
        "old",
        { run: (_request: unknown, task: () => Promise<void>) => task() },
        setDeleteError,
        removeBattle,
        { connection: actor.connection },
        vi.fn(),
        vi.fn(),
        vi.fn(),
        "old",
        vi.fn(),
        utilsFor(actor),
      ) as () => Promise<void>;
      try {
        await invoke();
        expect(removeBattle).toHaveBeenCalledWith({
          clanBattleId: "old",
          originSocketId: delivery === "disconnected" ? undefined : "4.1",
        });
        expect(actor.read).toHaveBeenCalledTimes(1);
        if (["after", "disconnected", "reconnected"].includes(delivery)) {
          if (delivery === "reconnected") actor.connection.socket_id = "5.1";
          await deliver();
        }
        expect(actor.read).toHaveBeenCalledTimes(delivery === "reconnected" ? 2 : 1);
        for (const tab of tabs.slice(1)) expect(tab.read).toHaveBeenCalledTimes(1);
        for (const tab of tabs)
          expect(
            tab.client.getQueryData<{ userData: { status: string } }>(key)?.userData
              .status,
          ).toBe("AWAKE");
        expect(defaultError).toHaveBeenCalledTimes(delivery === "lost" ? 1 : 0);
        if (delivery === "lost")
          expect(setDeleteError).toHaveBeenCalledWith("Response lost after deletion");
      } finally {
        for (const tab of tabs) {
          tab.stop();
          tab.client.clear();
        }
      }
    },
  );

  it("returns the guarded wake outcome without a confirmation read", async () => {
    const db = await getTestDatabase();
    await oldMembership();
    await db
      .update(userData)
      .set({ status: "QUEUED" })
      .where(eq(userData.userId, "leader"));
    const result = await callerForDatabase(clanRouter, "leader", db).leaveClanBattle({
      clanBattleId: "old",
    });
    expect(result.success).toBe(true);
    expect(result.userPatch).toEqual({ status: "AWAKE" });
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
          const { promise: ready, resolve: signalReady } = deferred<void>();
          const { promise: wait, resolve: releaseInsert } = deferred<void>();
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
            client = overrideQuery(db, "mpvpBattleQueue", {
              findFirst: async (read, ...args) => {
                // Delete the old join's lobby after insertion but before validation.
                if (++reads === 2) await replace();
                return read(...args);
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
          await pollUntil(async () => (await storedUser())?.status === "AWAKE");
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

    it.each([false, true])(
      `reports only confirmed recovery when ${operation}'s lobby reserves combat, started=%s`,
      async (started) => {
        const db = await getTestDatabase();
        await db
          .update(userData)
          .set({ status: "ASLEEP", regeneration: 0 })
          .where(eq(userData.userId, "leader"));
        const client = beforeStatements(db, mpvpBattleUser, [
          async () => {
            if (operation === "challenge") {
              // Wait for the parallel challenge-lobby insert before reserving it.
              await pollUntil(
                async () => (await db.query.mpvpBattleQueue.findMany()).length === 3,
              );
            }
            const lobbies = await db.query.mpvpBattleQueue.findMany();
            const lobby = lobbies.find((q) =>
              operation === "challenge"
                ? !["old", "new"].includes(q.id)
                : q.id === "new",
            );
            expect(lobby).toBeDefined();
            if (!lobby) throw new Error("Challenge lobby was not published");
            await db
              .update(mpvpBattleQueue)
              .set({ battleId: "reserved-combat" })
              .where(eq(mpvpBattleQueue.id, lobby.id));
            if (started)
              await db
                .update(userData)
                .set({ status: "BATTLE", battleId: "reserved-combat" })
                .where(eq(userData.userId, "leader"));
          },
        ]);
        const result = await join(client);
        expect(result).toMatchObject({
          success: false,
          actionNotice: AUTO_WAKE_MESSAGE,
        });
        if (started)
          expect(result.userRecovery).toEqual({
            userId: "leader",
            requiresUserRefresh: true,
          });
        else
          expect(result.userRecovery?.activity).toMatchObject({
            status: "AWAKE",
            battleId: null,
          });
        expect(await storedUser()).toEqual({
          status: started ? "BATTLE" : "AWAKE",
          battleId: started ? "reserved-combat" : null,
        });
        expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(0);
        expect(
          await db.query.mpvpBattleQueue.findMany({
            where: eq(mpvpBattleQueue.battleId, "reserved-combat"),
          }),
        ).toHaveLength(1);
      },
    );
  }

  it.each([false, true])(
    "reports only confirmed recovery after a duplicate clan join, started=%s",
    async (started) => {
      const db = await getTestDatabase();
      await db
        .update(userData)
        .set({ status: "ASLEEP", regeneration: 0 })
        .where(eq(userData.userId, "leader"));
      const client = beforeStatements(db, mpvpBattleUser, [
        async () => {
          if (started)
            await db
              .update(userData)
              .set({ status: "BATTLE", battleId: "newer-combat" })
              .where(eq(userData.userId, "leader"));
          throw new Error("Duplicate entry for MpvpBattleUser_userId_key");
        },
      ]);
      const result = await callerForDatabase(
        clanRouter,
        "leader",
        client,
      ).joinClanBattle({ clanBattleId: "new" });
      expect(result).toMatchObject({ success: false, actionNotice: AUTO_WAKE_MESSAGE });
      if (started)
        expect(result.userRecovery).toEqual({
          userId: "leader",
          requiresUserRefresh: true,
        });
      else
        expect(result.userRecovery?.activity).toMatchObject({
          status: "AWAKE",
          battleId: null,
        });
      expect(await storedUser()).toEqual({
        status: started ? "BATTLE" : "AWAKE",
        battleId: started ? "newer-combat" : null,
      });
    },
  );

  it("settles a delayed challenge-lobby insert before compensating a lost membership", async () => {
    const db = await getTestDatabase();
    const { promise: memberFailed, resolve: signalMemberFailed } = deferred<void>();
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

  it("releases a failed join claim and propagates unexpected insertion errors", async () => {
    const db = await getTestDatabase();
    const caller = callerForDatabase(
      clanRouter,
      "leader",
      failStatements(db, mpvpBattleUser),
    );
    await expect(caller.joinClanBattle({ clanBattleId: "old" })).rejects.toThrow(
      "Statement failed on purpose",
    );
    expect(await storedUser()).toEqual({ status: "AWAKE", battleId: null });
    expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(0);
  });

  it("releases a join claim that loses its slot to another member", async () => {
    const db = await getTestDatabase();
    const caller = callerForDatabase(
      clanRouter,
      "leader",
      beforeStatements(db, mpvpBattleUser, [
        () =>
          db.insert(mpvpBattleUser).values({
            id: "slot-owner",
            clanBattleId: "old",
            userId: "enemy",
            side: "ATTACKER",
            slot: 0,
          }),
      ]),
    );
    await expect(caller.joinClanBattle({ clanBattleId: "old" })).resolves.toMatchObject(
      {
        success: false,
        message: "Slot was taken. Please try again.",
      },
    );
    expect(await storedUser()).toEqual({ status: "AWAKE", battleId: null });
  });
});
