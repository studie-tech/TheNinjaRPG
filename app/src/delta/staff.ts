import type { MasterySources } from "@/libs/mastery";
import { effectiveMasteries } from "@/libs/mastery";
import { calcMaxEnergy } from "@/libs/profile";
import type { fetchUser } from "@/queries/profile";

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

export const getForceAwakeUserUpdate = ({
  inputUserId,
  ctxUserId,
}: {
  inputUserId: string;
  ctxUserId: string;
}) => ({
  userPatch: inputUserId === ctxUserId ? undefined : {},
});

export const getUpdateUserIdUserUpdate = ({
  userVillageId,
}: {
  userVillageId: string | null;
}) => ({
  userPatch: userVillageId ? undefined : {},
});
