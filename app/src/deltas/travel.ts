import type { RouterOutputs } from "@/app/_trpc/client";
import type { UserData } from "@/drizzle/schema";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import { getPublicQuestUser } from "@/libs/quest/projection";
import type { UserWithRelations } from "@/server/api/routers/profile";

/** Project confirmed robbery credits and faction counters when no live stealth roll can change the actor. */
export const getRobPlayerUserUpdate = ({
  user,
  stolenAmount,
  prestigeGain,
}: {
  user: Pick<UserData, "stealthActive" | "clanId">;
  stolenAmount: number;
  prestigeGain: number;
}) => ({
  userDelta: user.stealthActive
    ? undefined
    : {
        money: stolenAmount,
        villagePrestige: prestigeGain,
        ...(user.clanId
          ? { clan: { id: user.clanId, points: 1, activityPoints: 1 } }
          : {}),
      },
});

/**
 * Project awake arrival, cleared travel time and public quest trackers. Include the claimed
 * revision only after successful arrival ownership.
 */
export const getFinishGlobalMoveUserUpdate = ({
  claimSuccess,
  claimClaimedAt,
  arrival,
  trackers,
}: {
  claimSuccess: boolean;
  claimClaimedAt: Date;
  arrival: NonNullable<UserWithRelations>;
  trackers: NonNullable<UserData["questData"]>;
}) => {
  const publicArrival = getPublicQuestUser({ ...arrival, questData: trackers });
  return {
    userDelta: {},
    userPatch: {
      status: "AWAKE" as const,
      travelFinishAt: null,
      ...(claimSuccess ? { updatedAt: claimClaimedAt } : {}),
      userQuests: publicArrival.userQuests,
      questData: publicArrival.questData,
    },
  };
};

/**
 * Refresh only the loaded caller's public map row from an accepted profile update.
 * Unbound quest landmarks do not depend on the caller's tile. NPCs need an authoritative
 * refresh because movement patches postpone polling; bound placements and identity changes do too.
 */
export const getSectorUserUpdate = (
  current: RouterOutputs["travel"]["getSectorData"],
  user: UserWithRelations | undefined,
): RouterOutputs["travel"]["getSectorData"] | undefined => {
  if (current.sectorData === null) return;
  if (
    !user ||
    user.status !== "AWAKE" ||
    (current.sectorData && current.sectorData.sector !== user.sector) ||
    current.overworldAis?.length ||
    current.questPlacements?.length ||
    user.userQuests.some((entry) =>
      entry.quest.content.objectives.some(
        (objective) => objective.overworldPlacementId,
      ),
    )
  )
    return;
  const previous = current.users.find((row) => row.userId === user.userId);
  if (
    !previous ||
    previous.sector !== user.sector ||
    previous.isMasked ||
    previous.villageId !== user.villageId ||
    previous.anbuId !== user.anbuId ||
    previous.isOutlaw !== user.isOutlaw
  )
    return;
  return {
    ...current,
    users: current.users.map((row) =>
      row.userId !== user.userId
        ? row
        : {
            ...row,
            status: "AWAKE" as const,
            battleId: user.battleId,
            sector: user.sector,
            longitude: user.longitude,
            latitude: user.latitude,
            location: user.location,
            curHealth: user.curHealth,
            maxHealth: user.maxHealth,
            level: user.level,
            experience: user.experience,
            rank: user.rank,
            updatedAt: user.updatedAt,
            immunityUntil: user.immunityUntil,
            robImmunityUntil: user.robImmunityUntil,
            stealthActive: user.stealthActive,
            stealthActivatedAt: user.stealthActivatedAt,
            spriteAppearance: resolveSpriteAppearance(user),
          },
    ),
  };
};

/**
 * Add players who joined the sector after its snapshot, as the arrival read presents them,
 * replacing the stale row of a player who left and returned. Players already shown keep their
 * live map positions, so merging the snapshot moves nobody back.
 */
export const addSectorArrivals = (
  current: RouterOutputs["travel"]["getSectorData"],
  arrivals: RouterOutputs["travel"]["getSectorUsers"],
  positions: ReadonlyMap<string, { longitude: number; latitude: number }>,
): RouterOutputs["travel"]["getSectorData"] => {
  // A viewer who cannot scout has an empty snapshot, which no arrival changes.
  if (current.warData === null || arrivals.length === 0) return current;
  const arrived = new Map(arrivals.map((row) => [row.userId, row]));
  const users = current.users.map((row) => {
    const replacement = arrived.get(row.userId);
    if (replacement) {
      arrived.delete(row.userId);
      return replacement;
    }
    const live = positions.get(row.userId);
    return live && (live.longitude !== row.longitude || live.latitude !== row.latitude)
      ? { ...row, longitude: live.longitude, latitude: live.latitude }
      : row;
  });
  return { ...current, users: [...users, ...arrived.values()] };
};
