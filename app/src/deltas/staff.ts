import type { MasterySources } from "@/libs/mastery";
import { effectiveMasteries } from "@/libs/mastery";
import { calcMaxEnergy } from "@/libs/profile";
import type { fetchUser } from "@/queries/profile";

/**
 * Clear the active player loadout's jutsu IDs; AI accounts have no affected profile
 * projection.
 */
export const getUnequipAllJutsusUserUpdate = ({
  userIsAi,
  userJutsuLoadout,
}: {
  userIsAi: boolean;
  userJutsuLoadout: string | null;
}) => ({
  userPatch: userIsAi
    ? {}
    : { ...(userJutsuLoadout ? { loadout: { jutsuIds: [] } } : {}) },
});

/**
 * Clear player equipment and recompute mastery and energy limits from loaded sources. AI
 * profiles remain unchanged; missing player sources require reconciliation.
 */
export const getUnequipAllGearUserUpdate = ({
  user,
  sources,
}: {
  user: NonNullable<Awaited<ReturnType<typeof fetchUser>>>;
  sources: Required<MasterySources>;
}) => ({
  userPatch:
    !user.isAi && sources
      ? {
          items: [],
          effectiveMasteries: effectiveMasteries({
            ...user,
            ...sources,
            items: [],
          }),
          maxEnergy: calcMaxEnergy({ ...user, ...sources, items: [] }),
        }
      : user.isAi
        ? {}
        : undefined,
});

/**
 * Require a profile refresh when staff wake their own account; waking another account leaves
 * the caller unchanged.
 */
export const getForceAwakeUserUpdate = ({
  inputUserId,
  ctxUserId,
}: {
  inputUserId: string;
  ctxUserId: string;
}) => ({
  userPatch: inputUserId === ctxUserId ? undefined : {},
});

/**
 * Require reconciliation for village-linked identity changes; accounts without village
 * membership have no affected profile fields.
 */
export const getUpdateUserIdUserUpdate = ({
  userVillageId,
}: {
  userVillageId: string | null;
}) => ({
  userPatch: userVillageId ? undefined : {},
});
