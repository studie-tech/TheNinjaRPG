import type { UserData } from "@/drizzle/schema";

/**
 * Columns allowed when `fetchUpdatedUser` persists passive regeneration to the database.
 *
 * Economy scalars (money, bank, gathering XP, reputation, etc.) and village state are omitted so
 * a stale in-memory snapshot cannot overwrite concurrent rewards or membership changes.
 * Village transitions persist their own guarded updates before changing the in-memory user.
 *
 * The caller writes this through `claimUserSnapshot`, whose `updatedAt` CAS rejects a stale
 * snapshot, and removes `updatedAt` from the result so the claim timestamp is written instead.
 *
 * `userIp` is passed only for the requesting player's own session, so it also records
 * `lastActiveAt`, the activity signal recruitment analytics use for drop-off.
 */
export const buildDerivedUserRegenUpdate = (props: {
  user: Pick<
    UserData,
    | "curHealth"
    | "curStamina"
    | "curChakra"
    | "curEnergy"
    | "maxEnergy"
    | "updatedAt"
    | "regenAt"
    | "questData"
    | "primaryElement"
    | "secondaryElement"
    | "status"
    | "travelFinishAt"
  >;
  userIp?: string;
}) => {
  const { user, userIp } = props;
  const derivedUserUpdate: Record<string, unknown> = {
    curHealth: user.curHealth,
    curStamina: user.curStamina,
    curChakra: user.curChakra,
    curEnergy: user.curEnergy,
    maxEnergy: user.maxEnergy,
    updatedAt: user.updatedAt,
    regenAt: user.regenAt,
    questData: user.questData,
    primaryElement: user.primaryElement,
    secondaryElement: user.secondaryElement,
    status: user.status,
    travelFinishAt: user.travelFinishAt,
    ...(userIp ? { lastIp: userIp, lastActiveAt: user.updatedAt } : {}),
  };

  return derivedUserUpdate;
};
