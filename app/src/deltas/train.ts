import { getUserProgressionUpdate } from "@/deltas/profile";

/** Project the saved trained element and the account revision returned by its claim. */
export const getSelectTrainedElementUserUpdate = ({
  inputElement,
  resultClaimedAt,
}: {
  inputElement: "Fire" | "Water" | "Wind" | "Earth" | "Lightning" | null;
  resultClaimedAt: Date;
}) => ({
  userPatch: {
    activeTrainedElement: inputElement,
    updatedAt: resultClaimedAt,
  },
});

/**
 * Project the saved training queue and public progression from settled loaded state. Omit the
 * update when progression requires a refresh.
 */
export const getSavedTrainingQueueUserUpdate = ({
  user,
  saved,
  requiresProgressionRefresh,
  publishedAchievementIds,
}: {
  user: Parameters<typeof getUserProgressionUpdate>[0];
  saved: Partial<Parameters<typeof getUserProgressionUpdate>[0]>;
  requiresProgressionRefresh: boolean;
  publishedAchievementIds: readonly string[];
}) =>
  requiresProgressionRefresh
    ? {}
    : getUserProgressionUpdate({ ...user, ...saved }, publishedAchievementIds);
