import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as client from "@/app/_trpc/client";
import * as ContentBox from "@/layout/ContentBox";
import RaidBrowser from "@/layout/RaidBrowser";
import { UnclaimedSeasonRewards } from "@/layout/UnclaimedSeasonRewards";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import { PostProcessedRewardSchema } from "@/validators/rewards";
import type { UserDeltaResponse } from "@/validators/userCache";

type Success = (result: UserDeltaResponse, variables: unknown, revision: number | undefined) => Promise<void> | void;
let ranked: Success;
let raid: Success;
const settled = async (): Promise<void> => undefined;
const updateUser = vi.fn(settled);
const rewardShown = vi.fn<typeof toast.showRewardToast>(() => undefined);
const mutationShown = vi.fn<typeof toast.showMutationToast>(() => undefined);

beforeEach(() => {
  updateUser.mockClear();
  rewardShown.mockClear();
  mutationShown.mockClear();
  vi.spyOn(toast, "showRewardToast").mockImplementation(rewardShown);
  vi.spyOn(toast, "showMutationToast").mockImplementation(mutationShown);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => <div>{children}</div>);
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: { userId: "actor" }, prepareUserUpdate: () => undefined, updateUser,
  } as never);
  const query = () => ({ useQuery: () => ({}) });
  const mutation = () => ({ useMutation: () => ({}) });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      raids: { getRaidDetails: { invalidate: settled } },
      pvpRank: { getUnclaimedUserSeasonRewards: { invalidate: settled } },
      profile: { getDashboard: { invalidate: settled } },
    }),
    pvpRank: {
      getUnclaimedUserSeasonRewards: query(),
      claimSeasonRewards: { useMutation: (options: { onSuccess: Success }) => { ranked = options.onSuccess; return {}; } },
    },
    raids: {
      getAvailableRaids: query(), getCompletedRaids: query(), getUserRaidQueue: query(),
      getRaidDetails: query(), getRaidLeaderboard: query(), getActiveRaidTeams: query(),
      getUserRaidBuffs: query(),
      joinRaidQueue: mutation(), leaveRaidQueue: mutation(), startRaidBattle: mutation(), readyToQueue: mutation(),
      claimDamageReward: { useMutation: (options: { onSuccess: Success }) => { raid = options.onSuccess; return {}; } },
    },
  });
});

afterEach(() => vi.restoreAllMocks());

it.each(["ranked", "raid"] as const)("delivers %s hydration feedback once through its reward toast before reconciliation", async (source) => {
  renderToStaticMarkup(source === "ranked" ? <UnclaimedSeasonRewards /> : <RaidBrowser />);
  const result: UserDeltaResponse = {
    success: true, message: "Reward claimed", rewards: PostProcessedRewardSchema.parse({ reward_money: 10 }),
    announcements: ["Started new quest: New Child Mission"],
  };
  let finish!: () => void;
  updateUser.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const pending = (source === "ranked" ? ranked : raid)(result, {}, undefined);
  expect(rewardShown).toHaveBeenCalledTimes(1);
  expect(rewardShown).toHaveBeenCalledWith(
    source === "ranked" ? [result.message, ...result.announcements!] : result.announcements,
    result.rewards,
    source === "ranked" ? "Claimed!" : result.message,
  );
  expect(mutationShown).not.toHaveBeenCalled();
  finish();
  await pending;
});
