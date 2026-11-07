import type { Quest, UserData } from "@/drizzle/schema";
import type { UserWithRelations } from "@/routers/profile";
import { canChangeContent } from "@/utils/permissions";

/** Projects private quest state for client responses without changing server-owned trackers. */
export const getPublicQuestUser = <
  T extends Pick<UserData, "questData" | "sector" | "role"> & {
    userQuests: { quest?: Pick<Quest, "id" | "content"> | null }[];
    questParty?: unknown;
  },
>(
  user: T,
): T => {
  const responseUser = {
    ...user,
    userQuests: structuredClone(user.userQuests),
    questData: structuredClone(user.questData),
  };
  // Party members' private trackers and invitation lists are never part of profile responses.
  delete responseUser.questParty;
  responseUser.userQuests.forEach((entry) => {
    controlShownQuestLocationInformation(entry.quest, responseUser);
  });
  return responseUser;
};

/**
 * Hides the location information of quest objectives if certain conditions are met.
 *
 * @param quest - The quest object containing objectives.
 * @param user - Optional user data to check against objective sectors.
 *
 * This function iterates over each objective in the quest's content. If an objective has the
 * `hideLocation` property set to true and the user's sector does not match the objective's sector,
 * it will obfuscate the objective's location by setting its latitude, longitude, and sector to 1337.
 */
export const controlShownQuestLocationInformation = (
  quest?: Pick<Quest, "id" | "content"> | null,
  user?: Pick<UserData, "questData" | "sector" | "role">,
) => {
  const tracker = user?.questData?.find((q) => q.id === quest?.id);
  quest?.content.objectives.forEach((objective) => {
    // If we have a tracker which specifies the location, use that (e.g. from random sectors etc)
    const status = tracker?.goals.find((goal) => goal.id === objective.id);
    if (tracker && status) {
      if ("sector" in status) {
        objective.sector = status.sector;
      }
      if ("longitude" in status && status.longitude !== undefined) {
        objective.longitude = status.longitude;
      }
      if ("latitude" in status && status.latitude !== undefined) {
        objective.latitude = status.latitude;
      }
    }

    // If we should hide the location, hide it when the user is not in the sector
    if (
      "hideLocation" in objective &&
      objective.hideLocation &&
      user?.sector !== objective.sector &&
      !canChangeContent(user?.role || "USER")
    ) {
      if (status) {
        delete status.sector;
        delete status.longitude;
        delete status.latitude;
      }
      objective.latitude = 1337;
      objective.longitude = 1337;
      objective.sector = 1337;
      objective.sectorType = "specific";
      objective.sectorList = ["1337"];
      objective.locationType = "specific";
    }
  });
};

/** Project visible, unassigned achievements as initial history entries without persisting them. */
export const mockAchievementHistoryEntries = (
  achievements: Quest[],
  user: Pick<NonNullable<UserWithRelations>, "userId" | "role" | "userQuests">,
) => {
  return achievements
    .filter((q) => !q.hidden || canChangeContent(user.role))
    .filter((q) => !user.userQuests?.find((uq) => uq.questId === q.id))
    .map((a) => ({
      id: a.id,
      userId: user.userId,
      questId: a.id,
      questType: a.questType,
      completed: 0,
      previousCompletes: 0,
      previousAttempts: 0,
      periodCompletes: 0,
      periodStartAt: null,
      pendingRewardChoice: null,
      entryPaid: false,
      isolated: false,
      questVersion: null,
      quest: a,
      endAt: null,
      startedAt: new Date(),
      /** `id` is the quest id here (placeholder); real `QuestHistory.id` is a nanoid ≠ `questId`. */
    }));
};

/**
 * The achievements whose definitions `quests.getAchievementCatalogue` publishes for the client to
 * cache, and therefore exactly the ones `profile.getUser` may send as progress alone.
 *
 * Both sides read this one list, cut from the raw catalogue, rather than re-deciding on their own
 * copy: `fetchUpdatedUser` rewrites the objectives of its quests - trackers write resolved
 * coordinates back onto them, and location hiding rewrites them again - so a predicate applied
 * after that and one applied to the raw row can disagree, and a progress row whose definition the
 * catalogue withholds renders nothing at all.
 */
export const publishedAchievementsOf = <T extends Quest>(catalogue: T[]) =>
  catalogue.filter((achievement) => !questHasOverworldObjectives(achievement));

/**
 * Whether any of a quest's objectives is something the overworld has to draw or act on: a map
 * location, an ambush, a bound NPC placement, or a dialog. The sector view, the world map and
 * `getActiveObjectives` scan `userQuests[].quest.content.objectives` for exactly these.
 *
 * Achievements are lifetime counters and normally carry none of it, which is what lets
 * `quests.getAchievementCatalogue` publish them for the client to cache instead of `getUser`
 * re-sending them. An authored exception is withheld from the catalogue and keeps travelling on
 * the user object, so the overworld still sees it.
 *
 * A stored coordinate counts even when it is zero. Sector 0 is a real sector
 * (`MAP_SECTOR_ID_MIN`) and (0, 0) is a real tile, so the test is whether the objective carries
 * the field at all - a counter objective has no coordinate keys whatsoever. `attackers` and
 * `opponentAIs` are the other way round: nearly every objective serialises them as empty arrays,
 * so only a populated one means anything.
 */
export const questHasOverworldObjectives = (quest: Quest) =>
  quest.content.objectives.some(
    (objective) =>
      "sector" in objective ||
      "longitude" in objective ||
      "latitude" in objective ||
      "hideLocation" in objective ||
      ("overworldPlacementId" in objective && !!objective.overworldPlacementId) ||
      ("attackers" in objective && (objective.attackers?.length ?? 0) > 0) ||
      ("opponentAIs" in objective && (objective.opponentAIs?.length ?? 0) > 0) ||
      objective.task === "dialog",
  );
