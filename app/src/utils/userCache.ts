import type { QueryClient, QueryKey } from "@tanstack/react-query";
import {
  MAX_SKILL_POINTS,
  MEDNIN_EXP_CAP,
  SAGE_MASTERY_EXP_CAP,
  UserRanks,
} from "@/drizzle/constants";
import type { NavBarDropdownLink } from "@/libs/menus";
import { canAssignExperience } from "@/libs/profile";
import type {
  AchievementProgress,
  UserWithRelations,
} from "@/server/api/routers/profile";
import type { UserCachePatch, UserDelta } from "@/validators/userCache";

type User = NonNullable<UserWithRelations>;
type UserCache = {
  userData?: User | null;
  achievementProgress?: AchievementProgress[];
  notifications?: NavBarDropdownLink[];
};
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
  achievementProgress?: AchievementProgress[];
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
      return mergeUserCache(old, { ...old.userData, ...changes });
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
    const { clan, village, ...fields } = delta;
    // Shared balances use the same captured revision as personal counters, and must
    // still belong to the cached relation before any part of the mutation is applied.
    if (clan) {
      if (old.userData.clan?.id !== clan.id) return undefined;
      changes.clan = {
        ...(changes.clan ?? old.userData.clan),
        ...(clan.bank === undefined
          ? {}
          : { bank: old.userData.clan.bank + clan.bank }),
        ...(clan.repTreasury === undefined
          ? {}
          : {
              repTreasury: old.userData.clan.repTreasury + clan.repTreasury,
            }),
      };
    }
    if (village) {
      if (old.userData.village?.id !== village.id) return undefined;
      changes.village = {
        ...(changes.village ?? old.userData.village),
        ...(village.tokens === undefined
          ? {}
          : {
              tokens: old.userData.village.tokens + village.tokens,
            }),
      };
    }
    for (const field of Object.keys(fields) as (keyof typeof fields)[]) {
      const amount = fields[field];
      if (amount !== undefined) {
        const cap =
          field === "skillPoints"
            ? MAX_SKILL_POINTS
            : field === "medicalExperience"
              ? MEDNIN_EXP_CAP
              : field === "sageMasteryExperience"
                ? SAGE_MASTERY_EXP_CAP
                : Infinity;
        changes[field] = Math.min(old.userData[field] + amount, cap);
      }
    }
    applied = true;
    return mergeUserCache(
      old,
      { ...old.userData, ...changes },
      mutation.achievementProgress,
    );
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

/** Keep navigation derived from profile fields in the same atomic cache update. */
const mergeUserCache = (
  old: UserCache,
  user: User,
  achievementProgress?: AchievementProgress[],
): UserCache => {
  const desired: NavBarDropdownLink[] = [];
  if (
    UserRanks.includes(user.rank) &&
    user.earnedExperience > 0 &&
    canAssignExperience(user)
  )
    desired.push({
      id: "tutorial-unassigned-stats",
      href: "/profile/experience",
      name: "Assign XP",
      color: "blue",
    });
  if (user.status === "BATTLE")
    desired.push({ href: "/combat", name: "In combat", color: "red" });
  if (user.status === "HOSPITALIZED")
    desired.push({ href: "/hospital", name: "In hospital", color: "red" });
  let notifications = old.notifications?.flatMap((entry) => {
    if (
      entry.id !== "tutorial-unassigned-stats" &&
      !["Assign XP", "In combat", "In hospital"].includes(entry.name)
    )
      return [entry];
    const index = desired.findIndex((next) => next.name === entry.name);
    if (index < 0) return [];
    desired.splice(index, 1);
    return [entry];
  });
  if (notifications) {
    notifications.push(...desired);
    if (
      notifications.length === old.notifications?.length &&
      notifications.every((entry, index) => entry === old.notifications?.[index])
    )
      notifications = old.notifications;
    // Existing toast entries have already been displayed by UserContext. Changing
    // navigation must not replay them through its notification effect.
    else notifications = notifications.filter((entry) => entry.color !== "toast");
  }
  return {
    ...old,
    userData: user,
    ...(achievementProgress ? { achievementProgress } : {}),
    ...(notifications ? { notifications } : {}),
  };
};
