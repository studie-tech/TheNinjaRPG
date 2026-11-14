import type { QueryClient, QueryKey } from "@tanstack/react-query";
import {
  applyUserChanges,
  applyUserRecoveryActivity,
  type UserCache,
  type UserPatch,
  type UserUpdate,
  type UserUpdateOptions,
} from "@/deltas/profile";
import type { NavBarDropdownLink } from "@/libs/menus";
import { prepareQueryUpdate, updateQueryCache } from "@/utils/queryCache";

/** Apply notification changes to the latest profile, preserving unrelated profile reconciliation. */
export const updateUserNotifications = (
  client: QueryClient,
  key: QueryKey,
  update: (
    current: NavBarDropdownLink[] | undefined,
  ) => NavBarDropdownLink[] | undefined,
) =>
  updateQueryCache<UserCache>(client, key, (old) => {
    const notifications = update(old.notifications) ?? old.notifications;
    return notifications === old.notifications ? old : { ...old, notifications };
  });

/** Capture a settled profile revision; undefined requires mutation reconciliation. */
export const prepareUserUpdate = (client: QueryClient, key: QueryKey) =>
  prepareQueryUpdate<UserCache>(client, key, (cache) => !!cache.userData);

/** Reconcile the profile and report whether related caches can rely on a local projection.
 * Never rejects: the QueryClient swallows cancellation and refetch errors, so patch callbacks
 * must not throw.
 */
export const updateUserCache = async (
  client: QueryClient,
  key: QueryKey,
  update: UserUpdate | undefined,
  mutation?: UserUpdateOptions,
): Promise<boolean> => {
  let patch: UserPatch | undefined;
  const response =
    update &&
    typeof update !== "function" &&
    "success" in update &&
    typeof update.success === "boolean"
      ? update
      : undefined;
  if (response) {
    patch = response.userPatch;
    mutation = {
      ...mutation,
      revision: mutation?.revision,
      userRecovery: response.userRecovery ?? mutation?.userRecovery,
      // An explicitly withheld delta must keep authoritative recovery even with a patch.
      ...("userDelta" in response ? { delta: response.userDelta } : {}),
      expected: response.userExpected ?? mutation?.expected,
      achievementProgress:
        response.achievementProgress ?? mutation?.achievementProgress,
      userNotifications: response.userNotifications ?? mutation?.userNotifications,
    };
  } else patch = update as UserPatch | undefined;

  // Recovery extends existing actions without creating new profile reads on conflicts or unknown effects.
  if (mutation?.userRecovery) mutation = { ...mutation, refetch: false };

  const delta =
    mutation && "delta" in mutation
      ? mutation.delta
      : patch === undefined
        ? undefined
        : {};
  // Confirmed no-ops leave in-flight reconciliation and other mutations' revisions intact.
  if (
    response &&
    delta !== undefined &&
    Object.keys(delta).length === 0 &&
    !Object.keys(patch ?? {}).length &&
    mutation?.achievementProgress === undefined &&
    !mutation?.expected &&
    !mutation?.expectedAfter &&
    !mutation?.userNotifications &&
    !mutation?.notifications &&
    !mutation?.userRecovery
  )
    return false;
  let complete = false;
  const applied = await updateQueryCache<UserCache>(
    client,
    key,
    delta === undefined && !mutation?.userRecovery?.activity
      ? undefined
      : (current) => {
          const next =
            delta === undefined
              ? undefined
              : applyUserChanges(current, patch, delta, mutation);
          complete = next !== undefined && !mutation?.userRecovery?.requiresUserRefresh;
          return next ?? applyUserRecoveryActivity(current, mutation?.userRecovery);
        },
    mutation,
  );
  // Known recovery fields may apply while unmodelled effects remain for ordinary refreshes.
  return applied && complete;
};
