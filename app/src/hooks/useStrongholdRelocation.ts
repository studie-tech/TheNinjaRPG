import { api } from "@/app/_trpc/client";
import { useClanCacheUpdate } from "@/hooks/useClanCacheUpdate";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserInfo } from "@/utils/UserContext";

/** Reconcile a captured faction and sector-dependent profile after a stronghold moves. */
export const useStrongholdRelocation = (clanId: string) => {
  const utils = api.useUtils();
  const { prepareClanUpdate, updateClan } = useClanCacheUpdate(clanId);
  const { prepareUserUpdate, updateUser } = useRequiredUserInfo();
  const reconcile = async (snapshot: {
    clan: ReturnType<typeof prepareClanUpdate>;
    user: ReturnType<typeof prepareUserUpdate>;
  }) => {
    // Moving the settlement changes structure access and effective regeneration at both sectors.
    await Promise.all([
      updateClan(undefined, snapshot.clan),
      updateUser(undefined, { revision: snapshot.user }),
      utils.village.getAll.invalidate(),
      utils.village.get.invalidate(),
      utils.village.getSectorOwnerships.invalidate(),
      utils.travel.getSectorData.invalidate(),
      utils.travel.getVillageInSector.invalidate(),
      utils.worldMap.getSectorEntries.invalidate(),
      utils.worldMap.getSectorWindow.invalidate(),
      utils.tradeRoute.getRoutes.invalidate(),
      utils.caravan.getCaravans.invalidate(),
      utils.shrine.getCapturedSectors.invalidate(),
      utils.shrine.getSectorShrine.invalidate(),
    ]);
  };
  return api.clan.relocateStronghold.useMutation({
    onMutate: () => ({ clan: prepareClanUpdate(), user: prepareUserUpdate() }),
    onSuccess: async (result, _input, snapshot) => {
      showMutationToast(result);
      if (result.success && snapshot) await reconcile(snapshot);
    },
    onError: async (_error, _input, snapshot) => {
      if (snapshot) await reconcile(snapshot);
    },
  });
};
