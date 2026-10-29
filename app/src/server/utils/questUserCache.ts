import type { UserData } from "@/drizzle/schema";
import { getPublicQuestUser } from "@/libs/quest";
import { listQuestTrackerDefinitions } from "@/queries/quests";
import type { DrizzleClient } from "@/server/db";

/** Mask committed location goals using definitions even when no history row exists. */
export const getPublicQuestTrackerPatch = async (
  client: DrizzleClient,
  user: Pick<UserData, "questData" | "sector" | "role">,
) => {
  const questIds = [
    ...new Set(
      user.questData
        ?.filter((entry) =>
          entry.goals.some(
            (goal) =>
              goal.sector !== undefined ||
              goal.longitude !== undefined ||
              goal.latitude !== undefined,
          ),
        )
        .map((entry) => entry.id) ?? [],
    ),
  ];
  // Tracker IDs include unclaimed achievements that have no persisted quest history.
  const definitions = questIds.length
    ? await listQuestTrackerDefinitions(client, questIds).catch(() => undefined)
    : [];
  // A failed privacy projection reconciles through the profile instead of publishing private goals.
  if (!definitions) return undefined;
  const objectiveIds = new Map(
    definitions.map((entry) => [
      entry.id,
      new Set(entry.content.objectives.map((objective) => objective.id)),
    ]),
  );
  const questData =
    user.questData?.map((entry) => ({
      ...entry,
      // Deleted definitions/objectives and raced assignments cannot establish public visibility.
      goals: entry.goals.map((goal) => {
        if (objectiveIds.get(entry.id)?.has(goal.id)) return goal;
        const {
          sector: _sector,
          longitude: _longitude,
          latitude: _latitude,
          ...publicGoal
        } = goal;
        return publicGoal;
      }),
    })) ?? user.questData;
  const publicUser = getPublicQuestUser({
    ...user,
    questData,
    userQuests: definitions.map((quest) => ({ quest })),
  });
  return { persistedQuestData: publicUser.questData };
};
