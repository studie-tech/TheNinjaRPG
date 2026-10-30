import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { STORE_REP_PRODUCTS } from "@/drizzle/constants";
import { gameSetting, notification, paypalSubscription, quest, questHistory, storePurchase, storeUserIdAlias, stripePayment, userData, userVote } from "@/drizzle/schema";
import * as purchaseQueries from "@/queries/purchases";
import * as profileQueries from "@/queries/profile";
import * as profileApi from "@/server/api/routers/profile";
import { paypalRouter } from "@/server/api/routers/paypal";
import { profileRouter } from "@/server/api/routers/profile";
import { purchasesRouter } from "@/server/api/routers/purchases";
import { getPurchaseUserUpdate } from "@/server/utils/purchases/cache";
import { grantStorePurchase } from "@/server/utils/purchases/grant";
import { calcFedUgradeCost } from "@/utils/paypal";
import { prepareUserUpdate, updateUserCache, type UserPatch, type UserUpdateOptions } from "@/utils/userCache";
import { InstantNewQuestObjective, SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuestHistory, insertQuests, insertUsers } from "../../setup/factories";
import { failStatements } from "../../setup/statements";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";
import { countUserReads } from "../../setup/userReads";

const userId = "purchase-progress-player";
type Profile = Awaited<ReturnType<ReturnType<typeof profileRouter.createCaller>["getUser"]>>;
const goal = (profile: Profile | undefined) => profile?.userData?.questData?.find((entry) => entry.id === "purchase-progress")?.goals.find((entry) => entry.id === "purchase-goal");
const upgradeCost = calcFedUgradeCost("NORMAL", "GOLD")!;
const seedUpgrade = async (source: "paypal" | "stripe") => {
  const db = await getTestDatabase();
  await db.update(userData).set({ federalStatus: "NORMAL", reputationPoints: upgradeCost * 3, reputationPointsTotal: upgradeCost * 3 }).where(eq(userData.userId, userId));
  if (source === "paypal") {
    await db.insert(paypalSubscription).values({ id: "upgrade-period", subscriptionId: "upgrade-period", createdById: userId, affectedUserId: userId, federalStatus: "NORMAL", status: "ACTIVE" });
  } else {
    await db.insert(stripePayment).values({ id: "upgrade-period", checkoutId: "upgrade-checkout", createdById: userId, affectedUserId: userId, federalStatus: "NORMAL", amountCents: 500, reputationPoints: 0, purchasedAt: new Date(), grantedAt: new Date(), expiresAt: new Date(Date.now() + 86400000) });
  }
};
const upgradeCallbacks = (cache: QueryClient, key: QueryKey) => {
  const source = readFileSync(join(import.meta.dirname, "../../../src/app/[shell]/points/page.tsx"), "utf8");
  const callbacks = source.slice(source.indexOf("api.paypal.upgradeSubscription.useMutation(")).match(/useMutation\((\{[\s\S]*?\n    \})\);/)?.[1];
  if (!callbacks) throw new Error("Subscription upgrade callbacks were not found");
  return new Function("prepareUserUpdate", "updateUser", "showMutationToast", "props", "onError", `return (${callbacks});`)(
    () => prepareUserUpdate(cache, key),
    (patch: UserPatch | undefined, options: UserUpdateOptions) => updateUserCache(cache, key, patch, options),
    vi.fn(), {}, vi.fn(),
  ) as { onMutate: () => number | undefined; onSuccess: (data: unknown, input: unknown, revision: number | undefined) => Promise<void> };
};

describeWithDatabase("purchase reputation progression", () => {
  beforeEach(async () => {
    await resetTables(paypalSubscription, stripePayment, storePurchase, storeUserIdAlias, notification, questHistory, quest, userVote, userData, gameSetting);
    await insertUsers([{ userId, username: "PurchaseProgress", role: "USER", rank: "JONIN", level: 50, primaryElement: "Fire", secondaryElement: "Water", status: "AWAKE", isOutlaw: true, regeneration: 0, money: 0, reputationPoints: 0, reputationPointsTotal: 0, updatedAt: new Date(), regenAt: new Date() }]);
    const db = await getTestDatabase();
    await db.insert(userVote).values({ id: "purchase-progress-vote", userId, secret: "payment1", lastVoteAt: new Date() });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["native", "web"] as const)("preserves consumed progression messages through a %s purchase fallback", async (source) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ role: "OWNER" }).where(eq(userData.userId, userId));
    const content = { reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] };
    await insertQuests([
      { id: "purchase-progress", questType: "mission", hidden: false, content: { ...content, objectives: [
        SimpleObjective.parse({ id: "purchase-goal", task: "reputation_points", value: 1 }),
      ] } },
      { id: "purchase-effect", questType: "mission", hidden: false, content: { ...content, objectives: [
        InstantNewQuestObjective.parse({ id: "start-child", task: "new_quest", newQuestIds: ["purchase-child"] }),
      ] } },
      { id: "purchase-child", name: "Purchase Child Mission", questType: "mission", hidden: false,
        content: { ...content, objectives: [SimpleObjective.parse({ id: "arena", task: "arena_kills", value: 100 })] } },
    ]);
    await insertQuestHistory([{ userId, questId: "purchase-progress", questType: "mission" }]);
    const profile = await callerFor(profileRouter, userId);
    await profile.getUser();
    expect(await grantStorePurchase(db, { userId, transactionId: "feedback-purchase", productId: STORE_REP_PRODUCTS[0]!.productId, store: "APPLE", isSandbox: false, purchasedAt: new Date(), raw: {} })).toMatchObject({ status: "granted" });
    // An admitted quest can have an instant effect pending during purchase confirmation.
    await insertQuestHistory([{ userId, questId: "purchase-effect", questType: "mission" }]);
    const result = source === "native" ? await (await callerFor(purchasesRouter, userId)).userSnapshot() : await getPurchaseUserUpdate(db, userId);
    expect(result.userPatch).toBeFalsy();
    expect(result.announcements).toContain("Started new quest: Purchase Child Mission");
    const canonical = await profile.getUser();
    expect(canonical.userData?.userQuests.some((entry) => entry.questId === "purchase-child")).toBe(true);
    expect(canonical.notifications.some((entry) => entry.name === "Started new quest: Purchase Child Mission")).toBe(false);
  });

  it.each(["snapshot unavailable", "snapshot missing", "catalogue unavailable", "bootstrap unavailable"] as const)("reconciles a delivered native purchase when confirmation is %s", async (failure) => {
    const db = await getTestDatabase();
    const profile = await callerFor(profileRouter, userId);
    const initial = await profile.getUser();
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["unavailable-purchase-profile"];
    const read = vi.fn(() => profile.getUser());
    cache.setQueryDefaults(key, { queryFn: read });
    cache.setQueryData(key, initial);
    const revision = prepareUserUpdate(cache, key);
    const purchase = { userId, transactionId: "confirmed-native-purchase", productId: STORE_REP_PRODUCTS[0]!.productId, store: "APPLE" as const, isSandbox: false, purchasedAt: new Date(), raw: {} };
    expect(await grantStorePurchase(db, purchase)).toMatchObject({ status: "granted" });
    if (failure === "snapshot missing") vi.spyOn(purchaseQueries, "findPurchaseUserSnapshot").mockResolvedValueOnce(undefined);
    else if (failure === "snapshot unavailable") vi.spyOn(purchaseQueries, "findPurchaseUserSnapshot").mockRejectedValueOnce(new Error("Purchase confirmation unavailable"));
    else if (failure === "catalogue unavailable") vi.spyOn(profileQueries, "fetchAchievementCatalogue").mockRejectedValueOnce(new Error("Purchase catalogue unavailable"));
    else vi.spyOn(profileApi, "fetchQuestBootstrap").mockRejectedValueOnce(new Error("Purchase bootstrap unavailable"));
    try {
      const result = await (await callerFor(purchasesRouter, userId)).userSnapshot();
      expect(result.userPatch).toBeNull();
      expect(result.achievementProgress).toBeUndefined();
      await updateUserCache(cache, key, result.userPatch ?? undefined, { revision, achievementProgress: result.achievementProgress });
      expect(read).toHaveBeenCalledTimes(1);
      expect(cache.getQueryData<typeof initial>(key)?.userData?.reputationPoints).toBe(STORE_REP_PRODUCTS[0]!.reputationPoints);
      expect(await grantStorePurchase(db, purchase)).toMatchObject({ status: "duplicate" });
      expect(await db.query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({ reputationPoints: STORE_REP_PRODUCTS[0]!.reputationPoints });
    } finally { cache.clear(); }
  });

  it("omits the known-empty delta when confirmation has no character", async () => {
    const db = await getTestDatabase();
    await db.delete(userData).where(eq(userData.userId, userId));
    const result = await getPurchaseUserUpdate(db, userId);
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
  });

  it("propagates canonical purchase progression errors", async () => {
    const db = await getTestDatabase();
    await insertQuests([{ id: "purchase-progress", questType: "achievement", hidden: false,
      content: { objectives: [SimpleObjective.parse({ id: "purchase-goal", task: "reputation_points", value: 1 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] } }]);
    vi.spyOn(profileApi, "fetchUpdatedUser").mockRejectedValueOnce(new Error("Purchase progression unavailable"));
    await expect(getPurchaseUserUpdate(db, userId)).rejects.toThrow("Purchase progression unavailable");
  });

  it.each(["payment", "native"] as const)("merges %s confirmation and reputation progression without refetching", async (source) => {
    const db = await getTestDatabase();
    await insertQuests([{ id: "purchase-progress", name: "Purchase Progress", questType: "achievement", hidden: false,
      content: { objectives: [SimpleObjective.parse({ id: "purchase-goal", task: "reputation_points", value: 1 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] } }]);
    const profile = await callerFor(profileRouter, userId);
    const initial = await profile.getUser();
    expect(goal(initial)).toMatchObject({ done: false, value: 0 });
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["purchase-profile"];
    let refetches = 0;
    cache.setQueryDefaults(key, { queryFn: async () => { refetches += 1; throw new Error("Unexpected profile refetch"); } });
    cache.setQueryData(key, initial);
    const revision = prepareUserUpdate(cache, key);
    const product = STORE_REP_PRODUCTS[0]!;
    expect(await grantStorePurchase(db, { userId, transactionId: "reputation-purchase", productId: product.productId, store: "APPLE", isSandbox: false, purchasedAt: new Date(), raw: {} })).toMatchObject({ status: "granted" });
    const result = source === "native" ? await (await callerFor(purchasesRouter, userId)).userSnapshot() : await getPurchaseUserUpdate(db, userId);
    await updateUserCache(cache, key, result.userPatch ?? undefined, { revision, achievementProgress: "achievementProgress" in result ? result.achievementProgress : undefined });
    expect(refetches).toBe(0);
    expect(goal(cache.getQueryData(key))).toMatchObject({ done: true, value: product.reputationPoints });
    expect(cache.getQueryData<Profile>(key)?.userData?.reputationPoints).toBe(product.reputationPoints);
    const saved = await db.query.userData.findFirst({ where: eq(userData.userId, userId) });
    expect(saved).toMatchObject({ reputationPoints: product.reputationPoints, reputationPointsTotal: product.reputationPoints });
    expect(goal(await profile.getUser())).toEqual(goal(cache.getQueryData(key)));
    cache.clear();
  });

  it("retains the narrow public patch when no available objective needs reputation", async () => {
    const db = await getTestDatabase();
    await insertQuests([{ id: "purchase-progress", questType: "achievement", hidden: false, requiredLevel: 60,
      content: { objectives: [SimpleObjective.parse({ id: "purchase-goal", task: "reputation_points", value: 1 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] } }]);
    const counted = countUserReads(db);
    const result = await getPurchaseUserUpdate(counted.client, userId);
    expect(result).toEqual({ userPatch: { money: 0, reputationPoints: 0, reputationPointsTotal: 0, federalStatus: "NONE" }, userDelta: {} });
    expect(counted.getReads()).toBe(1);
  });

  it("projects reputation objectives on active hidden quests", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ role: "OWNER" }).where(eq(userData.userId, userId));
    await insertQuests([{ id: "purchase-progress", questType: "story", hidden: true,
      content: { objectives: [SimpleObjective.parse({ id: "purchase-goal", task: "reputation_points", value: 1 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] } }]);
    await insertQuestHistory([{ userId, questId: "purchase-progress", questType: "story" }]);
    await (await callerFor(profileRouter, userId)).getUser();
    await db.update(userData).set({ reputationPoints: 5, reputationPointsTotal: 5 }).where(eq(userData.userId, userId));
    const result = await getPurchaseUserUpdate(db, userId);
    expect(result.userPatch?.questData?.find((entry) => entry.id === "purchase-progress")?.goals[0]).toMatchObject({ value: 5, done: true });
  });

  it.each((["paypal", "stripe"] as const).flatMap((source) => (["none", "mission", "achievement"] as const).map((questType) => ({ source, questType }))))("merges $source upgrade balances and $questType reputation progress without a profile refetch", async ({ source, questType }) => {
    await seedUpgrade(source);
    if (questType !== "none") {
      await insertQuests([{ id: "purchase-progress", questType, hidden: false,
        content: { objectives: [SimpleObjective.parse({ id: "purchase-goal", task: "reputation_points", value: upgradeCost * 4 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] } }]);
      if (questType === "mission") await insertQuestHistory([{ userId, questId: "purchase-progress", questType }]);
    }
    const profile = await callerFor(profileRouter, userId);
    const initial = await profile.getUser();
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["upgrade-profile"];
    const read = vi.fn(() => profile.getUser());
    cache.setQueryDefaults(key, { queryFn: read });
    cache.setQueryData(key, initial);
    const callbacks = upgradeCallbacks(cache, key);
    const revision = callbacks.onMutate();
    const hydration = vi.spyOn(profileApi, "fetchUpdatedUser");
    try {
      const caller = await callerFor(paypalRouter, userId);
      const result = await caller.upgradeSubscription({ userId, plan: "GOLD" });
      expect(result.success).toBe(true);
      expect(hydration).toHaveBeenCalledTimes(questType === "none" ? 0 : 1);
      expect(result.userDelta).toEqual({});
      await callbacks.onSuccess(result, undefined, revision);
      expect(read).not.toHaveBeenCalled();
      const cached = cache.getQueryData<Profile>(key);
      expect(cached?.userData).toMatchObject({ federalStatus: "GOLD", reputationPoints: upgradeCost * 2, reputationPointsTotal: upgradeCost * 2 });
      if (questType !== "none") expect(goal(cached)).toMatchObject({ value: upgradeCost * 2, done: false });
      const canonical = await profile.getUser();
      expect(cached?.userData?.questData).toEqual(canonical.userData?.questData);
      expect(cached?.achievementProgress).toMatchObject(canonical.achievementProgress.map(({ startedAt: _startedAt, ...entry }) => entry));
      const replay = await caller.upgradeSubscription({ userId, plan: "GOLD" });
      expect(replay.success).toBe(false);
      expect(replay.userPatch).toBeUndefined();
      expect(replay.userDelta).toBeUndefined();
      expect(await (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({ reputationPoints: upgradeCost * 2, reputationPointsTotal: upgradeCost * 2 });
    } finally { cache.clear(); }
  });

  it.each((["paypal", "stripe"] as const).flatMap((source) => (["missing", "unavailable", "announcement", "recruit reward"] as const).map((failure) => ({ source, failure }))))("reconciles a committed $source upgrade for $failure", async ({ source, failure }) => {
    await seedUpgrade(source);
    const hasFeedback = failure === "announcement" || failure === "recruit reward";
    if (!hasFeedback) {
      await insertQuests([{ id: "purchase-progress", questType: "achievement", hidden: false,
        content: { objectives: [SimpleObjective.parse({ id: "purchase-goal", task: "reputation_points", value: upgradeCost * 4 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] } }]);
    }
    const db = await getTestDatabase();
    const profile = await callerFor(profileRouter, userId);
    const initial = await profile.getUser();
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["unconfirmed-upgrade-profile"];
    const read = vi.fn(() => profile.getUser());
    cache.setQueryDefaults(key, { queryFn: read });
    cache.setQueryData(key, initial);
    const callbacks = upgradeCallbacks(cache, key);
    const revision = callbacks.onMutate();
    const confirmation = vi.spyOn(purchaseQueries, "findPurchaseUserSnapshot");
    if (failure === "missing") confirmation.mockResolvedValueOnce(undefined);
    else if (failure === "unavailable") confirmation.mockRejectedValueOnce(new Error("Upgrade confirmation unavailable"));
    else {
      await db.insert(notification).values({ userId, content: "A new event has started." });
      await db.update(userData).set(failure === "announcement" ? { unreadNotifications: 1 } : { unreadRecruitRewards: 1 }).where(eq(userData.userId, userId));
    }
    try {
      const caller = await callerFor(paypalRouter, userId);
      const result = await caller.upgradeSubscription({ userId, plan: "GOLD" });
      expect(result.success).toBe(true);
      expect(result.userPatch).toBeUndefined();
      expect(result.userDelta).toBeUndefined();
      expect(result.achievementProgress).toBeUndefined();
      await callbacks.onSuccess(result, undefined, revision);
      expect(read).toHaveBeenCalledTimes(1);
      expect(cache.getQueryData<Profile>(key)?.userData).toMatchObject({ federalStatus: "GOLD", reputationPoints: upgradeCost * 2, reputationPointsTotal: upgradeCost * 2 });
      if (hasFeedback) {
        const name = failure === "announcement" ? "A new event has started." : "Your recruits earned you 1 rank milestone reward";
        expect(cache.getQueryData<Profile>(key)?.notifications).toContainEqual(expect.objectContaining({ color: "toast", name }));
        expect(await db.query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({ unreadNotifications: 0, unreadRecruitRewards: 0 });
      } else expect(goal(cache.getQueryData(key))).toMatchObject({ value: upgradeCost * 2 });
      expect((await caller.upgradeSubscription({ userId, plan: "GOLD" })).success).toBe(false);
      expect(await (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({ reputationPoints: upgradeCost * 2 });
    } finally { cache.clear(); }
  });

  it.each(["paypal", "stripe"] as const)("propagates failed %s upgrade writes without confirming a purchase", async (source) => {
    await seedUpgrade(source);
    const db = await getTestDatabase();
    const confirmation = vi.spyOn(purchaseQueries, "findPurchaseUserSnapshot");
    const caller = callerForDatabase(paypalRouter, userId, failStatements(db, userData));
    await expect(caller.upgradeSubscription({ userId, plan: "GOLD" })).rejects.toThrow("Statement failed on purpose");
    expect(confirmation).not.toHaveBeenCalled();
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({ federalStatus: "NORMAL", reputationPoints: upgradeCost * 3, reputationPointsTotal: upgradeCost * 3 });
  });

  it.each(["paypal", "stripe"] as const)("propagates canonical progression errors after a committed %s upgrade", async (source) => {
    await seedUpgrade(source);
    await insertQuests([{ id: "purchase-progress", questType: "achievement", hidden: false,
      content: { objectives: [SimpleObjective.parse({ id: "purchase-goal", task: "reputation_points", value: upgradeCost * 4 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] } }]);
    vi.spyOn(profileApi, "fetchUpdatedUser").mockRejectedValueOnce(new Error("Upgrade progression unavailable"));
    const caller = await callerFor(paypalRouter, userId);
    await expect(caller.upgradeSubscription({ userId, plan: "GOLD" })).rejects.toThrow("Upgrade progression unavailable");
    expect(await (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({ federalStatus: "GOLD", reputationPoints: upgradeCost * 2, reputationPointsTotal: upgradeCost * 2 });
    expect((await caller.upgradeSubscription({ userId, plan: "GOLD" })).success).toBe(false);
  });
});
