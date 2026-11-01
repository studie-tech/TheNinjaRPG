import { canBootstrapQuestType } from "@/deltas/profile";
import { BLOODLINE_COST } from "@/drizzle/constants";
import type { Bloodline, GameSetting } from "@/drizzle/schema";
import { effectiveMasteries, type MasteryBuffUser } from "@/libs/mastery";
import { calcActiveUserRegen, calcMaxEnergy } from "@/libs/profile";
import { getUserQuests, mockAchievementHistoryEntries } from "@/libs/quest";
import type { fetchBloodlineProgressionUser } from "@/queries/bloodline";
import type { fetchAchievementCatalogue } from "@/queries/profile";
import type { fetchQuestBootstrap } from "@/routers/profile";

/**
 * Project a first bloodline acquisition and its passive values from loaded progression
 * sources. Return undefined when live Bloodright refunds, quest eligibility, collection
 * progress or quest bootstrap need a canonical profile read.
 */
export const bloodlineCachePatch = (
  user: NonNullable<Awaited<ReturnType<typeof fetchBloodlineProgressionUser>>>,
  line: Bloodline | null,
  settings: Parameters<typeof getBloodlinePassivePatch>[2],
  progression: {
    questBootstrap: Awaited<ReturnType<typeof fetchQuestBootstrap>>;
    achievements?: Awaited<ReturnType<typeof fetchAchievementCatalogue>>;
  },
  updatedAt?: Date,
) => {
  // Existing lineage can have concurrent Bloodright purchases refunded at live prices.
  if (user.bloodlineId) return undefined;
  const questUser = {
    ...user,
    userQuests: [...user.userQuests],
  };
  questUser.userQuests.push(
    ...mockAchievementHistoryEntries(progression.achievements ?? [], questUser),
  );
  const activeQuestIds = new Set(getUserQuests(questUser).map((quest) => quest.id));
  questUser.bloodlineId = line?.id ?? null;
  const quests = getUserQuests(questUser);
  const hasQuestEligibilityChange =
    activeQuestIds.size !== quests.length ||
    quests.some((quest) => !activeQuestIds.has(quest.id));
  // Only acquisition changes the roll history that drives collection objectives.
  const needsCollectionProgression =
    line !== null &&
    progression.achievements !== undefined &&
    quests.some((quest) =>
      quest.content.objectives.some(
        (objective) =>
          objective.task === "bloodline_collection" &&
          objective.bloodlineRanks.includes(line.rank) &&
          !user.questData
            ?.find((tracker) => tracker.id === quest.id)
            ?.goals.find((goal) => goal.id === objective.id)?.done,
      ),
    );
  const needsQuestBootstrap = (["tier", "exam"] as const).some(
    (type) =>
      !quests.some((quest) => quest.questType === type) &&
      canBootstrapQuestType(progression.questBootstrap, type, user.level),
  );
  // The canonical read owns collection receipts, quest admission and tracker retirement.
  if (hasQuestEligibilityChange || needsCollectionProgression || needsQuestBootstrap)
    return undefined;
  return {
    ...getBloodlinePassivePatch(user, line, settings),
    bloodright: [],
    bloodrightSpent: 0,
    ...(updatedAt ? { updatedAt, bloodlineReskinId: null, activeReskin: null } : {}),
  };
};

/**
 * Wrap a confirmed bloodline roll in its safe acquisition patch; unsafe progression leaves
 * the patch undefined.
 */
export const getRollUserUpdate = ({
  user,
  randomBloodline,
  settings,
  progression,
}: {
  user: NonNullable<Awaited<ReturnType<typeof fetchBloodlineProgressionUser>>>;
  randomBloodline: Bloodline;
  settings: {
    id: string;
    name: string;
    value: number;
    time: Date;
  }[];
  progression: Parameters<typeof bloodlineCachePatch>[3];
}) => ({
  userPatch: bloodlineCachePatch(user, randomBloodline, settings, progression),
});

/**
 * Project a confirmed pity roll with its saved revision and cleared reskin. Unsafe
 * acquisition progression leaves the patch undefined.
 */
export const getPityRollUserUpdate = ({
  user,
  randomBloodline,
  settings,
  progression,
  grantedAt,
}: {
  user: NonNullable<Awaited<ReturnType<typeof fetchBloodlineProgressionUser>>>;
  randomBloodline: Bloodline;
  settings: {
    id: string;
    name: string;
    value: number;
    time: Date;
  }[];
  progression: Parameters<typeof bloodlineCachePatch>[3];
  grantedAt: Date;
}) => ({
  userPatch: bloodlineCachePatch(
    user,
    randomBloodline,
    settings,
    progression,
    grantedAt,
  ),
});

/**
 * Pair a safe acquisition patch with the rank-based reputation debit; withhold both when
 * acquisition needs reconciliation.
 */
export const getPurchaseBloodlineUserUpdate = ({
  patch,
  lineRank,
}: {
  patch: ReturnType<typeof bloodlineCachePatch>;
  lineRank: "D" | "C" | "B" | "A" | "S" | "H";
}) => ({
  userPatch: patch,
  userDelta: patch ? { reputationPoints: -BLOODLINE_COST[lineRank] } : undefined,
});

/** Derive passive values from the saved base rate and the confirmed bloodline. */
export const getBloodlinePassivePatch = (
  user: Parameters<typeof calcActiveUserRegen>[0] & MasteryBuffUser,
  bloodline: Bloodline | null,
  settings: GameSetting[],
) => {
  const changed = { ...user, bloodlineId: bloodline?.id ?? null, bloodline };
  return {
    bloodlineId: changed.bloodlineId,
    bloodline,
    effectiveMasteries: effectiveMasteries(changed),
    maxEnergy: calcMaxEnergy(changed),
    regeneration: calcActiveUserRegen(changed, settings),
    regenerationWithoutTimedBuffs: calcActiveUserRegen(changed, settings, false),
  };
};
