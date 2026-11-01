import { getUserProgressionUpdate } from "@/delta/profile";
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
