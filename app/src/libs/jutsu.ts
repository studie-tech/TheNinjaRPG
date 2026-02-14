import type { FederalStatus } from "@/drizzle/constants";
import {
  JUTSU_TRANSFER_FREE_AMOUNT,
  JUTSU_TRANSFER_FREE_GOLD,
  JUTSU_TRANSFER_FREE_NORMAL,
  JUTSU_TRANSFER_FREE_SILVER,
} from "@/drizzle/constants";
import type { UserJutsuWithRelations } from "@/drizzle/schema";

/**
 * Get the number of free jutsu level transfers based on the federal status
 * @param federalStatus
 * @returns
 */
export const getFreeTransfers = (federalStatus: FederalStatus) => {
  switch (federalStatus) {
    case "GOLD":
      return JUTSU_TRANSFER_FREE_GOLD;
    case "SILVER":
      return JUTSU_TRANSFER_FREE_SILVER;
    case "NORMAL":
      return JUTSU_TRANSFER_FREE_NORMAL;
    default:
      return JUTSU_TRANSFER_FREE_AMOUNT;
  }
};

/**
 * Get the reskinned user jutsu, generic version
 * @param userJutsu
 * @returns
 */
export const getReskinnedUserJutsu = <T extends UserJutsuWithRelations>(
  userJutsu: T,
): T => {
  if (!userJutsu.activeReskin) {
    return userJutsu;
  }
  return {
    ...userJutsu,
    jutsu: {
      ...userJutsu.jutsu,
      ...(userJutsu.activeReskin.name && { name: userJutsu.activeReskin.name }),
      ...(userJutsu.activeReskin.image && { image: userJutsu.activeReskin.image }),
      ...(userJutsu.activeReskin.description && {
        description: userJutsu.activeReskin.description,
      }),
      ...(userJutsu.activeReskin.battleDescription && {
        battleDescription: userJutsu.activeReskin.battleDescription,
      }),
    },
  } as T;
};
