import type { UserData } from "@/drizzle/schema";

/**
 * Columns allowed when `fetchUpdatedUser` persists passive regeneration to the database.
 *
 * Economy scalars (money, bank, gathering XP, reputation, etc.) are intentionally omitted so a
 * stale in-memory snapshot cannot overwrite rewards from concurrent mutations.
 *
 * When `includeVillageState` is true — used for `forceRegen` or (with outlaws) negative prestige —
 * village-bound fields are included; `fetchUpdatedUser` re-reads those columns from the DB first
 * so a stale in-memory snapshot cannot overwrite concurrent village mutations.
 *
 * Every column here must carry an absolute value. The caller re-issues this UPDATE when a pooled
 * PlanetScale connection drops, which a `sql` increment would turn into a double-apply.
 */
export const buildDerivedUserRegenUpdate = (props: {
  user: Pick<
    UserData,
    | "curHealth"
    | "curStamina"
    | "curChakra"
    | "updatedAt"
    | "regenAt"
    | "questData"
    | "primaryElement"
    | "secondaryElement"
    | "status"
    | "travelFinishAt"
    | "villagePrestige"
    | "villageId"
    | "isOutlaw"
  >;
  userIp?: string;
  includeVillageState?: boolean;
}) => {
  const { user, userIp, includeVillageState = false } = props;
  // When true, villagePrestige / villageId / isOutlaw are written (see fetchUpdatedUser negative-prestige kick is separate).
  const derivedUserUpdate: Record<string, unknown> = {
    curHealth: user.curHealth,
    curStamina: user.curStamina,
    curChakra: user.curChakra,
    updatedAt: user.updatedAt,
    regenAt: user.regenAt,
    questData: user.questData,
    primaryElement: user.primaryElement,
    secondaryElement: user.secondaryElement,
    status: user.status,
    travelFinishAt: user.travelFinishAt,
    ...(userIp ? { lastIp: userIp } : {}),
  };

  if (includeVillageState) {
    derivedUserUpdate.villagePrestige = user.villagePrestige;
    derivedUserUpdate.villageId = user.villageId;
    derivedUserUpdate.isOutlaw = user.isOutlaw;
  }

  return derivedUserUpdate;
};
