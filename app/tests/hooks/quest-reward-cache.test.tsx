import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createTRPCReact, getQueryKey } from "@trpc/react-query";
import type { ReactNode } from "react";
import type { AppRouter } from "@/api/root";
import * as appClient from "@/app/_trpc/client";
import { getQuestRewardCacheUpdate } from "@/deltas/quests";
import { useQuestRewardCacheUpdate } from "@/hooks/useQuestRewardCacheUpdate";
import { PostProcessedRewardSchema } from "@/validators/rewards";

const api = createTRPCReact<AppRouter>();
const clients: QueryClient[] = [];
const stops: (() => void)[] = [];
beforeEach(() =>
  Object.assign(vi.spyOn(appClient, "api" as never), {
    profile: api.profile,
    quests: api.quests,
    item: api.item,
    useUtils: api.useUtils,
  }),
);
afterEach(() => {
  cleanup();
  stops.splice(0).forEach((stop) => stop());
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

/** Observe the actual feature keys to count server recovery requested by the hook. */
const setup = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  clients.push(client);
  const before = { previousCompletes: 0, periodCompletes: 0, periodStartAt: null };
  const current = {
    candidates: [{ id: "quest", previousAttempts: 0, ...before }],
    raidProgress: [],
    raidRewards: [],
  };
  const keys = [
    getQueryKey(api.profile.getDashboard, undefined, "query"),
    getQueryKey(api.quests.missionHall, { villageId: "leaf", level: 50 }, "query"),
    getQueryKey(api.quests.specificQuests, { questType: "story", level: 50 }, "query"),
    getQueryKey(api.quests.getQuestHistory, { limit: 10 }, "query"),
    getQueryKey(api.quests.allianceBuilding, { level: 50 }, "query"),
    getQueryKey(api.quests.upcomingQuests, { questType: "battlepyramid" }, "query"),
    getQueryKey(api.item.getUserItems, undefined, "query"),
    getQueryKey(api.item.getUserItemsWithVariants, undefined, "query"),
  ];
  const reads = keys.map((queryKey, i) => {
    const value = i === 0 ? current : [];
    client.setQueryData(queryKey, value);
    const queryFn = vi.fn(async () => value);
    stops.push(new QueryObserver(client, { queryKey, queryFn }).subscribe(() => {}));
    return queryFn;
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <api.Provider client={api.createClient({ links: [] })} queryClient={client}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </api.Provider>
  );
  const view = renderHook(useQuestRewardCacheUpdate, { wrapper });
  const update = getQuestRewardCacheUpdate(
    { questId: "quest", ...before, quest: { retryDelay: "none" } },
    null,
    PostProcessedRewardSchema.parse({}),
    false,
  );
  return {
    client,
    keys,
    current,
    reads,
    view,
    result: {
      success: true,
      message: "Progress",
      rewards: PostProcessedRewardSchema.parse({}),
      questCacheUpdate: update,
    },
  };
};

it("keeps reward-free objective progress local without discovery/history reads", async () => {
  const test = setup();
  const snapshot = test.view.result.current.prepareQuestRewardUpdate();
  await act(async () =>
    test.view.result.current.updateQuestRewards(test.result, snapshot, true),
  );
  test.reads.forEach((read) => expect(read).not.toHaveBeenCalled());
  expect(test.client.getQueryData(test.keys[0]!)).toEqual(test.current);
});

it("patches confirmed completion counters while retaining list-membership refreshes", async () => {
  const test = setup();
  test.result.questCacheUpdate = {
    ...test.result.questCacheUpdate,
    after: { ...test.result.questCacheUpdate.after, previousCompletes: 1 },
    discoveryUnchanged: false,
  };
  await act(async () =>
    test.view.result.current.updateQuestRewards(
      test.result,
      test.view.result.current.prepareQuestRewardUpdate(),
      true,
    ),
  );
  expect(test.reads[0]).not.toHaveBeenCalled();
  test.reads.slice(1, 6).forEach((read) => expect(read).toHaveBeenCalledTimes(1));
  test.reads.slice(6).forEach((read) => expect(read).not.toHaveBeenCalled());
  expect(
    test.client.getQueryData<{ candidates: { previousCompletes: number }[] }>(
      test.keys[0]!,
    )?.candidates[0]?.previousCompletes,
  ).toBe(1);
});

it.each(["item", "hunter items", "gathering items", "missing rewards"] as const)(
  "refreshes both inventories after an accepted profile projection with %s",
  async (reward) => {
    const test = setup();
    const inventory = [{ id: "quest-gift" }];
    test.reads
      .slice(6)
      .forEach((read) => read.mockResolvedValueOnce(inventory as never));
    const rewards =
      reward === "missing rewards"
        ? undefined
        : PostProcessedRewardSchema.parse({
            reward_items: reward === "item" ? ["Quest gift"] : [],
            reward_hunter_items: reward === "hunter items",
            reward_gathering_items: reward === "gathering items",
          });
    await act(async () =>
      test.view.result.current.updateQuestRewards(
        { ...test.result, rewards },
        test.view.result.current.prepareQuestRewardUpdate(),
        true,
      ),
    );
    test.reads.slice(0, 6).forEach((read) => expect(read).not.toHaveBeenCalled());
    test.reads.slice(6).forEach((read) => expect(read).toHaveBeenCalledTimes(1));
    test.keys
      .slice(6)
      .forEach((key) => expect(test.client.getQueryData(key)).toEqual(inventory));
  },
);

it.each(["profile recovery", "missing projection", "rejected claim"])(
  "preserves full fan-out after %s",
  async (reason) => {
    const test = setup();
    const result = {
      ...test.result,
      success: reason !== "rejected claim",
      questCacheUpdate:
        reason === "missing projection" ? undefined : test.result.questCacheUpdate,
    };
    await act(async () =>
      test.view.result.current.updateQuestRewards(
        result,
        test.view.result.current.prepareQuestRewardUpdate(),
        reason !== "profile recovery",
      ),
    );
    test.reads.forEach((read) => expect(read).toHaveBeenCalledTimes(1));
  },
);

it.each(["revision", "counter"])(
  "recovers a mismatching dashboard %s",
  async (mismatch) => {
    const test = setup();
    const snapshot = test.view.result.current.prepareQuestRewardUpdate();
    if (mismatch === "revision") test.client.setQueryData(test.keys[0]!, test.current);
    else test.result.questCacheUpdate.before.previousCompletes = 99;
    await act(async () =>
      test.view.result.current.updateQuestRewards(test.result, snapshot, true),
    );
    expect(test.reads[0]).toHaveBeenCalledTimes(1);
  },
);
