import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import {
  applyResourceSiloClaim,
  applyResourceSiloEditorSave,
} from "@/deltas/resourceSilos";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { useRequiredUserData } from "@/utils/UserContext";

/** Bind shrine claims to their spawn and reconcile arbitrary package effects authoritatively. */
export const useResourceSilo = () => {
  const status = api.resourceSilos.getStatus.useQuery(undefined, {
    refetchInterval: 15000,
  });
  const cache = useQueryCacheUpdate<RouterOutputs["resourceSilos"]["getStatus"]>(
    getQueryKey(api.resourceSilos.getStatus, undefined, "query"),
  );
  const { prepareUserUpdate, updateUser } = useRequiredUserData();
  const { invalidateInventory } = useInventoryCacheUpdate();
  const claim = api.resourceSilos.claim.useMutation({
    onMutate: () => ({
      status: cache.prepareUpdate(),
      user: prepareUserUpdate(),
    }),
    onSuccess: async (result, _input, snapshot) => {
      if (!snapshot) return;
      const windowId = result.success ? result.windowId : undefined;
      await cache.updateCache(
        result.success && windowId
          ? (current) => applyResourceSiloClaim(current, windowId)
          : undefined,
        snapshot.status,
      );
      if (result.success) {
        // Packages may change membership, rank, mastery, equipment and collection-derived effects.
        await updateUser(undefined, { revision: snapshot.user });
        await invalidateInventory();
      }
    },
    onError: async (_error, _input, snapshot) => {
      if (!snapshot) return;
      await Promise.all([
        cache.updateCache(undefined, snapshot.status),
        updateUser(undefined, { revision: snapshot.user }),
        invalidateInventory(),
      ]);
    },
  });
  return { status, claim };
};

/** Centralize the staff catalog's exact cache key and confirmed saved snapshots. */
export const useResourceSiloEditor = (enabled: boolean) => {
  const editor = api.resourceSilos.getEditor.useQuery(undefined, { enabled });
  const cache = useQueryCacheUpdate<RouterOutputs["resourceSilos"]["getEditor"]>(
    getQueryKey(api.resourceSilos.getEditor, undefined, "query"),
  );
  const save = api.resourceSilos.save.useMutation({
    onMutate: cache.prepareUpdate,
    onSuccess: async (result, _input, snapshot) => {
      if (snapshot && result.success && result.entries)
        await cache.updateCache(
          (current) => applyResourceSiloEditorSave(current, result.entries),
          snapshot,
        );
    },
    onError: async (_error, _input, snapshot) => {
      if (snapshot) await cache.updateCache(undefined, snapshot);
    },
  });
  return { editor, save };
};

/** Refresh recovery and map context after a paid relocation or an uncertain response. */
export const useWarTornRevival = () => {
  const { prepareUserUpdate, updateUser } = useRequiredUserData();
  const utils = api.useUtils();
  return api.resourceSilos.respawn.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (result, _input, revision) => {
      if (!result.success) {
        await updateUser(undefined, { revision });
        return;
      }
      // Relocation changes structure access, effective pools and sector-derived profile data.
      await updateUser(undefined, { revision });
      await utils.travel.getSectorData.invalidate();
    },
    onError: async (_error, _input, revision) => {
      await updateUser(undefined, { revision });
    },
  });
};
