import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import { and, eq } from "drizzle-orm";
import { GET as kessenCron } from "@/app/api/kessen-match-expiry/route";
import {
  KESSEN_CHALLENGE_EXPIRY_SECONDS,
  KESSEN_CHALLENGE_MAX_PENDING,
  KESSEN_PVP_MAX_TIMEOUTS,
  KESSEN_RANKED_DAILY_REWARDED_WINS,
  KESSEN_RANKED_PAIR_DAILY_RATED,
  KESSEN_RANKED_START_RATING,
  KESSEN_RANKED_WEEKLY_PACK_WINS,
  KESSEN_RANKED_WIN_RYO,
} from "@/drizzle/constants";
import {
  conversation,
  conversationComment,
  gameSetting,
  item,
  kessenDeck,
  kessenMatch,
  kessenNpcProgress,
  kessenProgress,
  kessenRankedQueue,
  userBlackList,
  userData,
  userItem,
  userRequest,
} from "@/drizzle/schema";
import { greedyDecide } from "@/libs/kessen/ai";
import { kessenCardToCardData } from "@/libs/kessen/catalog";
import { KESSEN_PACK_IDS } from "@/libs/kessen/packs";
import { Pusher } from "@/libs/pusher";
import { kessenRouter } from "@/server/api/routers/kessen";
import { kessenPvpRouter } from "@/server/api/routers/kessenPvp";
import { getUtcDayKey, periodStart } from "@/utils/time";
import { CARD_ITEM_DEFAULTS } from "@/validators/itemCard";
import type { KessenStoredPvpMatch } from "@/validators/kessen";
import { KESSEN_SEED_CATALOG } from "../../../libs/kessen/fixtures/catalog";
import { withAfterTasks } from "../../../setup/after";
import { restoreEnvAfterEach } from "../../../setup/env";
import { insertItems, insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import { aroundStatements, interceptExecute, sqlText } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const A = "duel-a";
const B = "duel-b";
const C = "duel-c";
const NOVICE = "duel-novice";
const BOT = "duel-bot";
const START_MONEY = 1_000;
const LOANER_A = { source: "loaner", faction: "AKASUMI" } as const;
const LOANER_B = { source: "loaner", faction: "AKIKAZE" } as const;

const db = () => getTestDatabase();
const pvp = (userId: string) => callerFor(kessenPvpRouter, userId);
type Caller = Awaited<ReturnType<typeof pvp>>;

const pushes: { channel: string; data: unknown }[] = [];
// The cron route runs its deferred pushes after its response, as Next does.
const runKessenCron = withAfterTasks(kessenCron);

const matchRow = async (id: string) =>
  (await (await db()).select().from(kessenMatch).where(eq(kessenMatch.id, id)))[0];
const progressOf = async (userId: string) =>
  (
    await (
      await db()
    )
      .select()
      .from(kessenProgress)
      .where(eq(kessenProgress.userId, userId))
  )[0];
const moneyOf = async (userId: string) =>
  (await (await db()).select().from(userData).where(eq(userData.userId, userId)))[0]
    ?.money;
const storedOf = async (id: string) =>
  (await matchRow(id))?.state as unknown as KessenStoredPvpMatch;

/** Sets the duel's clock to have run out `seconds` ago. */
const expireClock = async (matchId: string, seconds = 1) =>
  (await db())
    .update(kessenMatch)
    .set({ turnDeadline: new Date(Date.now() - seconds * 1000) })
    .where(eq(kessenMatch.id, matchId));

/** Moves the duel start back so the reward duration guard passes. */
const backdate = async (matchId: string, minutes = 10) =>
  (await db())
    .update(kessenMatch)
    .set({ startedAt: new Date(Date.now() - minutes * 60_000) })
    .where(eq(kessenMatch.id, matchId));

/** A friendly duel between A (seat 0) and B (seat 1). */
const friendlyDuel = async () => {
  const sent = await (await pvp(A)).createChallenge({ targetId: B, deck: LOANER_A });
  expect(sent).toMatchObject({ success: true });
  const lobby = await (await pvp(B)).getLobby();
  const challenge = lobby.challenges[0];
  if (!challenge) throw new Error("No challenge");
  const accepted = await (await pvp(B)).acceptChallenge({
    requestId: challenge.id,
    deck: LOANER_B,
  });
  if (!accepted.success || !("match" in accepted) || !accepted.match)
    throw new Error(accepted.message);
  return accepted.match;
};

/** A ranked duel between A and B through the queue. */
const rankedDuel = async () => {
  const joinedA = await (await pvp(A)).joinRankedQueue({ deck: LOANER_A });
  expect(joinedA).toMatchObject({ success: true, matchId: null });
  const joinedB = await (await pvp(B)).joinRankedQueue({ deck: LOANER_B });
  expect(joinedB.success).toBe(true);
  const matchId = "matchId" in joinedB ? joinedB.matchId : null;
  if (!matchId) throw new Error("No ranked match");
  return matchId;
};

/** Runs the Kessen cron with a fresh timer lock. */
const runCron = async () => {
  await resetTables(gameSetting);
  const response = await runKessenCron(
    new Request("http://localhost/api/kessen-match-expiry", {
      headers: { authorization: "Bearer kessen-cron" },
    }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { settled: number };
};

/**
 * A ranked duel that A concedes to B once it is long and busy enough to be rewarded.
 * With `strand`, the request stops after the ending write, before any ranked claim,
 * and the ending is moved back past the sweep's grace.
 */
const concededRankedDuel = async (strand: boolean) => {
  const matchId = await rankedDuel();
  await backdate(matchId);
  const stored = await storedOf(matchId);
  await (await db())
    .update(kessenMatch)
    .set({
      state: { ...stored, plays: [10, 10] } as unknown as Record<string, unknown>,
    })
    .where(eq(kessenMatch.id, matchId));
  if (!strand) {
    expect((await (await pvp(A)).concede({ matchId })).success).toBe(true);
    return matchId;
  }
  const frozen = interceptExecute(await db(), (query, run) => {
    const text = sqlText(query).trim();
    return text.startsWith("UPDATE") && text.includes("KessenProgress")
      ? Promise.reject(new Error("request froze"))
      : run();
  });
  await expect(
    callerForDatabase(kessenPvpRouter, A, frozen).concede({ matchId }),
  ).rejects.toThrow();
  const ended = await matchRow(matchId);
  expect(ended?.status).toBe("CONCEDED");
  expect(ended?.rated).toBe(false);
  expect(storedDuelOf(ended).settlement).toBeTruthy();
  const endedAt = new Date(Date.now() - 5 * 60_000);
  await (await db())
    .update(kessenMatch)
    .set({ updatedAt: endedAt, finishedAt: endedAt })
    .where(eq(kessenMatch.id, matchId));
  return matchId;
};

const storedDuelOf = (row: { state: unknown } | undefined) =>
  (row?.state ?? {}) as KessenStoredPvpMatch;

const packsOf = async (userId: string) =>
  (
    await (
      await db()
    )
      .select()
      .from(userItem)
      .where(
        and(eq(userItem.userId, userId), eq(userItem.itemId, KESSEN_PACK_IDS.paper)),
      )
  ).reduce((total, row) => total + row.quantity, 0);

/** Plays the duel with the greedy bot for both seats until it ends. */
const playOut = async (matchId: string) => {
  const callers: [Caller, Caller] = [await pvp(A), await pvp(B)];
  for (let step = 0; step < 400; step++) {
    const row = await matchRow(matchId);
    if (row?.status !== "ACTIVE") return row;
    const { match } = await callers[0].getMatch({ matchId });
    if (!match) throw new Error("Missing match");
    const acting = match.clock.acting;
    const actor = acting.includes(match.seat) ? 0 : 1;
    const caller = callers[actor];
    const { match: view } = await caller.getMatch({ matchId });
    if (!view) throw new Error("Missing view");
    const response = await caller.playTurn({
      matchId,
      version: view.version,
      action: greedyDecide(view.view, view.seat),
    });
    expect(response.success, response.message).toBe(true);
  }
  throw new Error("The duel did not end");
};

/** Instance ids `viewer` must not see: the other seat's hand and deck. */
const hiddenIds = (stored: KessenStoredPvpMatch, viewer: 0 | 1) => {
  const other = stored.engine.seats[viewer === 0 ? 1 : 0];
  return [...other.hand, ...other.deck];
};

const expectHidden = (
  payload: unknown,
  stored: KessenStoredPvpMatch,
  viewer: 0 | 1,
) => {
  const text = JSON.stringify(payload);
  for (const id of hiddenIds(stored, viewer)) expect(text).not.toContain(`"${id}"`);
  expect(text).not.toContain(stored.engine.seed);
};

describeWithDatabase("kessen duels", () => {
  restoreEnvAfterEach("CRON_SECRET");
  let triggerSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    process.env.CRON_SECRET = "kessen-cron";
    pushes.length = 0;
    triggerSpy = spyOn(Pusher.prototype, "trigger").mockImplementation(
      async (channel: string, _event: string, data: object | string) => {
        pushes.push({ channel, data });
      },
    );
    await resetTables(
      conversationComment,
      conversation,
      kessenMatch,
      kessenProgress,
      kessenNpcProgress,
      kessenDeck,
      kessenRankedQueue,
      userRequest,
      userBlackList,
      userItem,
      item,
      gameSetting,
      userData,
    );
    await insertUsers([
      { userId: A, username: "DuelistA", money: START_MONEY, status: "AWAKE" },
      { userId: B, username: "DuelistB", money: START_MONEY, status: "AWAKE" },
      { userId: C, username: "DuelistC", money: START_MONEY, status: "AWAKE" },
      { userId: NOVICE, username: "Novice", money: START_MONEY, status: "AWAKE" },
      { userId: BOT, username: "Bot", isAi: true, status: "AWAKE" },
      ...[1, 2, 3, 4].map((n) => ({
        userId: `duel-t${n}`,
        username: `Target${n}`,
        status: "AWAKE" as const,
      })),
    ]);
    await insertItems(
      KESSEN_SEED_CATALOG.map((card) => ({
        ...CARD_ITEM_DEFAULTS,
        id: card.id,
        name: card.variant === "FORBIDDEN" ? card.id : card.name,
        rarity: card.rarity,
        itemType: "CARD" as const,
        cardData: kessenCardToCardData(card),
      })),
    );
    await insertItems([
      {
        id: "kessen-pack-paper",
        name: "kessen-pack-paper",
        itemType: "CONSUMABLE" as const,
        stackSize: 99,
        canStack: true,
      },
    ]);
    await (await db()).insert(kessenProgress).values(
      [A, B, C, BOT, "duel-t1", "duel-t2", "duel-t3", "duel-t4"].map((userId) => ({
        userId,
        academy: { "first-blood": "earlier-match" },
        seenKeywords: [],
        npcWinsToday: {},
      })),
    );
  });

  afterEach(() => triggerSpy.mockRestore());

  it("guards challenges: self, AI, blacklist both ways, lesson, duplicates and the pending cap", async () => {
    const a = await pvp(A);
    expect(await a.createChallenge({ targetId: A, deck: LOANER_A })).toEqual({
      success: false,
      message: "You cannot challenge yourself.",
    });
    expect((await a.createChallenge({ targetId: BOT, deck: LOANER_A })).message).toBe(
      "Choose another active player to challenge.",
    );
    expect(
      (await a.createChallenge({ targetId: NOVICE, deck: LOANER_A })).message,
    ).toBe("That player has not learned Kessen yet.");
    await (await db())
      .insert(userBlackList)
      .values({ creatorUserId: A, targetUserId: C });
    expect((await a.createChallenge({ targetId: C, deck: LOANER_A })).message).toBe(
      "You cannot challenge this player.",
    );
    // The blocked player cannot challenge the one who blocked them either.
    expect(
      (await (await pvp(C)).createChallenge({ targetId: A, deck: LOANER_A })).message,
    ).toBe("You cannot challenge this player.");

    expect((await a.createChallenge({ targetId: B, deck: LOANER_A })).success).toBe(
      true,
    );
    expect((await a.createChallenge({ targetId: B, deck: LOANER_A })).message).toBe(
      "You already have a pending challenge with this player.",
    );
    // The pair slot is shared: B cannot send one back while A's is pending.
    expect(
      (await (await pvp(B)).createChallenge({ targetId: A, deck: LOANER_A })).message,
    ).toBe("You already have a pending challenge with this player.");
    for (let n = 1; n < KESSEN_CHALLENGE_MAX_PENDING; n++)
      expect(
        (await a.createChallenge({ targetId: `duel-t${n}`, deck: LOANER_A })).success,
      ).toBe(true);
    expect(
      (await a.createChallenge({ targetId: "duel-t4", deck: LOANER_A })).message,
    ).toBe(`You can have up to ${KESSEN_CHALLENGE_MAX_PENDING} pending challenges.`);

    // An unanswered challenge expires and frees the pair slot.
    await (await db())
      .update(userRequest)
      .set({
        createdAt: new Date(Date.now() - (KESSEN_CHALLENGE_EXPIRY_SECONDS + 5) * 1000),
      })
      .where(eq(userRequest.receiverId, B));
    expect((await a.createChallenge({ targetId: B, deck: LOANER_A })).success).toBe(
      true,
    );
    const toB = await (await db())
      .select()
      .from(userRequest)
      .where(eq(userRequest.receiverId, B));
    expect(toB.map((row) => row.status).sort()).toEqual(["EXPIRED", "PENDING"]);
    // The receiver was notified on their own channel.
    expect(pushes.some((push) => push.channel === B)).toBe(true);
  });

  it("lets exactly one of accept and cancel win", async () => {
    await (await pvp(A)).createChallenge({ targetId: B, deck: LOANER_A });
    const [request] = await (await db()).select().from(userRequest);
    const requestId = request?.id as string;
    const race: { cancel?: { success: boolean } } = {};
    const racing = aroundStatements(
      await db(),
      userRequest,
      async (run) => {
        race.cancel ??= await (await pvp(A)).cancelChallenge({ requestId });
        return run();
      },
      { operations: ["update"] },
    );
    const accepted = await callerForDatabase(
      kessenPvpRouter,
      B,
      racing,
    ).acceptChallenge({
      requestId,
      deck: LOANER_B,
    });
    expect(race.cancel?.success).toBe(true);
    expect(accepted).toEqual({
      success: false,
      message: "This challenge is no longer pending.",
    });
    expect(await (await db()).select().from(kessenMatch)).toHaveLength(0);

    // Two accepts of a fresh challenge: one duel.
    await (await pvp(A)).createChallenge({ targetId: B, deck: LOANER_A });
    const pending = (await (await pvp(B)).getLobby()).challenges[0];
    const both = await Promise.all([
      (await pvp(B)).acceptChallenge({
        requestId: pending?.id as string,
        deck: LOANER_B,
      }),
      (await pvp(B)).acceptChallenge({
        requestId: pending?.id as string,
        deck: LOANER_B,
      }),
    ]);
    expect(both.filter((response) => response.success)).toHaveLength(1);
    expect(await (await db()).select().from(kessenMatch)).toHaveLength(1);
    expect(
      (await (await pvp(A)).cancelChallenge({ requestId: pending?.id as string }))
        .message,
    ).toBe("This challenge is no longer pending.");
  });

  it("plays both seats with version CAS and never shows hidden cards", async () => {
    const started = await friendlyDuel();
    expect(started.seat).toBe(1);
    expect(started.clock.acting).toEqual([0, 1]);
    const matchId = started.id;
    const a = await pvp(A);
    const b = await pvp(B);
    // Both seats are told the duel began on their own channel.
    expect(
      pushes.filter((push) => push.channel === A || push.channel === B).length,
    ).toBeGreaterThanOrEqual(2);

    // Simultaneous mulligans from the same version both land.
    const mulls = await Promise.all([
      a.playTurn({
        matchId,
        version: started.version,
        action: { t: "mull", cards: [] },
      }),
      b.playTurn({
        matchId,
        version: started.version,
        action: { t: "mull", cards: [] },
      }),
    ]);
    expect(mulls.map((response) => response.success)).toEqual([true, true]);
    const stored = await storedOf(matchId);
    expect(stored.engine.phase).toBe("play");

    const { match: viewA } = await a.getMatch({ matchId });
    const { match: viewB, log: logB } = await b.getMatch({ matchId });
    if (!viewA || !viewB) throw new Error("Missing views");
    expect(viewA.seat).toBe(0);
    expect(viewA.view.seats[1].hand).toBeNull();
    expect(viewB.view.seats[0].hand).toBeNull();
    expectHidden(viewA, stored, 0);
    expectHidden(viewB, stored, 1);
    expectHidden(logB, stored, 1);

    const turn = stored.engine.turn;
    const [actor, waiter] = turn === 0 ? [a, b] : [b, a];
    const actorView = turn === 0 ? viewA : viewB;
    const waiting = await waiter.playTurn({
      matchId,
      version: actorView.version,
      action: { t: "pass" },
    });
    expect(waiting.message).toBe("It is not your turn.");
    const stale = await actor.playTurn({
      matchId,
      version: actorView.version - 1,
      action: greedyDecide(actorView.view, actorView.seat),
    });
    expect(stale.message).toBe("This match moved on; showing the latest turn.");
    const played = await actor.playTurn({
      matchId,
      version: actorView.version,
      action: greedyDecide(actorView.view, actorView.seat),
    });
    expect(played.success, played.message).toBe(true);
    const after = await storedOf(matchId);
    if (!("match" in played) || !played.match) throw new Error("No payload");
    expectHidden(played, after, turn);
    // Replaying the same version loses the CAS.
    const replay = await actor.playTurn({
      matchId,
      version: actorView.version,
      action: greedyDecide(actorView.view, actorView.seat),
    });
    expect(replay.success).toBe(false);

    // Match-channel pushes carry the version only; no push carries a hidden instance.
    const channel = pushes.filter((push) => push.channel === matchId);
    expect(channel.length).toBeGreaterThan(0);
    for (const push of channel)
      expect(Object.keys(push.data as object)).toEqual(["version"]);
    for (const push of pushes) {
      expectHidden(push.data, after, 0);
      expectHidden(push.data, after, 1);
    }
    // The NPC endpoints never serve a duel.
    expect(await (await callerFor(kessenRouter, A)).getMatch({ matchId })).toEqual({
      match: null,
    });
  });

  it("announces a duel challenged from a public conversation there, and only there", async () => {
    await (await db()).insert(conversation).values([
      { id: "tavern", title: "Tavern", isPublic: true },
      { id: "private", title: "Private", isPublic: false },
    ]);
    const a = await pvp(A);
    const b = await pvp(B);
    await a.createChallenge({ targetId: B, deck: LOANER_A, conversationId: "tavern" });
    await a.createChallenge({ targetId: C, deck: LOANER_A, conversationId: "private" });
    const fromTavern = (await b.getLobby()).challenges[0];
    if (!fromTavern) throw new Error("No challenge");
    const accepted = await b.acceptChallenge({
      requestId: fromTavern.id,
      deck: LOANER_B,
    });
    if (!accepted.success || !("match" in accepted) || !accepted.match)
      throw new Error(accepted.message);
    const toC = (await (await pvp(C)).getLobby()).challenges[0];
    if (!toC) throw new Error("No challenge");
    await (await pvp(C)).acceptChallenge({ requestId: toC.id, deck: LOANER_B });
    const announced = await (await db()).select().from(conversationComment);
    expect(announced).toEqual([
      expect.objectContaining({
        conversationId: "tavern",
        userId: A,
        challengeMatch: {
          type: "KESSEN",
          matchId: accepted.match.id,
          opponentName: "DuelistB",
        },
      }),
    ]);
  });

  it("lets anyone watch a duel with both hands hidden, in one read and no write", async () => {
    const started = await friendlyDuel();
    const matchId = started.id;
    await expireClock(matchId);
    const before = await matchRow(matchId);
    const stored = await storedOf(matchId);
    // Every write to the duel fails, so watching must not make one.
    const readOnly = aroundStatements(await db(), kessenMatch, () =>
      Promise.reject(new Error("watching wrote to the duel")),
    );
    const watcher = callerForDatabase(kessenPvpRouter, C, readOnly);
    const { match, log } = await watcher.watchMatch({ matchId });
    if (!match || !log) throw new Error("Missing watched duel");
    expect(match).toMatchObject({ seat: 0, version: before?.version, borrowed: [] });
    expect(match.view.seats.map((zone) => zone.hand)).toEqual([null, null]);
    expect(match.view.seats.map((zone) => zone.handCount)).toEqual(
      stored.engine.seats.map((zone) => zone.hand.length),
    );
    expectHidden({ match, log }, stored, 0);
    expectHidden({ match, log }, stored, 1);
    // The clock that ran out stays for a seat to apply.
    expect(await matchRow(matchId)).toEqual(before);
    expect(await watcher.watchMatch({ matchId: "missing" })).toEqual({
      match: null,
      log: null,
    });
  });

  it("passes for a seat whose clock ran out and forfeits it after the timeout limit", async () => {
    const started = await friendlyDuel();
    const matchId = started.id;
    const a = await pvp(A);
    // A keeps playing; B never acts, and A's reads apply B's missed clocks.
    for (let step = 0; step < 100; step++) {
      const row = await matchRow(matchId);
      if (row?.status !== "ACTIVE") break;
      const { match } = await a.getMatch({ matchId });
      if (match?.status !== "ACTIVE") break;
      if (match.clock.acting.includes(0)) {
        const response = await a.playTurn({
          matchId,
          version: match.version,
          action: greedyDecide(match.view, 0),
        });
        expect(response.success, response.message).toBe(true);
      } else await expireClock(matchId);
    }
    const row = await matchRow(matchId);
    const stored = (row?.state ?? {}) as unknown as KessenStoredPvpMatch;
    expect(row?.status).toBe("FINISHED");
    expect(stored.timeouts[1]).toBe(KESSEN_PVP_MAX_TIMEOUTS);
    const { match } = await (await pvp(B)).getMatch({ matchId });
    expect(match?.result).toMatchObject({
      outcome: "loss",
      winner: 0,
      endedBy: "timeout",
      loserBy: 1,
      rating: null,
    });
  });

  it("resolves a long-abandoned duel the same way whenever it is read, including by the cron", async () => {
    const started = await friendlyDuel();
    await expireClock(started.id, 15 * 60);
    const response = await runKessenCron(
      new Request("http://localhost/api/kessen-match-expiry", {
        headers: { authorization: "Bearer kessen-cron" },
      }),
    );
    expect(response.status).toBe(200);
    const row = await matchRow(started.id);
    const stored = (row?.state ?? {}) as unknown as KessenStoredPvpMatch;
    expect(row?.status).toBe("FINISHED");
    expect(stored.timeouts).toEqual([KESSEN_PVP_MAX_TIMEOUTS, KESSEN_PVP_MAX_TIMEOUTS]);
    expect(stored.result).toMatchObject({ winner: null, endedBy: "timeout" });
  });

  it("keeps friendly duels free of ratings and rewards", async () => {
    const started = await friendlyDuel();
    await backdate(started.id);
    await playOut(started.id);
    const row = await matchRow(started.id);
    const stored = row?.state as unknown as KessenStoredPvpMatch;
    expect(row?.rated).toBe(false);
    expect(stored.result).toMatchObject({ ratings: null, reward: null });
    expect(await moneyOf(A)).toBe(START_MONEY);
    expect(await moneyOf(B)).toBe(START_MONEY);
    expect((await progressOf(A))?.rankedPlayed).toBe(0);
  });

  it("shows the ranked ladder signed out and each rated player their own place", async () => {
    // The ladder is public, so the shared limiter runs; its Redis transport is stubbed.
    const limiter = stubRateLimitTransport();
    const rated = { A: [1200, 3, 0], B: [1100, 1, 1] } as const;
    for (const [userId, [rating, wins, losses]] of [
      [A, rated.A],
      [B, rated.B],
    ] as const) {
      await (await db())
        .update(kessenProgress)
        .set({
          rating,
          rankedPlayed: wins + losses,
          rankedWins: wins,
          rankedLosses: losses,
        })
        .where(eq(kessenProgress.userId, userId));
    }
    const guest = kessenPvpRouter.createCaller({
      drizzle: await db(),
      userId: null,
      userIp: "203.0.113.7",
    } as never);
    const [ladder, own] = await Promise.all([
      guest.getLeaderboard({ limit: 1 }),
      pvp(B).then((caller) => caller.getLeaderboard({ limit: 1 })),
    ]).finally(() => limiter.mockRestore());
    expect(ladder.entries.map((entry) => entry.userId)).toEqual([A]);
    expect(ladder.you).toBeNull();
    expect(own.you).toEqual(
      expect.objectContaining({ userId: B, rank: 2, rating: 1100, wins: 1, losses: 1 }),
    );
  });

  it("matches the ranked queue, rates the finished duel once and pays the winner", async () => {
    const matchId = await rankedDuel();
    const checkA = await (await pvp(A)).checkRankedQueue();
    expect(checkA.matchId).toBe(matchId);
    expect(await (await db()).select().from(kessenRankedQueue)).toHaveLength(0);
    // Neither player can start an NPC match during the duel.
    const npc = await (await callerFor(kessenRouter, A)).startMatch({
      npcKey: "lemu",
      mode: "standard",
      deck: LOANER_A,
      replaceActive: true,
    });
    expect(npc.message).toBe("Finish or concede your Kessen duel first.");

    await backdate(matchId);
    // The settled result write dies once after the claims; a later read resumes it.
    let interrupted = false;
    const dying = aroundStatements(
      await db(),
      kessenMatch,
      async (run) => {
        if (!interrupted) {
          interrupted = true;
          throw new Error("request died");
        }
        return run();
      },
      {
        when: (values) =>
          (values.state as KessenStoredPvpMatch | undefined)?.settlement === null &&
          (values.state as KessenStoredPvpMatch | undefined)?.result?.settling ===
            false,
      },
    );
    const callers: Record<string, Caller> = {
      [A]: callerForDatabase(kessenPvpRouter, A, dying) as Caller,
      [B]: callerForDatabase(kessenPvpRouter, B, dying) as Caller,
    };
    let died = false;
    for (let step = 0; step < 400; step++) {
      const row = await matchRow(matchId);
      if (row?.status !== "ACTIVE") break;
      const { match } = await (await pvp(A)).getMatch({ matchId });
      if (!match) throw new Error("Missing match");
      const actorId = match.clock.acting.includes(0)
        ? row.userId
        : (row.opponentId as string);
      const { match: view } = await (await pvp(actorId)).getMatch({ matchId });
      if (!view) throw new Error("Missing view");
      try {
        await (callers[actorId] as Caller).playTurn({
          matchId,
          version: view.version,
          action: greedyDecide(view.view, view.seat),
        });
      } catch {
        died = true;
      }
    }
    expect(died).toBe(true);
    const ended = await matchRow(matchId);
    expect(ended?.rated).toBe(true);
    expect(
      (ended?.state as unknown as KessenStoredPvpMatch | undefined)?.settlement,
    ).toBeTruthy();

    const { match: resumed } = await (await pvp(A)).getMatch({ matchId });
    const { match: other } = await (await pvp(B)).getMatch({ matchId });
    if (!resumed?.result || !other?.result) throw new Error("No result");
    expect(resumed.result.settling).toBe(false);
    const stored = (await storedOf(matchId)) as KessenStoredPvpMatch;
    const [progressA, progressB] = [await progressOf(A), await progressOf(B)];
    const winnerSeat = stored.result?.winner;
    expect(progressA?.rankedPlayed).toBe(1);
    expect(progressB?.rankedPlayed).toBe(1);
    expect(progressA?.rating).toBe(
      KESSEN_RANKED_START_RATING + (resumed.result.rating?.you.delta ?? 0),
    );
    expect(progressB?.rating).toBe(
      KESSEN_RANKED_START_RATING + (other.result.rating?.you.delta ?? 0),
    );
    if (winnerSeat === null || winnerSeat === undefined) return;
    const winnerId =
      winnerSeat === 0 ? (ended?.userId as string) : (ended?.opponentId as string);
    const loserId = winnerId === A ? B : A;
    expect(await moneyOf(winnerId)).toBe(START_MONEY + KESSEN_RANKED_WIN_RYO);
    expect(await moneyOf(loserId)).toBe(START_MONEY);
    expect((await progressOf(winnerId))?.rankedRewardsToday).toBe(1);
    expect((await progressOf(winnerId))?.rankedWins).toBe(1);
    // Reading again pays nothing more.
    await (await pvp(winnerId)).getMatch({ matchId });
    expect(await moneyOf(winnerId)).toBe(START_MONEY + KESSEN_RANKED_WIN_RYO);
  });

  it("settles a ranked duel stranded after its ending write once, from the cron", async () => {
    const matchId = await concededRankedDuel(true);
    expect((await runCron()).settled).toBe(1);
    const row = await matchRow(matchId);
    const result = storedDuelOf(row).result;
    expect(row?.rated).toBe(true);
    expect(storedDuelOf(row).settlement).toBeNull();
    expect(result).toMatchObject({
      winner: 1,
      settling: false,
      reward: { seat: 1, ryo: KESSEN_RANKED_WIN_RYO, packItemId: null },
    });
    const [progressA, progressB] = [await progressOf(A), await progressOf(B)];
    expect(progressA?.rankedPlayed).toBe(1);
    expect(progressA?.rankedLosses).toBe(1);
    expect(progressB?.rankedWins).toBe(1);
    expect(progressB?.rankedRewardsToday).toBe(1);
    expect(progressA?.rating).toBe(
      KESSEN_RANKED_START_RATING + (result?.ratings?.[0].delta ?? 0),
    );
    expect(progressB?.rating).toBe(
      KESSEN_RANKED_START_RATING + (result?.ratings?.[1].delta ?? 0),
    );
    expect(await moneyOf(B)).toBe(START_MONEY + KESSEN_RANKED_WIN_RYO);
    // The duel's channel heard the settled version.
    expect(pushes.some((push) => push.channel === matchId)).toBe(true);

    // Later sweeps and reads pay nothing more.
    expect((await runCron()).settled).toBe(0);
    await (await pvp(B)).getMatch({ matchId });
    expect(await moneyOf(B)).toBe(START_MONEY + KESSEN_RANKED_WIN_RYO);
    expect((await progressOf(B))?.rankedPlayed).toBe(1);
    expect((await progressOf(B))?.rankedRewardsToday).toBe(1);
  });

  it("settles a stranded duel from current progress after another rewarded win", async () => {
    const weekKey = getUtcDayKey(periodStart("weekly", new Date()));
    await (await db())
      .update(kessenProgress)
      .set({
        rankedWeekKey: weekKey,
        rankedWeeklyWins: KESSEN_RANKED_WEEKLY_PACK_WINS - 1,
      })
      .where(eq(kessenProgress.userId, B));
    // Both duels were planned while B's next win reached the weekly pack.
    const stranded = await concededRankedDuel(true);
    expect(storedDuelOf(await matchRow(stranded)).settlement?.reward?.packItemId).toBe(
      KESSEN_PACK_IDS.paper,
    );
    const later = await concededRankedDuel(false);
    const laterResult = storedDuelOf(await matchRow(later)).result;
    expect(laterResult?.reward?.packItemId).toBe(KESSEN_PACK_IDS.paper);
    expect(await packsOf(B)).toBe(1);
    const ratingA = (await progressOf(A))?.rating;
    const ratingB = (await progressOf(B))?.rating;

    expect((await runCron()).settled).toBe(1);
    const result = storedDuelOf(await matchRow(stranded)).result;
    expect(result?.reward).toEqual({
      seat: 1,
      ryo: KESSEN_RANKED_WIN_RYO,
      packItemId: null,
    });
    expect(await packsOf(B)).toBe(1);
    expect(await moneyOf(B)).toBe(START_MONEY + 2 * KESSEN_RANKED_WIN_RYO);
    const progressB = await progressOf(B);
    expect(progressB?.rankedWeeklyWins).toBe(KESSEN_RANKED_WEEKLY_PACK_WINS + 1);
    expect(progressB?.rankedRewardsToday).toBe(2);
    expect(progressB?.rankedPlayed).toBe(2);
    // The stranded duel moved the ratings the later duel left.
    expect(result?.ratings?.[0].before).toBe(ratingA as number);
    expect(result?.ratings?.[1].before).toBe(ratingB as number);
    expect((await progressOf(A))?.rating).toBe(result?.ratings?.[0].after as number);
    expect(progressB?.rating).toBe(result?.ratings?.[1].after as number);
  });

  it("gives the ranked queue claim to exactly one matcher", async () => {
    await (await pvp(A)).joinRankedQueue({ deck: LOANER_A });
    // B queues without matching (its row is written directly), then both poll at once.
    await (await db()).insert(kessenRankedQueue).values({
      userId: B,
      rating: KESSEN_RANKED_START_RATING,
      deck: LOANER_B as never,
    });
    const race: { b?: Awaited<ReturnType<Caller["checkRankedQueue"]>> } = {};
    const racing = aroundStatements(
      await db(),
      kessenRankedQueue,
      async (run) => {
        race.b ??= await (await pvp(B)).checkRankedQueue();
        return run();
      },
      { operations: ["execute"] },
    );
    const a = await callerForDatabase(kessenPvpRouter, A, racing).checkRankedQueue();
    expect(race.b?.matchId).toBeTruthy();
    expect(a.matchId).toBeNull();
    const duels = await (await db()).select().from(kessenMatch);
    expect(duels).toHaveLength(1);
    expect(duels[0]?.kind).toBe("RANKED");
    // A's next poll finds the duel B created.
    expect((await (await pvp(A)).checkRankedQueue()).matchId).toBe(
      duels[0]?.id ?? null,
    );
  });

  it("rates a concession, but stops rating a pair after the daily cap and caps rewards", async () => {
    const first = await rankedDuel();
    const conceded = await (await pvp(A)).concede({ matchId: first });
    expect(conceded.success).toBe(true);
    if (!("match" in conceded) || !conceded.match?.result) throw new Error("No result");
    expect(conceded.match.result).toMatchObject({
      outcome: "loss",
      endedBy: "concede",
    });
    // A short conceded duel moves the rating but pays no reward.
    expect(conceded.match.result.rating?.you.delta).toBeLessThan(0);
    expect(conceded.match.result.reward).toBeNull();
    expect(await moneyOf(B)).toBe(START_MONEY);
    const ratingA = (await progressOf(A))?.rating;
    // A second concession of the ended duel changes nothing.
    expect((await (await pvp(A)).concede({ matchId: first })).success).toBe(false);
    expect((await progressOf(A))?.rating).toBe(ratingA);

    // A second duel starts while the pair has one rated match today; once today's
    // count reaches the cap, the duel ends unrated.
    const second = await rankedDuel();
    const now = new Date();
    await (await db()).insert(kessenMatch).values(
      Array.from({ length: KESSEN_RANKED_PAIR_DAILY_RATED - 1 }, (_, n) => ({
        id: `rated-${n}`,
        kind: "RANKED" as const,
        userId: n % 2 === 0 ? A : B,
        opponentId: n % 2 === 0 ? B : A,
        status: "FINISHED" as const,
        engineVersion: 0,
        seed: "x",
        state: {},
        rated: true,
        finishedAt: now,
      })),
    );
    const before = (await progressOf(B))?.rating;
    const unrated = await (await pvp(A)).concede({ matchId: second });
    if (!("match" in unrated) || !unrated.match?.result) throw new Error("No result");
    expect(unrated.match.result.rating).toBeNull();
    expect(unrated.match.result.note).toContain("unrated");
    expect((await progressOf(B))?.rating).toBe(before);
    expect((await matchRow(second))?.rated).toBe(false);

    // Matchmaking no longer pairs them while the cap holds.
    await (await pvp(A)).joinRankedQueue({ deck: LOANER_A });
    const blocked = await (await pvp(B)).joinRankedQueue({ deck: LOANER_B });
    expect(blocked.success).toBe(true);
    expect("matchId" in blocked ? blocked.matchId : null).toBeNull();
  });

  it("pays no ranked ryo past the daily reward cap", async () => {
    const matchId = await rankedDuel();
    await (await db())
      .update(kessenProgress)
      .set({
        rankedRewardDay: getUtcDayKey(),
        rankedRewardsToday: KESSEN_RANKED_DAILY_REWARDED_WINS,
      })
      .where(and(eq(kessenProgress.userId, A)));
    await (await db())
      .update(kessenProgress)
      .set({
        rankedRewardDay: getUtcDayKey(),
        rankedRewardsToday: KESSEN_RANKED_DAILY_REWARDED_WINS,
      })
      .where(eq(kessenProgress.userId, B));
    await backdate(matchId);
    await playOut(matchId);
    const row = await matchRow(matchId);
    const stored = row?.state as unknown as KessenStoredPvpMatch;
    expect(row?.rated).toBe(true);
    expect(stored.result?.reward).toBeNull();
    expect(await moneyOf(A)).toBe(START_MONEY);
    expect(await moneyOf(B)).toBe(START_MONEY);
  });

  it("keeps one active match across duels and NPC matches", async () => {
    const started = await friendlyDuel();
    // A third player cannot challenge someone in a duel, and the duelists cannot queue.
    expect(
      (await (await pvp(C)).createChallenge({ targetId: A, deck: LOANER_A })).message,
    ).toBe("That player is in a match right now.");
    expect((await (await pvp(B)).joinRankedQueue({ deck: LOANER_B })).message).toBe(
      "Finish your current Kessen match first.",
    );
    const lobby = await (await pvp(B)).getLobby();
    expect(lobby.activeMatch).toMatchObject({
      id: started.id,
      kind: "FRIENDLY",
      seat: 1,
      opponent: { userId: A, username: "DuelistA" },
      yourTurn: true,
    });
    expect((await (await callerFor(kessenRouter, A)).getHub()).activeMatch).toBeNull();
  });
});
