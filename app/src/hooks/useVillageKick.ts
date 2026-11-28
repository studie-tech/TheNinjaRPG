import { api } from "@/app/_trpc/client";
import { KAGE_KICK_COOLDOWN_DAYS } from "@/drizzle/constants";
import { showMutationToast } from "@/libs/toast";
import { useUserDataSelector } from "@/utils/UserContext";

/** Bind expulsion controls to the current Kage and refresh the affected membership list. */
export const useVillageKick = (villageId: string) => {
  const {
    data: user,
    prepareUserUpdate,
    updateUser,
  } = useUserDataSelector((u) => ({
    userId: u.userId,
    villageId: u.villageId,
    isOutlaw: u.isOutlaw,
    kageId: u.village?.kageId,
    lastKageKickAt: u.lastKageKickAt,
  }));
  const utils = api.useUtils();
  const mutation = api.village.kickMember.useMutation({
    onMutate: () => ({ user: prepareUserUpdate(), villageId }),
    onSuccess: async (result, _input, snapshot) => {
      showMutationToast(result);
      if (result.success) {
        await Promise.all([
          updateUser(result, { revision: snapshot.user }),
          utils.profile.getPublicUsers.invalidate({ village: snapshot.villageId }),
        ]);
      }
    },
    onError: async (_error, _input, snapshot) => {
      // An unconfirmed response may follow a committed expulsion and consumed cooldown.
      if (snapshot) {
        await Promise.all([
          updateUser(undefined, { revision: snapshot.user }),
          utils.profile.getPublicUsers.invalidate({ village: snapshot.villageId }),
        ]);
      }
    },
  });
  const lastKick = user?.lastKageKickAt;
  return {
    ...mutation,
    canKick:
      !!user &&
      !user.isOutlaw &&
      user.villageId === villageId &&
      user.kageId === user.userId,
    actorId: user?.userId,
    availableAt: lastKick
      ? new Date(new Date(lastKick).getTime() + KAGE_KICK_COOLDOWN_DAYS * 86400000)
      : null,
  };
};
