import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "bun:test";
import type { AchievementProgress, UserWithRelations } from "@/server/api/routers/profile";
import { prepareUserUpdate, updateUserCache, type UserPatch, type UserUpdateOptions } from "@/utils/userCache";

const key = [["profile", "getUser"], { type: "query" }];
const flows = [
  { file: "app/[shell]/points/StoreCheckout.tsx", procedure: "paypal.captureStoreOrder" },
  { file: "layout/StripePayments.tsx", procedure: "stripe.resolveSession" },
  { file: "app/[shell]/points/page.tsx", procedure: "paypal.resolveSubscription" },
  { file: "app/[shell]/points/page.tsx", procedure: "paypal.resolveTransaction" },
];

/** Run production purchase callbacks against the shared revision-aware cache updater. */
const setup = (file: string, procedure: string, progress: AchievementProgress[]) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const profile = {
    userData: { userId: "buyer", money: 100, reputationPoints: 0, reputationPointsTotal: 0, federalStatus: "NONE", userQuests: [], questData: [] } as unknown as NonNullable<UserWithRelations>,
    achievementProgress: progress,
  };
  client.setQueryData(key, profile);
  const getUser = vi.fn(async () => profile);
  const observer = new QueryObserver(client, { queryKey: key, queryFn: getUser, staleTime: Infinity });
  const unsubscribe = observer.subscribe(() => {});
  const leaf = { invalidate: vi.fn(async () => undefined) };
  const utils = {
    paypal: { getRecentRepsCount: leaf, getPaypalTransactions: leaf, getStoreBundles: leaf },
    stripe: { getPayments: leaf, getPendingCheckouts: leaf, getSubscriptions: leaf },
    item: { getUserItems: leaf, getUserItemsWithVariants: leaf },
  };
  const updateUser = vi.fn((patch: UserPatch | undefined, options: UserUpdateOptions) => updateUserCache(client, key, patch, options));
  const showMutationToast = vi.fn();
  const source = readFileSync(join(import.meta.dirname, "../../src", file), "utf8");
  const call = source.indexOf(`api.${procedure}.useMutation(`);
  const indent = source.slice(source.lastIndexOf("\n", call) + 1, call).match(/^\s*/)?.[0];
  const callbacks = source.slice(call).match(new RegExp(`useMutation\\((\\{[\\s\\S]*?\\n${indent}\\})\\);`))?.[1];
  if (!callbacks) throw new Error(`${procedure} callbacks were not found in ${file}`);
  // Execute production callbacks so dropping response metadata cannot hide behind a manual merge.
  const options = new Function("utils", "prepareUserUpdate", "updateUser", "showMutationToast", "setMessage", "setSessionId", "sendGTMEvent", "props", `return (${callbacks});`)(
    utils, () => prepareUserUpdate(client, key), updateUser, showMutationToast, vi.fn(), vi.fn(), vi.fn(), {},
  ) as { onMutate: () => number | undefined; onSuccess: (data: unknown, input: unknown, revision: number | undefined) => Promise<void> };
  return {
    client, getUser, updateUser, options, profile, showMutationToast,
    value: () => client.getQueryData<typeof profile>(key),
    close: () => { unsubscribe(); client.clear(); },
  };
};

describe.each(flows)("$procedure purchase confirmation", ({ file, procedure }) => {
  it("delivers consumed feedback before awaiting canonical recovery", async () => {
    const test = setup(file, procedure, []);
    let finish!: () => void;
    test.updateUser.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const announcements = ["Started new quest: Purchase Child Mission"];
    try {
      const pending = test.options.onSuccess({ success: true, message: "Delivered", announcements }, undefined, undefined);
      expect(test.showMutationToast).toHaveBeenCalledWith(expect.objectContaining({ announcements }));
      finish();
      await pending;
      expect(test.showMutationToast).toHaveBeenCalledTimes(1);
    } finally { test.close(); }
  });
  it("refetches the canonical profile after delivery when confirmation cannot supply a patch", async () => {
    const test = setup(file, procedure, []);
    try {
      await test.options.onSuccess({ success: true, message: "Delivered", userPatch: undefined, userDelta: undefined }, undefined, test.options.onMutate());
      expect(test.updateUser).toHaveBeenCalledTimes(1);
      expect(test.getUser).toHaveBeenCalledTimes(1);
    } finally { test.close(); }
  });
  it.each([false, true])("updates published achievement progress without a profile read (existing progress: %s)", async (hasProgress) => {
    const progress = { questId: "reputation-achievement", completed: 1 } as AchievementProgress;
    const test = setup(file, procedure, hasProgress ? [{ ...progress, completed: 0 }] : []);
    const tracker = { id: progress.questId, goals: [{ id: "reputation-goal", value: 5, done: true }] };
    try {
      await test.options.onSuccess({ success: true, message: "Delivered", userPatch: { reputationPoints: 5, reputationPointsTotal: 5, questData: [tracker], userQuests: [] }, userDelta: {}, achievementProgress: [progress] }, undefined, test.options.onMutate());
      expect(test.value()?.userData).toMatchObject({ money: 100, reputationPoints: 5, reputationPointsTotal: 5, questData: [tracker], userQuests: [] });
      // Published achievements join their catalogue definition from this separate cache field.
      expect(test.value()?.achievementProgress).toEqual([progress]);
      expect(test.updateUser).toHaveBeenCalledTimes(1);
      expect(test.getUser).not.toHaveBeenCalled();
      expect(test.client.getQueryState(key)?.isInvalidated).toBe(false);
    } finally { test.close(); }
  });

  it("preserves progress when a narrow confirmation has no achievement metadata", async () => {
    const progress = [{ questId: "reputation-achievement", completed: 0 } as AchievementProgress];
    const test = setup(file, procedure, progress);
    try {
      await test.options.onSuccess({ success: true, message: "Delivered", userPatch: { federalStatus: "GOLD" }, userDelta: {} }, undefined, test.options.onMutate());
      expect(test.value()?.userData.federalStatus).toBe("GOLD");
      expect(test.value()?.achievementProgress).toEqual(progress);
      expect(test.getUser).not.toHaveBeenCalled();
    } finally { test.close(); }
  });
});
