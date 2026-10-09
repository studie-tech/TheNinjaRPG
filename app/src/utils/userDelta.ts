import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { UserWithRelations } from "@/server/api/routers/profile";
import type { UserDelta } from "@/validators/userCache";

type User = NonNullable<UserWithRelations>;
type UserCache = { userData?: User | null };
export type UserDeltaPatch =
  | Partial<User>
  | ((current: User) => Partial<User> | undefined);

export const prepareUserDelta = (client: QueryClient, key: QueryKey) => {
  // An action can render before the initial profile; leave that loading query running.
  // Pending or invalidated reads may reconcile another action, so keep those too.
  const state = client.getQueryState(key);
  if (
    !client.getQueryData<UserCache>(key)?.userData ||
    state?.isInvalidated ||
    state?.fetchStatus !== "idle"
  ) {
    return undefined;
  }
  return state.dataUpdateCount;
};

/** Apply confirmed changes only to the snapshot that preceded the mutation. */
export const applyUserDelta = async (
  client: QueryClient,
  key: QueryKey,
  delta: UserDelta | undefined,
  revision: number | undefined,
  patch?: UserDeltaPatch,
) => {
  if (delta === undefined || revision === undefined) {
    // Invalidation reuses an initial fetch without cached data. Cancel it first so
    // a snapshot taken before the mutation cannot satisfy this reconciliation.
    await client.cancelQueries({ queryKey: key, exact: true });
    await client.invalidateQueries({ queryKey: key, exact: true });
    return;
  }
  const wasFetching = client.getQueryState(key)?.fetchStatus !== "idle";
  await client.cancelQueries({ queryKey: key, exact: true });
  // Another action may have requested this unfinished read to reconcile its own changes.
  // Preserve that refresh instead of cancelling it and clearing the invalidation with a delta.
  if (wasFetching) {
    await client.invalidateQueries({ queryKey: key, exact: true });
    return;
  }
  let applied = false;
  client.setQueryData<UserCache>(key, (old) => {
    // A completed refetch or another absolute patch may already include this debit.
    // Cancelling at success cannot undo that response; refresh rather than count it twice.
    const state = client.getQueryState(key);
    if (
      !old?.userData ||
      state?.dataUpdateCount !== revision ||
      state.isInvalidated ||
      state.fetchStatus !== "idle"
    ) {
      return undefined;
    }
    const known = typeof patch === "function" ? patch(old.userData) : patch;
    if (patch && known === undefined) return undefined;
    const changes: Partial<User> = { ...known };
    for (const field of Object.keys(delta) as (keyof UserDelta)[]) {
      const amount = delta[field];
      if (amount !== undefined) changes[field] = old.userData[field] + amount;
    }
    applied = true;
    return { ...old, userData: { ...old.userData, ...changes } };
  });
  if (!applied) await client.invalidateQueries({ queryKey: key, exact: true });
};
