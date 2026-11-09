import { describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { getClaimedVotesPatch, getClaimVotesUserUpdate } from "@/deltas/profile";
import { VOTE_REWARD_REPUTATION } from "@/drizzle/constants";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";

const key = [["profile", "getUser"], { type: "query" }];
const votes = { id: "vote", userId: "voter", claimed: false, mmoHub: true };

const seed = (reputationPoints: number) => {
  const client = new QueryClient();
  client.setQueryData(key, {
    userData: {
      userId: "voter",
      reputationPoints,
      reputationPointsTotal: reputationPoints,
      votes,
    },
  });
  return client;
};
const cached = (client: QueryClient) =>
  (
    client.getQueryData(key) as {
      userData: {
        reputationPoints: number;
        reputationPointsTotal: number;
        votes: typeof votes;
      };
    }
  ).userData;

describe("vote claim cache update", () => {
  it("credits the vote reward as a delta", () => {
    expect(getClaimVotesUserUpdate()).toEqual({
      userDelta: {
        reputationPoints: VOTE_REWARD_REPUTATION,
        reputationPointsTotal: VOTE_REWARD_REPUTATION,
      },
    });
  });

  it("marks the cached votes claimed and keeps the rest of the record", () => {
    type CachedUser = Parameters<typeof getClaimedVotesPatch>[0];
    expect(getClaimedVotesPatch({ votes } as unknown as CachedUser)).toEqual({
      votes: { ...votes, claimed: true },
    } as never);
    expect(getClaimedVotesPatch({ votes: null } as unknown as CachedUser)).toEqual({
      votes: null,
    });
  });

  it("adds the reward to the balance cached when the claim started", async () => {
    const client = seed(10);
    const revision = prepareUserUpdate(client, key);
    await updateUserCache(client, key, getClaimedVotesPatch, {
      revision,
      delta: getClaimVotesUserUpdate().userDelta,
    });
    expect(cached(client)).toEqual(
      expect.objectContaining({
        reputationPoints: 10 + VOTE_REWARD_REPUTATION,
        reputationPointsTotal: 10 + VOTE_REWARD_REPUTATION,
        votes: { ...votes, claimed: true },
      }),
    );
  });
});
