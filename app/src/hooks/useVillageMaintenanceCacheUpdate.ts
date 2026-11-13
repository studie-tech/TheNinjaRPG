import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import {
  getPaidStructureMaintenance,
  getStructureMaintenanceOwnerPatch,
} from "@/deltas/kage";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

/** Reconcile an exact paid maintenance bill in the initiating village and profile caches. */
export const useVillageMaintenanceCacheUpdate = (villageId: string) => {
  const { data, prepareUserUpdate, updateUser } = useRequiredUserDataSelector((u) => ({
    userId: u.userId,
  }));
  const village = useQueryCacheUpdate<RouterOutputs["village"]["get"]>(
    getQueryKey(api.village.get, { id: villageId }, "query"),
  );
  /** Pin the initiating village, actor and cache revisions before payment. */
  const prepareMaintenanceUpdate = () => ({
    village: village.prepareUpdate(),
    villageId,
    ownerId: data?.userId,
    user: prepareUserUpdate(),
  });
  /** Unknown outcomes and rejected bills recover both captured caches without inventing a debit. */
  const updateMaintenance = async (
    result: RouterOutputs["kage"]["payStructureMaintenance"] | undefined,
    paid: number,
    snapshot: ReturnType<typeof prepareMaintenanceUpdate>,
  ) => {
    const known =
      !!snapshot.ownerId &&
      data?.userId === snapshot.ownerId &&
      result?.success &&
      result.userDelta?.village?.id === snapshot.villageId &&
      result.userDelta.village.tokens === -paid &&
      result.userPatch?.village?.id === snapshot.villageId &&
      result.userPatch.village.structureMaintenanceDue === 0;
    await Promise.all([
      village.updateCache(
        known
          ? (current) =>
              getPaidStructureMaintenance(
                current,
                snapshot.villageId,
                paid,
                snapshot.ownerId,
              )
          : undefined,
        snapshot.village,
      ),
      known
        ? updateUser(
            (user) =>
              getStructureMaintenanceOwnerPatch(
                user,
                snapshot.ownerId,
                snapshot.villageId,
                paid,
              ),
            { revision: snapshot.user, delta: result.userDelta },
          )
        : updateUser(undefined, { revision: snapshot.user }),
    ]);
  };
  return { prepareMaintenanceUpdate, updateMaintenance };
};
