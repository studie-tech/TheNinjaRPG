"use client";

import { useUser } from "@clerk/nextjs";
import * as Sentry from "@sentry/nextjs";
import { hashKey, useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { atom } from "jotai";
import { useRouter } from "next/navigation";
import type Pusher from "pusher-js";
import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "@/app/_trpc/client";
import type { UserCache, UserUpdate, UserUpdateOptions } from "@/deltas/profile";
import type { StructureRoute } from "@/drizzle/constants";
import { useActionPreferenceCacheUpdate } from "@/hooks/useActionPreferenceCacheUpdate";
import { useMasteryQueueRefresh } from "@/hooks/useMasteryQueueRefresh";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { useSectorVillage } from "@/hooks/useSectorVillage";
import { usePusherHandler } from "@/layout/PusherHandler";
import type { ReturnedBattle } from "@/libs/combat/types";
import type { NavBarDropdownLink } from "@/libs/menus";
import { getTerritoryWarBoostUntil } from "@/libs/territoryWar";
import { showMutationToast } from "@/libs/toast";
import type { AchievementProgress, UserWithRelations } from "@/routers/profile";
import { parseHtml } from "@/utils/parse";
import { updateQueryCache } from "@/utils/queryCache";
import { loginRedirectPath } from "@/utils/routing";
import {
  prepareUserUpdate as captureUserUpdate,
  updateUserCache,
} from "@/utils/userCache";
import { withoutUserPosition } from "@/utils/userCacheSharing";
import { canAccessStructure, structureAccessDeniedMessage } from "@/utils/village";

/**
 * Atom for storing combat action
 */
export const combatActionIdAtom = atom<string | undefined>(undefined);

/** A submitted action, shown as reserved AP and a timeline slot until the field reaches it. */
export type CombatPendingAction = {
  battleId: string;
  /** Version the action was submitted against, which its first log entry carries. */
  version: number;
  userId: string;
  name: string;
  image: string;
  cost: number;
};
export const combatPendingActionAtom = atom<CombatPendingAction | undefined>(undefined);

/**
 * Battle version whose ending the field is still replaying. The result is already settled;
 * only its screen waits, so the deciding action is not lost to the swap.
 */
export const combatHeldResultAtom = atom<number | undefined>(undefined);

/** The battle on the field while it replays behind the live state; null once caught up. */
export const combatPresentedBattleAtom = atom<ReturnedBattle | null>(null);

/** The battle theme carries through a result screen, so another fight continues it. */
export const combatThemeHeldAtom = atom(false);

/** Newest log version the field has replayed; undefined when it is caught up. */
export const combatPresentedLogVersionAtom = atom<number | undefined>(undefined);

/**
 * Atom for managing any potential battle data
 */
export const userBattleAtom = atom<ReturnedBattle | undefined>(undefined);

/**
 * True while a blocking, auto-opening global popup (currently `ActivityStreakPopup`) is on
 * screen — or while its show-decision is still loading. Consumed by the overworld arrival
 * prompt so it never opens beneath another dialog on fresh login/reload. If a second global
 * blocker is added, prefer per-source atoms combined via a derived OR atom over a shared boolean.
 */
export const blockingPopupOpenAtom = atom<boolean>(false);

/**
 * Context for managing user data and state.
 */
type UserContextValue = {
  data: UserWithRelations;
  /**
   * Achievement progress, carried beside `data` rather than inside `data.userQuests`: the
   * definitions these rows belong to are static and are fetched once from
   * `quests.getAchievementCatalogue`. The logbook joins the two.
   */
  achievementProgress: AchievementProgress[] | undefined;
  notifications: NavBarDropdownLink[] | undefined;
  isEventParticipant: boolean;
  userAgent: string | undefined;
  status: string;
  pusher: Pusher | undefined;
  timeDiff: number;
  userId: string | null | undefined;
  isClerkLoaded: boolean;
  /** Server-known auth state until Clerk finishes loading, then Clerk's live state. */
  isSignedIn: boolean;
  prepareUserUpdate: () => number | undefined;
  actionPreferences: ReturnType<typeof useActionPreferenceCacheUpdate>;
  /** Resolve true for an accepted local projection; false retains dependent-cache recovery. */
  updateUser: (
    patch: UserUpdate | undefined,
    mutation?: UserUpdateOptions,
  ) => Promise<boolean>;
  /** Request a fresh profile after confirmed server work; false keeps feature recovery available. */
  refreshUser: () => Promise<boolean>;
  /** Derive notification changes from the latest cache value, preserving profile reconciliation. */
  updateNotifications: (
    update: (
      current: NavBarDropdownLink[] | undefined,
    ) => NavBarDropdownLink[] | undefined,
  ) => Promise<void>;
};

const defaultUserContext: UserContextValue = {
  data: undefined,
  achievementProgress: undefined,
  notifications: undefined,
  isEventParticipant: false,
  userAgent: undefined,
  status: "unknown",
  pusher: undefined,
  timeDiff: 0,
  userId: null,
  isClerkLoaded: false,
  isSignedIn: false,
  prepareUserUpdate: () => undefined,
  actionPreferences: {
    prepareUpdate: () => ({
      query: undefined,
      autoWakeUp: undefined,
      release: () => {},
      isCurrent: () => false,
    }),
    updateCache: async () => false,
    dispose: () => {},
  },
  updateUser: async () => false,
  refreshUser: async () => false,
  updateNotifications: async () => {
    // do nothing
  },
};

const UserInfoContext =
  createContext<Omit<UserContextValue, "data">>(defaultUserContext);

/**
 * UserContextProvider component provides a context for managing user-related data and functionality.
 * It includes the Pusher connection, the time difference between client and server, and user data retrieval.
 *
 * @param props - The component props.
 * @param props.children - The child components.
 * @returns The UserContextProvider component.
 */
export function UserContextProvider(props: {
  children: React.ReactNode;
  initialIsSignedIn: boolean;
}) {
  // Difference between client time and server time
  const [measuredTimeDiff, setMeasuredTimeDiff] = useState<number>();
  const timeDiff = measuredTimeDiff ?? 0;

  // Get logged in user
  const { isSignedIn, isLoaded, user } = useUser();
  const userId = user?.id;
  // Preserve the server-known state through hydration. Using `!!data` as an auth signal
  // makes signed-in pages briefly render their anonymous tree while getUser is pending.
  const effectiveIsSignedIn = isLoaded ? !!isSignedIn : props.initialIsSignedIn;

  // Get user data
  const {
    data,
    status: userStatus,
    refetch,
  } = api.profile.getUser.useQuery(undefined, {
    enabled: !!userId && isSignedIn && isLoaded,
    retry: false,
    refetchInterval: 300000,
    notifyOnChangeProps: ["data", "status"],
    // Session services observe their inputs, while profile consumers select their own cache data.
    select: ({ userData: user, ...metadata }) => ({
      ...metadata,
      userData: user && {
        userId: user.userId,
        username: user.username,
        status: user.status,
        clanId: user.clanId,
        villageId: user.villageId,
        currentlyTrainingMastery: user.currentlyTrainingMastery,
        masteryTrainingStartedAt: user.masteryTrainingStartedAt,
        trainingSpeed: user.trainingSpeed,
        currentlyTrainingElement: user.currentlyTrainingElement,
        elementalTrainingStartedAt: user.elementalTrainingStartedAt,
        elementalTrainingSpeed: user.elementalTrainingSpeed,
        isOutlaw: user.isOutlaw,
        clan: user.clan,
        village: user.village,
        raidBuffs: user.raidBuffs,
        cookingJobs: user.cookingJobs,
      },
    }),
  });

  // Profile reads collect completed sessions and start their queued successors.
  // Keep this independent of the visible page and its countdown components.
  useMasteryQueueRefresh(
    data?.userData,
    () => {
      void refetch({ cancelRefetch: false });
    },
    timeDiff,
    !!userId && !!isSignedIn && isLoaded,
  );

  // Timed bonuses and Cooking completions refresh on every page, including inventory.
  const territoryWarBoostUntil = data?.userData
    ? getTerritoryWarBoostUntil(data.userData)?.getTime()
    : undefined;
  useRefreshAt(
    [
      territoryWarBoostUntil,
      ...(data?.userData?.raidBuffs?.map((buff) => buff.expiresAt) ?? []),
      ...(data?.userData?.cookingJobs?.map((job) => job.finishesAt) ?? []),
    ],
    () => {
      void refetch({ cancelRefetch: false });
    },
    timeDiff,
    !!userId && !!isSignedIn && isLoaded,
  );

  // Listen on user channel for live updates on things
  const pusher = usePusherHandler(userId, data?.userData);

  const queryClient = useQueryClient();
  const userQueryKey = useMemo(
    () => getQueryKey(api.profile.getUser, undefined, "query"),
    [],
  );
  const actionPreferences = useActionPreferenceCacheUpdate(
    queryClient,
    userQueryKey,
    userId,
  );
  const prepareUserUpdate = useCallback(
    () => captureUserUpdate(queryClient, userQueryKey),
    [queryClient, userQueryKey],
  );
  const updateUser = useCallback(
    (patch: UserUpdate | undefined, mutation?: UserUpdateOptions) =>
      updateUserCache(queryClient, userQueryKey, patch, mutation),
    [queryClient, userQueryKey],
  );
  const refreshUser = useCallback(async () => {
    try {
      await queryClient.cancelQueries({ queryKey: userQueryKey, exact: true });
      const result = await refetch({ throwOnError: true });
      return result.isSuccess && result.data?.userData?.userId === userId;
    } catch {
      return false;
    }
  }, [queryClient, userQueryKey, refetch, userId]);

  /** Apply notification changes together with other writers, preserving unrelated profile reconciliation. */
  const updateNotifications = useCallback(
    async (update: Parameters<UserContextValue["updateNotifications"]>[0]) => {
      await updateQueryCache<UserCache>(queryClient, userQueryKey, (old) => {
        const notifications = update(old.notifications) ?? old.notifications;
        return notifications === old.notifications ? old : { ...old, notifications };
      });
    },
    [queryClient, userQueryKey],
  );

  // Time diff setting
  useEffect(() => {
    if (data?.serverTime) {
      const discrepancy = Date.now() - data.serverTime;
      // Calibrate the first response, then ignore subsecond transfer/render jitter.
      // Cached timestamps stay in server time; consumers apply timeDiff when needed.
      setMeasuredTimeDiff((current) =>
        current !== undefined && Math.abs(current - discrepancy) < 1000
          ? current
          : discrepancy,
      );
    }
  }, [data?.serverTime]);

  // Show user notifications in toast
  useEffect(() => {
    data?.notifications
      .filter((n) => n.color === "toast")
      .forEach((n) => {
        showMutationToast({
          success: true,
          message: <div>{parseHtml(n.name)}</div>,
          title: "Notification!",
        });
      });
  }, [data?.notifications]);

  // Update Sentry user context when userData changes
  useEffect(() => {
    if (data?.userData) {
      Sentry.setUser({
        id: data.userData.userId,
        username: data.userData.username,
        email: user?.primaryEmailAddress?.emailAddress,
      });
    } else {
      // Clear user context when logged out
      Sentry.setUser(null);
    }
  }, [
    data?.userData?.userId,
    data?.userData?.username,
    user?.primaryEmailAddress?.emailAddress,
  ]);

  // Keep identity stable for unchanged data, but include notifications: bonus expiry
  // removes a notification even when structural sharing preserves userData/timeDiff.
  // Consumers must rerender then to drop the expired bonus from activity previews.
  const info = useMemo<Omit<UserContextValue, "data">>(
    () => ({
      achievementProgress: data?.achievementProgress,
      notifications: data?.notifications,
      isEventParticipant: data?.isEventParticipant ?? false,
      userAgent: data?.userAgent,
      pusher: pusher,
      status: userStatus,
      timeDiff: timeDiff,
      userId: userId,
      isClerkLoaded: isLoaded,
      isSignedIn: effectiveIsSignedIn,
      prepareUserUpdate,
      actionPreferences,
      updateUser,
      refreshUser,
      updateNotifications: updateNotifications,
    }),
    [
      data?.achievementProgress,
      data?.notifications,
      data?.isEventParticipant,
      data?.userAgent,
      pusher,
      userStatus,
      timeDiff,
      userId,
      isLoaded,
      effectiveIsSignedIn,
      prepareUserUpdate,
      actionPreferences,
      updateUser,
      refreshUser,
      updateNotifications,
    ],
  );

  return <UserInfoContext value={info}>{props.children}</UserInfoContext>;
}

/** Observe the complete cached profile when a feature needs all its fields. */
export const useUserData = () => useUserDataSelector((user) => user);

/** Read session metadata and cache actions without subscribing to profile fields. */
export const useUserInfo = () => useContext(UserInfoContext);

/** Observe selected profile fields without subscribing unrelated UI to movement coordinates.
 * The provider owns fetching; this disabled observer shares its authenticated tRPC cache.
 */
export const useUserDataSelector = <T,>(
  select: (user: NonNullable<UserWithRelations>) => T,
) => {
  const info = useContext(UserInfoContext);
  const { data } = api.profile.getUser.useQuery(undefined, {
    enabled: false,
    // Compiler-generated dependencies may read query metadata; only the selected data drives this consumer.
    notifyOnChangeProps: ["data"],
    select: (snapshot) => (snapshot.userData ? select(snapshot.userData) : undefined),
  });
  return { ...info, data };
};

/** Profile fields independent of movement and its commit timestamp. */
export const selectUserWithoutPosition = (user: NonNullable<UserWithRelations>) =>
  withoutUserPosition(user);

/** Read current profile data inside scene callbacks without subscribing React to position changes. */
export const useUserDataRef = (
  onChange?: (user: UserWithRelations, previous: UserWithRelations) => void,
) => {
  const client = useQueryClient();
  const key = getQueryKey(api.profile.getUser, undefined, "query");
  const hash = hashKey(key);
  const cache = client.getQueryCache();
  const read = () =>
    cache.get<{ userData: UserWithRelations }>(hash)?.state.data?.userData;
  const user = useRef(read());
  const changed = useRef(onChange);
  changed.current = onChange;
  useEffect(() => {
    const update = () => {
      const next = read();
      if (next === user.current) return;
      const previous = user.current;
      user.current = next;
      changed.current?.(next, previous);
    };
    update();
    return cache.subscribe((event) => {
      // Observer bookkeeping does not change the cached profile.
      if (
        event.query.queryHash === hash &&
        (event.type === "updated" || event.type === "added" || event.type === "removed")
      )
        update();
    });
  }, [cache, hash]);
  return user;
};

/** Require a character while subscribing only to the selected fields. */
export const useRequiredUserDataSelector = <T,>(
  select: (user: NonNullable<UserWithRelations>) => T,
) => {
  const router = useRouter();
  const info = useUserDataSelector(select);
  const { data, status, isClerkLoaded, isSignedIn } = info;
  useEffect(() => {
    if (!isClerkLoaded) return;
    // Replace, not push: the guarded page must not stay in history to bounce Back forward.
    if (!isSignedIn) {
      router.replace(
        loginRedirectPath(window.location.pathname + window.location.search),
      );
    } else if (data === undefined && status !== "pending") {
      router.replace("/");
    }
  }, [status, data, isClerkLoaded, isSignedIn, router]);
  return info;
};

/** Require a character for consumers that render the complete profile. */
export const useRequiredUserData = () => useRequiredUserDataSelector((user) => user);

/** Keep session-only consumers subscribed to account changes rather than profile values. */
const selectUserId = (user: NonNullable<UserWithRelations>) => user.userId;

/** Require a character for consumers that only use session metadata or cache actions. */
export const useRequiredUserInfo = () => useRequiredUserDataSelector(selectUserId);

/**
 * A hook which requires the user to be in their village,
 * otherwise redirect to the profile page. Can optionally be
 * narrowed further to a specific structure in the village
 */
export const useRequireInVillage = (structureRoute?: StructureRoute) => {
  // Access state
  const [access, setAccess] = useState<boolean>(false);
  // Get user information
  const {
    data: userData,
    timeDiff,
    prepareUserUpdate,
    updateUser,
  } = useRequiredUserData();
  const { sectorVillage, isLoading: isLoadingSector } = useSectorVillage(userData);
  const isSectorKnown = !isLoadingSector;
  const ownVillage = userData?.village?.sector === sectorVillage?.sector;
  const router = useRouter();
  useEffect(() => {
    if (userData && isSectorKnown) {
      if (!userData.isOutlaw) {
        // Check structure access
        const access = canAccessStructure(userData, structureRoute, sectorVillage);
        // Redirect user
        if (!sectorVillage || !access) {
          showMutationToast({
            success: false,
            title: "Not reachable from here",
            message: structureAccessDeniedMessage(
              userData,
              structureRoute,
              sectorVillage,
            ),
            id: "structure-access-denied",
          });
          void router.replace("/");
        } else {
          setAccess(true);
        }
      } else {
        setAccess(true);
      }
    }
  }, [userData, sectorVillage, router, isSectorKnown, structureRoute]);
  return {
    userData,
    prepareUserUpdate,
    updateUser,
    sectorVillage,
    ownVillage,
    timeDiff,
    access,
  };
};
