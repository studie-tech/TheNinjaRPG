import { getUserProgressionUpdate } from "@/deltas/profile";

/**
 * Project restored stamina and chakra with public progression and the integer-rounded ryo
 * debit. Omit the update when progression requires a refresh.
 */
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
