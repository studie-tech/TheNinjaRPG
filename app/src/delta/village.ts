import { getUserProgressionUpdate } from "@/delta/profile";

export const getBuyFoodUserUpdate = ({
  user,
  newStamina,
  newChakra,
  cost,
  requiresProgressionRefresh,
  publishedAchievementIds,
}: {
  user: Parameters<typeof getUserProgressionUpdate>[0];
  newStamina: number;
  newChakra: number;
  cost: number;
  requiresProgressionRefresh: boolean;
  publishedAchievementIds: readonly string[];
}) =>
  requiresProgressionRefresh
    ? {}
    : {
        ...getUserProgressionUpdate(
          { ...user, curStamina: newStamina, curChakra: newChakra },
          publishedAchievementIds,
        ),
        // MySQL rounds the remaining nonnegative integer balance, including half ryo.
        userDelta: { money: Math.round(user.money - cost) - user.money },
      };
