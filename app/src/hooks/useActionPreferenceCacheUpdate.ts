import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import { getActionPreferenceUserUpdate, type UserCache } from "@/deltas/profile";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";

/** Retain a confirmed action preference after existing profile reads, without starting a read. */
export const useActionPreferenceCacheUpdate = (
  client: QueryClient,
  key: QueryKey,
  userId: string | undefined,
) => {
  const controller = useMemo(() => {
    let releaseCurrent = () => {};
    const prepareUpdate = (input: { autoWakeUp?: boolean }) => {
      releaseCurrent();
      const query = client.getQueryCache().find({ queryKey: key, exact: true });
      let preference = (query?.state.data as UserCache | undefined)?.userData
        ?.autoWakeUp;
      let current =
        !!userId &&
        (query?.state.data as UserCache | undefined)?.userData?.userId === userId;
      // A newer local preference projection wins even if an older read later restores its baseline.
      const unsubscribe = client.getQueryCache().subscribe((event) => {
        if (event.query !== query) return;
        const next = (query?.state.data as UserCache | undefined)?.userData;
        if (next?.userId !== userId || event.type === "removed") current = false;
        if (event.type === "updated" && event.action.type === "success") {
          if (event.action.manual && next?.autoWakeUp !== preference) current = false;
          preference = next?.autoWakeUp;
        }
      });
      const release = () => {
        current = false;
        unsubscribe();
      };
      releaseCurrent = release;
      return { query, autoWakeUp: input.autoWakeUp, release, isCurrent: () => current };
    };
    const updateCache = async (
      result: RouterOutputs["profile"]["updatePreferences"],
      snapshot: ReturnType<typeof prepareUpdate> | undefined,
    ) => {
      if (
        !snapshot ||
        !result.success ||
        typeof snapshot.autoWakeUp !== "boolean" ||
        result.userPatch?.autoWakeUp !== snapshot.autoWakeUp
      )
        return false;
      const { query } = snapshot;
      // Waiting on the query promise preserves its reconciliation of unrelated profile fields.
      while (snapshot.isCurrent() && query?.state.fetchStatus !== "idle") {
        if (!query?.promise) return false;
        try {
          await query.promise;
        } catch {
          return false;
        }
      }
      if (
        !snapshot.isCurrent() ||
        !query ||
        client.getQueryCache().find({ queryKey: key, exact: true }) !== query
      )
        return false;
      const revision = prepareUserUpdate(client, key);
      return updateUserCache(
        client,
        key,
        (user) => getActionPreferenceUserUpdate(user, userId, snapshot.autoWakeUp),
        { revision, refetch: false },
      );
    };
    return { prepareUpdate, updateCache, dispose: () => releaseCurrent() };
  }, [client, key, userId]);
  useEffect(() => () => controller.dispose(), [controller]);
  return controller;
};
