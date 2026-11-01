import type { QueryClient, QueryKey } from "@tanstack/react-query";
import {
  applyUserChanges,
  type UserCache,
  type UserPatch,
  type UserUpdate,
  type UserUpdateOptions,
} from "@/deltas/profile";
import { prepareQueryUpdate, updateQueryCache } from "@/utils/queryCache";

/** Capture a settled profile revision; undefined requires mutation reconciliation. */
export const prepareUserUpdate = (client: QueryClient, key: QueryKey) =>
  prepareQueryUpdate<UserCache>(client, key, (cache) => !!cache.userData);

/** Reconcile the profile and report whether related caches can rely on a local projection. */
export const updateUserCache = async (
  client: QueryClient,
  key: QueryKey,
  update: UserUpdate | undefined,
  mutation?: UserUpdateOptions,
) => {
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
      // An explicitly withheld delta must keep authoritative recovery even with a patch.
      ...("userDelta" in response ? { delta: response.userDelta } : {}),
      expected: response.userExpected ?? mutation?.expected,
      achievementProgress:
        response.achievementProgress ?? mutation?.achievementProgress,
      userNotifications: response.userNotifications ?? mutation?.userNotifications,
    };
  } else patch = update as UserPatch | undefined;

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
    !mutation?.notifications
  )
    return false;
  return updateQueryCache<UserCache>(
    client,
    key,
    delta === undefined
      ? undefined
      : (current) => applyUserChanges(current, patch, delta, mutation),
    mutation,
  );
};
