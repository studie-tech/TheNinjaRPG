import { afterEach, beforeEach, expect, it, setSystemTime } from "bun:test";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { GET } from "@/app/api/daily-votes/route";
import { POST } from "@/app/api/webhooks/toprankingames/route";
import { gameSetting, userData, userVote } from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import {
  updateUserVoteForHandleVote,
  updateUserVoteForTopRankinGames,
} from "@/queries/profile";
import { profileRouter } from "@/server/api/routers/profile";
import { insertUsers, insertUserVotes } from "../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

const today = new Date("2026-11-28T00:00:01Z");
const yesterday = new Date("2026-11-27T00:00:01Z");
const key = "test-toprankingames-secret";
const readVote = async () =>
  (await getTestDatabase()).query.userVote.findFirst({
    where: eq(userVote.userId, "voter"),
  });

const callback = (votedAt = today, voteId = "123", token = "vote-token") => {
  const body = JSON.stringify({
    game: "theninja-rpg",
    site_vote_id: voteId,
    token,
    voted_at: votedAt.getTime() / 1000,
    sent_at: Date.now() / 1000,
  });
  return POST(
    new Request("http://example.test/api/webhooks/toprankingames", {
      method: "POST",
      body,
      headers: {
        "x-signature": `sha256=${createHmac("sha256", key).update(body).digest("hex")}`,
      },
    }),
  );
};

const resetDailyVotes = () =>
  GET(
    new Request("http://example.test/api/daily-votes", {
      headers: { authorization: "Bearer test-daily-votes-cron" },
    }),
  );

describeWithDatabase("TopRankinGames vote recording", () => {
  let originalSecret: string | undefined;
  let originalCronSecret: string | undefined;

  beforeEach(async () => {
    originalSecret = env.TOPRANKINGAMES_WEBHOOK_SECRET;
    originalCronSecret = process.env.CRON_SECRET;
    env.TOPRANKINGAMES_WEBHOOK_SECRET = key;
    process.env.CRON_SECRET = "test-daily-votes-cron";
    setSystemTime(today);
    await resetTables(userData, userVote, gameSetting);
    const database = await getTestDatabase();
    await database.insert(gameSetting).values({
      id: "daily-votes-timer",
      name: "daily-votes",
      value: 0,
      time: yesterday,
    });
    await insertUsers([
      { userId: "voter", reputationPoints: 0, reputationPointsTotal: 0 },
    ]);
    await insertUserVotes([{ userId: "voter", secret: "vote-token" }]);
  });

  afterEach(() => {
    setSystemTime();
    env.TOPRANKINGAMES_WEBHOOK_SECRET = originalSecret;
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
  });

  it("records concurrent duplicate deliveries only once", async () => {
    const database = await getTestDatabase();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        updateUserVoteForTopRankinGames(database, "vote-token", "123", today),
      ),
    );
    expect(results.filter((result) => result.rowsAffected > 0)).toHaveLength(1);
    expect(await readVote()).toMatchObject({
      topRankinGames: true,
      topRankinGamesVoteId: "123",
      topRankinGamesVotedAt: today,
    });
  });

  it.each([false, true])(
    "retains a midnight vote when yesterday's claimed state is %s",
    async (claimed) => {
      const database = await getTestDatabase();
      await database.update(userVote).set({
        topRankinGames: true,
        topRankinGamesVoteId: "122",
        topRankinGamesVotedAt: yesterday,
        topWebGames: true,
        claimed,
      });
      expect((await callback()).status).toBe(200);
      expect(await readVote()).toMatchObject({
        topRankinGames: true,
        topRankinGamesVoteId: "123",
        topRankinGamesVotedAt: today,
        claimed,
      });
      expect((await resetDailyVotes()).status).toBe(200);
      expect((await callback()).status).toBe(200);
      expect(await readVote()).toMatchObject({
        topRankinGames: true,
        topRankinGamesVoteId: "123",
        topRankinGamesVotedAt: today,
        topWebGames: false,
        claimed: false,
      });
      for (const site of ["mmohub", "arenaTop100", "topWebGames"]) {
        await updateUserVoteForHandleVote(database, site, today, "vote-token");
      }
      expect(
        (await (await callerFor(profileRouter, "voter")).claimVotes()).success,
      ).toBe(true);
      expect(await readVote()).toMatchObject({
        claimed: true,
        topRankinGames: true,
        topRankinGamesVoteId: null,
        topRankinGamesVotedAt: today,
        totalClaims: 1,
      });
    },
  );

  it("does not reuse a signed vote claimed before the daily reset", async () => {
    const database = await getTestDatabase();
    await database.update(userVote).set({
      mmoHub: true,
      arenaTop100: true,
      topWebGames: true,
    });
    expect((await callback()).status).toBe(200);
    const caller = await callerFor(profileRouter, "voter");
    expect((await caller.claimVotes()).success).toBe(true);
    expect((await resetDailyVotes()).status).toBe(200);
    const afterReset = await readVote();
    for (const site of ["mmohub", "arenaTop100", "topWebGames"]) {
      await updateUserVoteForHandleVote(database, site, today, afterReset!.secret);
    }
    // Both a receipt retry and a different same-day receipt must stay consumed,
    // even when delivered with the token rotated by the successful claim.
    expect((await callback(today, "123", afterReset!.secret)).status).toBe(200);
    expect((await callback(today, "124", afterReset!.secret)).status).toBe(200);
    expect((await caller.claimVotes()).success).toBe(false);
    expect(await readVote()).toMatchObject({
      claimed: false,
      topRankinGames: false,
      topRankinGamesVoteId: null,
      topRankinGamesVotedAt: today,
      totalClaims: 1,
    });
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, "voter"),
      }),
    ).toMatchObject({ reputationPoints: 1, reputationPointsTotal: 1 });
  });

  it("clears yesterday's vote and rejects a fresh retry before and after reset", async () => {
    const database = await getTestDatabase();
    await updateUserVoteForTopRankinGames(database, "vote-token", "122", yesterday);
    expect(await (await callback(yesterday, "122")).json()).toBe("INVALID");
    expect((await resetDailyVotes()).status).toBe(200);
    expect(await (await callback(yesterday, "122")).json()).toBe("INVALID");
    expect(await readVote()).toMatchObject({
      topRankinGames: false,
      topRankinGamesVoteId: "122",
      topRankinGamesVotedAt: yesterday,
    });
    expect((await callback()).status).toBe(200);
    expect(await readVote()).toMatchObject({ topRankinGames: true });
  });

  it("persists the signed vote time rather than the retry delivery time", async () => {
    setSystemTime(new Date("2026-11-28T00:04:00Z"));
    expect((await callback()).status).toBe(200);
    expect((await resetDailyVotes()).status).toBe(200);
    expect(await readVote()).toMatchObject({
      topRankinGames: true,
      topRankinGamesVotedAt: today,
    });
  });

  it("does not let the unsigned legacy endpoint complete the signed site", async () => {
    const database = await getTestDatabase();
    await updateUserVoteForHandleVote(database, "topRankinGames", today, "vote-token");
    expect(await readVote()).toMatchObject({
      topRankinGames: false,
      topRankinGamesVoteId: null,
      topRankinGamesVotedAt: null,
    });
  });

  it("ignores unknown tokens and refuses same-day refills after a claim", async () => {
    const database = await getTestDatabase();
    await updateUserVoteForTopRankinGames(database, "wrong-token", "123", today);
    expect(await readVote()).toMatchObject({ topRankinGames: false });
    await updateUserVoteForTopRankinGames(database, "vote-token", "123", today);
    await database
      .update(userVote)
      .set({ claimed: true, topRankinGames: false })
      .where(eq(userVote.userId, "voter"));
    await updateUserVoteForTopRankinGames(database, "vote-token", "124", today);
    expect(await readVote()).toMatchObject({
      topRankinGames: false,
      topRankinGamesVoteId: "123",
      claimed: true,
    });
  });
});
