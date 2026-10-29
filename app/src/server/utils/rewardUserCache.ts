import type { GetRewardResult } from "@/libs/quest";
import { findRewardUserSnapshot } from "@/queries/quests";
import {
  fetchUpdatedUser,
  getUserProgressionUpdate,
} from "@/server/api/routers/profile";
import { getRewardUserDelta, type updateRewards } from "@/server/api/routers/quests";
import type { DrizzleClient } from "@/server/db";
import { withRequestScope } from "@/server/requestScope";
import { getMembershipUserPatch } from "@/server/utils/socialUserCache";

/** Confirm SQL-capped counters; hydrate derived relations only when the reward changes them. */
export const getRewardUserUpdate = async (input: {
  client: DrizzleClient;
  userId: string;
  rewards: GetRewardResult;
  granted: Pick<
    Awaited<ReturnType<typeof updateRewards>>,
    "titles" | "badges" | "sageModes"
  >;
  requiresRelations?: boolean;
  progression?: ReturnType<typeof getUserProgressionUpdate>;
}) => {
  const { client, userId, rewards, granted } = input;
  const fallback = {
    userPatch: undefined,
    userDelta: undefined,
    achievementProgress: undefined,
  };
  const needsRelations =
    input.requiresRelations ||
    getRewardUserDelta(rewards) === undefined ||
    granted.titles.length > 0 ||
    granted.badges.length > 0 ||
    granted.sageModes.length > 0;
  const hydrated = needsRelations
    ? await withRequestScope(() => fetchUpdatedUser({ client, userId }))
    : undefined;
  if (needsRelations && !hydrated?.user) return fallback;
  // Hydration can settle queued costs and rewards; reuse its confirmed counters.
  const counters = hydrated?.user
    ? {
        money: hydrated.user.money,
        seichiSilver: hydrated.user.seichiSilver,
        earnedExperience: hydrated.user.earnedExperience,
        petExperience: hydrated.user.petExperience,
        villagePrestige: hydrated.user.villagePrestige,
        reputationPoints: hydrated.user.reputationPoints,
        reputationPointsTotal: hydrated.user.reputationPointsTotal,
        skillPoints: hydrated.user.skillPoints,
        medicalExperience: hydrated.user.medicalExperience,
        huntingExperience: hydrated.user.huntingExperience,
        craftingExperience: hydrated.user.craftingExperience,
        gatheringExperience: hydrated.user.gatheringExperience,
        sageMasteryExperience: hydrated.user.sageMasteryExperience,
        ninjutsuMastery: hydrated.user.ninjutsuMastery,
        genjutsuMastery: hydrated.user.genjutsuMastery,
        taijutsuMastery: hydrated.user.taijutsuMastery,
        bukijutsuMastery: hydrated.user.bukijutsuMastery,
        bloodlineMastery: hydrated.user.bloodlineMastery,
        sageMastery: hydrated.user.sageMastery,
        masteryRanks: hydrated.user.masteryRanks,
        village: hydrated.user.village
          ? { id: hydrated.user.village.id, tokens: hydrated.user.village.tokens }
          : undefined,
      }
    : // Confirmation is optional cache data after the payout has committed.
      await findRewardUserSnapshot(client, userId).catch(() => undefined);
  if (!counters) return fallback;
  const needsMembership =
    hydrated?.user &&
    (rewards.reward_village_membership !== "NONE" ||
      rewards.reward_prestige < 0 ||
      hydrated.user.villageId !== (hydrated.user.village?.id ?? null));
  const membership = needsMembership
    ? await getMembershipUserPatch(client, hydrated.user)
    : undefined;
  if (needsMembership && !membership) return fallback;
  const progression = hydrated?.user
    ? getUserProgressionUpdate(hydrated.user, hydrated.publishedAchievementIds)
    : input.progression;
  return {
    userDelta: {},
    achievementProgress: progression?.achievementProgress,
    userPatch: hydrated?.user
      ? {
          ...progression?.userPatch,
          dungeonsCompleted: hydrated.user.dungeonsCompleted,
          raidsCompleted: hydrated.user.raidsCompleted,
          ...counters,
          village: hydrated.user.village,
          villageId: hydrated.user.villageId,
          isOutlaw: hydrated.user.isOutlaw,
          joinedVillageAt: hydrated.user.joinedVillageAt,
          clanId: hydrated.user.clanId,
          clan: hydrated.user.clan,
          anbuId: hydrated.user.anbuId,
          anbuSquad: hydrated.user.anbuSquad,
          titles: hydrated.user.titles,
          displayTitle: hydrated.user.displayTitle,
          sageModeId: hydrated.user.sageModeId,
          sageMode: hydrated.user.sageMode,
          raidBuffs: hydrated.user.raidBuffs,
          ...membership,
        }
      : counters
        ? {
            ...progression?.userPatch,
            ...counters,
            village: counters.village ?? undefined,
          }
        : undefined,
  };
};
