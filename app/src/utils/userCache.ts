import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { UserWithRelations } from "@/server/api/routers/profile";
import type { UserCachePatch, UserDelta } from "@/validators/userCache";

type User = NonNullable<UserWithRelations>;
type UserCache = { userData?: User | null };
type KnownUserPatch = Partial<User> | UserCachePatch;
export type UserPatch =
  | KnownUserPatch
  | ((current: User) => KnownUserPatch | undefined);

export const prepareUserUpdate = (client: QueryClient, key: QueryKey) => {
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

export type UserUpdateOptions = {
  revision: number | undefined;
  // Omit delta for a known patch; an explicitly missing server delta requires a refresh.
  delta?: UserDelta;
};

/** Merge local fields or reconcile a confirmed mutation against its captured revision. */
export const updateUserCache = async (
  client: QueryClient,
  key: QueryKey,
  patch: UserPatch | undefined,
  mutation?: UserUpdateOptions,
) => {
  if (!mutation) {
    if (!patch) return;
    const before = client.getQueryState(key);
    let needsRefresh = !!before?.isInvalidated || before?.fetchStatus !== "idle";
    await client.cancelQueries({ queryKey: key, exact: true });
    client.setQueryData<UserCache>(key, (old) => {
      const state = client.getQueryState(key);
      needsRefresh ||= !!state?.isInvalidated || state?.fetchStatus !== "idle";
      if (!old?.userData) return undefined;
      const known = typeof patch === "function" ? patch(old.userData) : patch;
      const changes = known && mergeUserRelations(old.userData, known);
      if (!changes) {
        needsRefresh = true;
        return undefined;
      }
      return { ...old, userData: { ...old.userData, ...changes } };
    });
    // A local patch must preserve reconciliation of unrelated fields.
    if (needsRefresh) await client.invalidateQueries({ queryKey: key, exact: true });
    return;
  }
  const { revision } = mutation;
  const delta =
    "delta" in mutation ? mutation.delta : patch === undefined ? undefined : {};
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
    const changes = known ? mergeUserRelations(old.userData, known) : {};
    if (!changes) return undefined;
    for (const field of Object.keys(delta) as (keyof UserDelta)[]) {
      const amount = delta[field];
      if (amount !== undefined) changes[field] = old.userData[field] + amount;
    }
    applied = true;
    return { ...old, userData: { ...old.userData, ...changes } };
  });
  if (!applied) await client.invalidateQueries({ queryKey: key, exact: true });
};

/** Relation projections must belong to the cached user and preserve omitted fields. */
const mergeUserRelations = (
  current: User,
  patch: KnownUserPatch,
): Partial<User> | undefined => {
  const { village, clan, ...fields } = patch;
  if (village && current.village?.id !== village.id) return undefined;
  if (clan && current.clan?.id !== clan.id) return undefined;
  const changes: Partial<User> = { ...fields };
  if (village && current.village) {
    const { shrineSettings, ...villageFields } = village;
    changes.village = { ...current.village, ...villageFields };
    if (shrineSettings) {
      changes.village.shrineSettings = {
        ...current.village.shrineSettings,
        ...shrineSettings,
        activeBoosts: {
          ...current.village.shrineSettings?.activeBoosts,
          ...shrineSettings.activeBoosts,
        },
      };
    }
  } else if (village === null) changes.village = null;
  if (clan && current.clan) changes.clan = { ...current.clan, ...clan };
  else if (clan === null) changes.clan = null;
  return changes;
};
