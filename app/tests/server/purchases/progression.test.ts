import { QueryClient } from "@tanstack/react-query";
import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { STORE_REP_PRODUCTS } from "@/drizzle/constants";
import { gameSetting, quest, questHistory, storePurchase, storeUserIdAlias, userData, userVote } from "@/drizzle/schema";
import { profileRouter } from "@/server/api/routers/profile";
import { purchasesRouter } from "@/server/api/routers/purchases";
import { getPurchaseUserUpdate } from "@/server/utils/purchases/cache";
import { grantStorePurchase } from "@/server/utils/purchases/grant";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuestHistory, insertQuests, insertUsers } from "../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";
import { countUserReads } from "../../setup/userReads";

const userId = "purchase-progress-player";
type Profile = Awaited<ReturnType<ReturnType<typeof profileRouter.createCaller>["getUser"]>>;
const goal = (profile: Profile | undefined) => profile?.userData?.questData?.find((entry) => entry.id === "purchase-progress")?.goals.find((entry) => entry.id === "purchase-goal");

describeWithDatabase("purchase reputation progression", () => {
  beforeEach(async () => {
    await resetTables(storePurchase, storeUserIdAlias, questHistory, quest, userVote, userData, gameSetting);
    await insertUsers([{ userId, username: "PurchaseProgress", role: "USER", rank: "JONIN", level: 50, primaryElement: "Fire", secondaryElement: "Water", status: "AWAKE", isOutlaw: true, regeneration: 0, money: 0, reputationPoints: 0, reputationPointsTotal: 0, updatedAt: new Date(), regenAt: new Date() }]);
    const db = await getTestDatabase();
    await db.insert(userVote).values({ id: "purchase-progress-vote", userId, secret: "payment1", lastVoteAt: new Date() });
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
});
