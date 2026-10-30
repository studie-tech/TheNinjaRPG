import { isAvailableUserQuests, mockAchievementHistoryEntries } from "@/libs/quest";
import { fetchAchievementCatalogue } from "@/queries/profile";
import { findPurchaseUserSnapshot } from "@/queries/purchases";
import {
  canBootstrapQuestType,
  fetchQuestBootstrap,
} from "@/server/api/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { withRequestScope } from "@/server/requestScope";
import type {
  UserCachePatch,
  UserDelta,
  UserDeltaResponse,
} from "@/validators/userCache";

/** Independent eligibility sources shared by mutation opening reads and webhook recovery. */
export const fetchPurchaseUserCacheInputs = (client: DrizzleClient, userId: string) =>
  Promise.all([
    findPurchaseUserSnapshot(client, userId),
    fetchAchievementCatalogue(client).catch(() => undefined),
    fetchQuestBootstrap(client, userId).catch(() => undefined),
  ]);

type PurchaseUserCacheInputs = Awaited<ReturnType<typeof fetchPurchaseUserCacheInputs>>;

/** Known credits and debits preserve arithmetic writes without confirming balances again. */
export const getKnownPurchaseUserUpdate = (
  inputs: PurchaseUserCacheInputs | undefined,
  userPatch: UserCachePatch,
  userDelta: UserDelta,
): Pick<UserDeltaResponse, "userPatch" | "userDelta"> => {
  if (!inputs?.[0] || !inputs[1] || !inputs[2]) return {};
  const [before, achievements, bootstrap] = inputs;
  const saved = {
    ...before,
    federalStatus: userPatch.federalStatus ?? before.federalStatus,
    reputationPoints: before.reputationPoints + (userDelta.reputationPoints ?? 0),
    reputationPointsTotal:
      before.reputationPointsTotal + (userDelta.reputationPointsTotal ?? 0),
  };
  // Canonical profile reads deliver pending feedback and settle reputation progression.
  if (saved.unreadNotifications || saved.unreadRecruitRewards) return {};
  const available = [
    ...saved.userQuests.filter((entry) => entry.quest),
    ...mockAchievementHistoryEntries(achievements, saved),
  ].filter(
    (entry) => isAvailableUserQuests({ ...entry.quest, ...entry }, saved, true).check,
  );
  if (
    available.some((entry) =>
      entry.quest.content.objectives.some(
        (objective) =>
          objective.task === "reputation_points" &&
          !saved.questData
            ?.find((tracker) => tracker.id === entry.questId)
            ?.goals.find((goal) => goal.id === objective.id)?.done,
      ),
    ) ||
    (["tier", "exam"] as const).some(
      (questType) =>
        !available.some((entry) => entry.questType === questType) &&
        canBootstrapQuestType(bootstrap, questType, saved.level),
    )
  )
    return {};
  return { userPatch, userDelta };
};

/** Read-only recovery observes asynchronous deliveries without settling profile progression. */
export const getPurchaseUserUpdate = (
  client: DrizzleClient,
  userId: string,
): Promise<
  Pick<
    UserDeltaResponse,
    "userPatch" | "userDelta" | "achievementProgress" | "announcements"
  >
> =>
  withRequestScope(async () => {
    const inputs = await fetchPurchaseUserCacheInputs(client, userId).catch(
      () => undefined,
    );
    const saved = inputs?.[0];
    return getKnownPurchaseUserUpdate(
      inputs,
      saved
        ? {
            money: saved.money,
            reputationPoints: saved.reputationPoints,
            reputationPointsTotal: saved.reputationPointsTotal,
            federalStatus: saved.federalStatus,
          }
        : {},
      {},
    );
  });
