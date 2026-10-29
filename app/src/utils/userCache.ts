import type { QueryClient, QueryKey } from "@tanstack/react-query";
import {
  MAX_SKILL_POINTS,
  MEDNIN_EXP_CAP,
  SAGE_MASTERY_EXP_CAP,
  SHRINE_BOOST_TYPES,
  UserRanks,
} from "@/drizzle/constants";
import type { NavBarDropdownLink } from "@/libs/menus";
import { canAssignExperience } from "@/libs/profile";
import { getUserFactionNotifications } from "@/libs/userNotifications";
import type {
  AchievementProgress,
  UserWithRelations,
} from "@/server/api/routers/profile";
import { isPlainObject } from "@/utils/typeutils";
import { countBoostingShrines, getShrineBoost } from "@/utils/village";
import type { UserCachePatch, UserDelta } from "@/validators/userCache";

type User = NonNullable<UserWithRelations>;
type UserCache = {
  userData?: User | null;
  achievementProgress?: AchievementProgress[];
  notifications?: NavBarDropdownLink[];
  isEventParticipant?: boolean;
};
type KnownUserPatch = Partial<User> | UserCachePatch;
export type UserPatch =
  | KnownUserPatch
  | ((current: User) => KnownUserPatch | undefined);

export const prepareUserUpdate = (client: QueryClient, key: QueryKey) => {
  // An action can render before the initial profile; leave that loading query running.
  // Pending or invalidated reads may reconcile another action, so keep those too.
  const state = client.getQueryState<UserCache>(key);
  if (
    !state?.data?.userData ||
    state.status === "error" ||
    state.isInvalidated ||
    state.fetchStatus !== "idle"
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
  isEventParticipant?: boolean;
  notifications?: (
    current: NavBarDropdownLink[] | undefined,
  ) => NavBarDropdownLink[] | undefined;
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
    let needsRefresh =
      before?.status === "error" ||
      !!before?.isInvalidated ||
      before?.fetchStatus !== "idle";
    await client.cancelQueries({ queryKey: key, exact: true });
    client.setQueryData<UserCache>(key, (old) => {
      const state = client.getQueryState(key);
      needsRefresh ||=
        state?.status === "error" ||
        !!state?.isInvalidated ||
        state?.fetchStatus !== "idle";
      if (!old?.userData) return undefined;
      const known = typeof patch === "function" ? patch(old.userData) : patch;
      const user =
        known && mergeUserChanges(old.userData, known, {}, undefined, USER_RELATIONS);
      if (!user) {
        needsRefresh = true;
        return undefined;
      }
      return mergeUserCache(old, user);
    });
    // A local patch must preserve reconciliation of unrelated fields.
    if (needsRefresh)
      await client.refetchQueries({ queryKey: key, exact: true, type: "all" });
    return;
  }
  const { revision } = mutation;
  const delta =
    "delta" in mutation ? mutation.delta : patch === undefined ? undefined : {};
  if (delta === undefined || revision === undefined) {
    // An initial fetch may contain a pre-mutation snapshot. Cancel it first so
    // a snapshot taken before the mutation cannot satisfy this reconciliation.
    await client.cancelQueries({ queryKey: key, exact: true });
    await client.refetchQueries({ queryKey: key, exact: true, type: "all" });
    return;
  }
  const wasFetching = client.getQueryState(key)?.fetchStatus !== "idle";
  await client.cancelQueries({ queryKey: key, exact: true });
  // Another action may have requested this unfinished read to reconcile its own changes.
  // Preserve that refresh instead of cancelling it and clearing the invalidation with a delta.
  if (wasFetching) {
    await client.refetchQueries({ queryKey: key, exact: true, type: "all" });
    return;
  }
  let applied = false;
  client.setQueryData<UserCache>(key, (old) => {
    // A completed refetch or another absolute patch may already include this debit.
    // Cancelling at success cannot undo that response; refresh rather than count it twice.
    const state = client.getQueryState(key);
    if (
      !old?.userData ||
      state?.status === "error" ||
      state?.dataUpdateCount !== revision ||
      state.isInvalidated ||
      state.fetchStatus !== "idle"
    ) {
      return undefined;
    }
    const known = typeof patch === "function" ? patch(old.userData) : patch;
    if (patch && known === undefined) return undefined;
    const user = mergeUserChanges(
      old.userData,
      known ?? {},
      delta,
      USER_DELTA_CAPS,
      USER_RELATIONS,
    );
    if (!user) return undefined;
    applied = true;
    const result = mergeUserCache(old, user, mutation.achievementProgress);
    if (mutation.isEventParticipant !== undefined)
      result.isEventParticipant = mutation.isEventParticipant;
    if (mutation.notifications)
      result.notifications = mutation.notifications(result.notifications);
    return result;
  });
  if (!applied)
    await client.refetchQueries({ queryKey: key, exact: true, type: "all" });
};

const USER_RELATIONS = {
  anbuSquad: "anbuId",
  clan: "clanId",
  village: "villageId",
  bloodline: "bloodlineId",
  activeReskin: "bloodlineReskinId",
  sageMode: "sageModeId",
  questParty: "questPartyId",
} as const;

const USER_DELTA_CAPS = {
  skillPoints: MAX_SKILL_POINTS,
  medicalExperience: MEDNIN_EXP_CAP,
  sageMasteryExperience: SAGE_MASTERY_EXP_CAP,
};

/** Merge partial objects, validating identities and adding deltas to the original values. */
const mergeUserChanges = <T extends object>(
  current: T,
  patch: object,
  delta: object = {},
  caps?: Readonly<Record<string, number>>,
  relations?: Readonly<Record<string, string>>,
): T | undefined => {
  const original = current as Record<string, unknown>;
  const values = patch as Record<string, unknown>;
  const amounts = delta as Record<string, unknown>;
  if (
    (values.id !== undefined && values.id !== original.id) ||
    (amounts.id !== undefined && amounts.id !== original.id)
  )
    return undefined;
  const updated = { ...original, ...values };
  // A changed membership must carry its complete relation, never fields from the old owner.
  for (const [relation, foreignKey] of Object.entries(relations ?? {})) {
    if (values[foreignKey] === undefined || values[foreignKey] === original[foreignKey])
      continue;
    const value = values[relation];
    if (
      amounts[relation] !== undefined ||
      (values[foreignKey] === null
        ? value !== null
        : !isCacheObject(value) || value.id !== values[foreignKey])
    )
      return undefined;
    updated[relation] = value;
  }
  for (const field in { ...values, ...amounts }) {
    const value = values[field];
    const amount = amounts[field];
    const foreignKey = relations?.[field];
    if (
      foreignKey &&
      values[foreignKey] !== undefined &&
      values[foreignKey] !== original[foreignKey]
    )
      continue;
    if (amount === undefined && value === original[field]) continue;
    // Mission assignments, Kage schedules and complete shrine settings are saved JSON snapshots.
    if (
      amount === undefined &&
      isCacheObject(value) &&
      (field === "activeMission" ||
        field === "warMission" ||
        field === "kageSchedule" ||
        (field === "shrineSettings" &&
          Array.isArray(value.unlockedAiIds) &&
          Array.isArray(value.activeAiIds) &&
          isCacheObject(value.activeBoosts)))
    ) {
      updated[field] = value;
      continue;
    }
    if (isCacheObject(value) || isCacheObject(amount)) {
      const merged = mergeUserChanges(
        isCacheObject(original[field]) ? original[field] : {},
        isCacheObject(value) ? value : {},
        isCacheObject(amount) ? amount : {},
      );
      if (!merged) return undefined;
      updated[field] = merged;
    } else if (typeof amount === "number" && field !== "id") {
      const baseline = original[field];
      if (typeof baseline !== "number") return undefined;
      updated[field] = Math.min(baseline + amount, caps?.[field] ?? Infinity);
    }
  }
  return updated as T;
};

const isCacheObject = (value: unknown): value is Record<string, unknown> =>
  isPlainObject(value) && !(value instanceof Date);

/** Keep navigation derived from profile fields in the same atomic cache update. */
const mergeUserCache = (
  old: UserCache,
  user: User,
  achievementProgress?: AchievementProgress[],
): UserCache => {
  const factionNotifications = getUserFactionNotifications(user);
  const previousFactionNames = new Set(
    getUserFactionNotifications(old.userData ?? undefined).map((entry) => entry.name),
  );
  const desired: NavBarDropdownLink[] = [...factionNotifications];
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
  if (user.deletionAt)
    desired.push({ href: "/profile", name: "Being deleted", color: "red" });
  if (user.isBanned) desired.push({ href: "/reports", name: "Banned!", color: "red" });
  if (user.isTradeBanned)
    desired.push({ href: "/reports", name: "Trade Banned!", color: "red" });
  for (const boostType of SHRINE_BOOST_TYPES) {
    const boost =
      getShrineBoost(
        countBoostingShrines(user.village?.sectors),
        boostType,
        user.village,
      ) * 100;
    if (boost > 0)
      desired.push({
        href: "/shrine",
        name: `Shrine: +${boost}% ${boostType} gains`,
        color: "green",
        group: "Active boosts",
      });
  }
  let notifications = old.notifications?.flatMap((entry) => {
    if (
      entry.id !== "tutorial-unassigned-stats" &&
      ![
        "Assign XP",
        "In combat",
        "In hospital",
        "Being deleted",
        "Banned!",
        "Trade Banned!",
      ].includes(entry.name) &&
      !previousFactionNames.has(entry.name) &&
      !(
        entry.href === "/shrine" &&
        entry.group === "Active boosts" &&
        entry.name.startsWith("Shrine: +")
      )
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
