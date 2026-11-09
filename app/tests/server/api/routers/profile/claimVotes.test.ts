import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { ACTIVE_VOTING_SITES } from "@/drizzle/constants";
import { userData, userVote } from "@/drizzle/schema";
import { profileRouter } from "@/server/api/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { insertUsers, insertUserVotes } from "../../../../setup/factories";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";
import { overrideQuery, withoutTransactions } from "../../../../setup/statements";

/** A completed vote set is credited exactly once, however many claims race for it. */
const VOTER = "vote-claimer";
const ATTEMPTS = 5;
const completedSites = Object.fromEntries(
  ACTIVE_VOTING_SITES.map((site) => [site, true]),
);

const readVoter = async () =>
  (await getTestDatabase()).query.userData.findFirst({
    where: eq(userData.userId, VOTER),
  });
const readVote = async () =>
  (await getTestDatabase()).query.userVote.findFirst({
    where: eq(userVote.userId, VOTER),
  });

describeWithDatabase("vote claims", () => {
  beforeEach(async () => {
    await resetTables(userData, userVote);
    await insertUsers([
      { userId: VOTER, username: VOTER, reputationPoints: 0, reputationPointsTotal: 0 },
    ]);
    await insertUserVotes([{ userId: VOTER, ...completedSites }]);
  });

  it("credits one claim when concurrent requests claim the same votes", async () => {
    const caller = await callerFor(profileRouter, VOTER);
    const results = await Promise.all(
      Array.from({ length: ATTEMPTS }, () => caller.claimVotes()),
    );
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.find((result) => result.success)?.userDelta).toEqual({
      reputationPoints: 1,
      reputationPointsTotal: 1,
    });
    expect(
      results.filter((result) => !result.success).every((result) => !result.userDelta),
    ).toBe(true);
    expect(await readVoter()).toMatchObject({
      reputationPoints: 1,
      reputationPointsTotal: 1,
    });
    expect(await readVote()).toMatchObject({ claimed: true, totalClaims: 1 });
  });

  it("credits a claim when the retired bbogd site was never voted on", async () => {
    const database = await getTestDatabase();
    await database
      .update(userVote)
      .set({ bbogd: false })
      .where(eq(userVote.userId, VOTER));
    const result = await (await callerFor(profileRouter, VOTER)).claimVotes();
    expect(result.success).toBe(true);
    expect(await readVoter()).toMatchObject({
      reputationPoints: 1,
      reputationPointsTotal: 1,
    });
  });

  it("claims and credits in one statement without a transaction", async () => {
    const database = await getTestDatabase();
    const result = await callerForDatabase(
      profileRouter,
      VOTER,
      withoutTransactions(database),
    ).claimVotes();
    expect(result.success).toBe(true);
    expect(await readVoter()).toMatchObject({
      reputationPoints: 1,
      reputationPointsTotal: 1,
    });
    expect(await readVote()).toMatchObject({ claimed: true, totalClaims: 1 });
  });

  it("credits nothing when the votes were claimed after the read", async () => {
    const database = await getTestDatabase();
    // Another request claims the votes after this one has read them as unclaimed
    await database
      .update(userVote)
      .set({ claimed: true })
      .where(eq(userVote.userId, VOTER));
    const result = await callerForDatabase(
      profileRouter,
      VOTER,
      unclaimedVoteClient(database),
    ).claimVotes();
    expect(result.success).toBe(false);
    expect(await readVoter()).toMatchObject({
      reputationPoints: 0,
      reputationPointsTotal: 0,
    });
    expect(await readVote()).toMatchObject({ claimed: true, totalClaims: 0 });
  });
});

/** A client whose vote reads still show the record as unclaimed. */
const unclaimedVoteClient = (database: DrizzleClient) =>
  overrideQuery(database, "userVote", {
    findFirst: async (read, ...args) => {
      const row = await read(...args);
      return row ? { ...row, claimed: false } : row;
    },
  });
