import { isAvailableUserQuests, mockAchievementHistoryEntries } from "@/libs/quest";
import { fetchAchievementCatalogue } from "@/queries/profile";
import { findPurchaseUserSnapshot } from "@/queries/purchases";
import {
  canBootstrapQuestType,
  fetchQuestBootstrap,
} from "@/server/api/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { withRequestScope } from "@/server/requestScope";
import type { UserDeltaResponse } from "@/validators/userCache";

/**
 * Confirm delivered purchase balances with bounded reads. Reputation-dependent
 * progression and pending feedback reconcile through the canonical profile query.
 */
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
    const fallback = {
      userPatch: undefined,
      userDelta: undefined,
      achievementProgress: undefined,
    };
    const confirmation = await Promise.all([
      findPurchaseUserSnapshot(client, userId),
      fetchAchievementCatalogue(client),
      fetchQuestBootstrap(client, userId),
      // These reads only confirm a delivery; progression is settled by the profile.
    ]).catch(() => undefined);
    if (!confirmation?.[0]) return fallback;
    const [saved, achievements, bootstrap] = confirmation;
    // Canonical profile reads deliver these messages and clear their durable counters.
    if (saved.unreadNotifications || saved.unreadRecruitRewards) return fallback;
    const candidates = saved
      ? [
          ...saved.userQuests.filter((entry) => entry.quest),
          ...mockAchievementHistoryEntries(achievements, saved),
        ]
      : [];
    const available = saved
      ? candidates.filter(
          (entry) =>
            isAvailableUserQuests({ ...entry.quest, ...entry }, saved, true).check,
        )
      : [];
    const needsProgression =
      saved &&
      (available.some((entry) =>
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
        ));
    if (needsProgression) return fallback;
    return {
      userPatch: saved
        ? {
            money: saved.money,
            reputationPoints: saved.reputationPoints,
            reputationPointsTotal: saved.reputationPointsTotal,
            federalStatus: saved.federalStatus,
          }
        : undefined,
      userDelta: {},
    };
  });
