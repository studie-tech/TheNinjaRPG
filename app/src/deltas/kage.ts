import type { RouterOutputs } from "@/app/_trpc/client";
import type { UserWithRelations } from "@/server/api/routers/profile";

/** Check-in changes attendance only; readiness carries any confirmed character recovery. */
export const getKageDefenseCheckInUserUpdate = () => ({
  userPatch: {},
  userDelta: {},
});

/**
 * Project the saved village leader, revision and cleared schedule. A nominated caller moving
 * from elder leadership receives the confirmed Jonin rank.
 */
export const getNominateKageUserUpdate = ({
  inputVillageId,
  candidateUserId,
  leaderUpdatedAt,
  ctxUserId,
  candidateRank,
}: {
  inputVillageId: string;
  candidateUserId: string;
  leaderUpdatedAt: Date;
  ctxUserId: string;
  candidateRank:
    | "NONE"
    | "STUDENT"
    | "GENIN"
    | "CHUNIN"
    | "JONIN"
    | "ELITE JONIN"
    | "ELDER";
}) => ({
  userPatch: {
    village: {
      id: inputVillageId,
      kageId: candidateUserId,
      leaderUpdatedAt,
      kageSchedule: null,
    },
    ...(candidateUserId === ctxUserId && candidateRank === "ELDER"
      ? { rank: "JONIN" as const }
      : {}),
  },
});

/** Debit exactly the bill claimed by the guarded maintenance write and clear that bill. */
export const getStructureMaintenanceUserUpdate = (villageId: string, paid: number) => ({
  userDelta: { village: { id: villageId, tokens: -paid } },
  userPatch: { village: { id: villageId, structureMaintenanceDue: 0 } },
});

/** Preserve village detail relations while reconciling a matching displayed maintenance bill. */
export const getPaidStructureMaintenance = (
  current: RouterOutputs["village"]["get"],
  villageId: string,
  paid: number,
  ownerId: string | undefined,
): RouterOutputs["village"]["get"] | undefined => {
  const village = current?.villageData;
  if (
    !ownerId ||
    village?.id !== villageId ||
    village.kageId !== ownerId ||
    village.structureMaintenanceDue !== paid ||
    village.tokens < paid
  )
    return;
  return {
    ...current,
    villageData: {
      ...village,
      tokens: village.tokens - paid,
      structureMaintenanceDue: 0,
    },
  };
};

/** Refuse a profile debit after an account switch or a different nested village bill. */
export const getStructureMaintenanceOwnerPatch = (
  user: NonNullable<UserWithRelations>,
  ownerId: string | undefined,
  villageId: string,
  paid: number,
) => {
  if (
    user.userId !== ownerId ||
    user.village?.id !== villageId ||
    user.village.kageId !== ownerId ||
    user.village.structureMaintenanceDue !== paid ||
    user.village.tokens < paid
  )
    return;
  return getStructureMaintenanceUserUpdate(villageId, paid).userPatch;
};
