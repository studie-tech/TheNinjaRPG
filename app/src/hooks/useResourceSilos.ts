import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import {
  applyResourceSiloClaim,
  applyResourceSiloEditorSave,
} from "@/deltas/resourceSilos";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";

/**
 * Bind claims to their captured actor and spawn, then reconcile arbitrary package effects.
 * Closed windows use bounded recovery polling; server-clock deadlines keep openings timely.
 */
export const useResourceSilo = () => {
  const utils = api.useUtils();
  const {
    data: userData,
    timeDiff,
    prepareUserUpdate,
    updateUser,
  } = useRequiredUserData();
  const status = api.resourceSilos.getStatus.useQuery(undefined, {
    // Active, failed and overdue snapshots need fast recovery; quiet closed windows do not.
    refetchInterval: (query) =>
      query.state.status !== "error" &&
      query.state.data?.window.active === false &&
      new Date(query.state.data.window.next).getTime() + timeDiff > Date.now()
        ? 5 * 60_000
        : 15_000,
    refetchIntervalInBackground: false,
    // The shared QueryClient has infinite freshness, so default focus recovery would skip these reads.
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  useRefreshAt(
    [status.data?.window.active ? status.data.window.end : status.data?.window.next],
    () => void status.refetch({ cancelRefetch: false }),
    timeDiff,
  );
  const cache = useQueryCacheUpdate<RouterOutputs["resourceSilos"]["getStatus"]>(
    getQueryKey(api.resourceSilos.getStatus, undefined, "query"),
  );
  const { invalidateInventory } = useInventoryCacheUpdate();
  /** Refresh ownership-dependent views for the actor captured before the mutation starts. */
  const reconcileOwnership = (userId: string | undefined) =>
    Promise.all([
      invalidateInventory(),
      utils.jutsu.getUserJutsus.invalidate(),
      utils.jutsu.getAll.invalidate({ ownedFirst: true }),
      utils.bloodline.getUserHistoricBloodlines.invalidate(),
      userId ? utils.profile.getPublicUser.invalidate({ userId }) : undefined,
    ]);
  const claim = api.resourceSilos.claim.useMutation({
    /** Keep ownership recovery bound to the initiating actor and cache revisions. */
    onMutate: () => ({
      status: cache.prepareUpdate(),
      user: prepareUserUpdate(),
      userId: userData?.userId,
    }),
    /** Settle the captured spawn, then reload package effects that cannot be inferred locally. */
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
        await reconcileOwnership(snapshot.userId);
      }
    },
    /** Recover uncertain delivery before refreshing ownership views changed by profile settlement. */
    onError: async (_error, _input, snapshot) => {
      if (!snapshot) return;
      await Promise.all([
        cache.updateCache(undefined, snapshot.status),
        updateUser(undefined, { revision: snapshot.user }),
      ]);
      // Profile recovery can finish collection quests and grant inventory items.
      await reconcileOwnership(snapshot.userId);
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
    /** Apply authoritative reward snapshots only to the captured editor revision. */
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
    /** Preserve confirmation across profile reconciliation and reload access after relocation. */
    onSuccess: async (result, _input, revision) => {
      showMutationToast(result);
      if (!result.success) {
        await updateUser(undefined, { revision });
        return;
      }
      // Relocation changes structure access, effective pools and sector-derived profile data.
      await updateUser(undefined, { revision });
      await utils.travel.getSectorData.invalidate();
    },
    /** Display a recoverable error and reconcile whether an uncertain revival already committed. */
    onError: async (error, _input, revision) => {
      showMutationToast({ success: false, message: error.message });
      await updateUser(undefined, { revision });
    },
  });
};
