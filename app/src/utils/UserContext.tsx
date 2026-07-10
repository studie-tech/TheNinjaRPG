"use client";

import { useUser } from "@clerk/nextjs";
import * as Sentry from "@sentry/nextjs";
import { atom } from "jotai";
import { useRouter } from "next/navigation";
import type Pusher from "pusher-js";
import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";
import type { UserWithRelations } from "@/api/routers/profile";
import { isTransientMultiSessionAuthError } from "@/app/_trpc/authHeaders";
import { api } from "@/app/_trpc/client";
import { getUserQueryInput } from "@/app/_trpc/getUserQueryInput";
import { useSessionPin } from "@/app/_trpc/SessionPinProvider";
import type { StructureRoute } from "@/drizzle/constants";
import { usePusherHandler } from "@/layout/PusherHandler";
import type { ReturnedBattle } from "@/libs/combat/types";
import type { NavBarDropdownLink } from "@/libs/menus";
import { showMutationToast } from "@/libs/toast";
import { parseHtml } from "@/utils/parse";
import { secondsFromDate } from "@/utils/time";
import { canAccessStructure } from "@/utils/village";

/**
 * Atom for storing combat action¨
 */
export const combatActionIdAtom = atom<string | undefined>(undefined);

/**
 * Atom for managing any potential battle data
 */
export const userBattleAtom = atom<ReturnedBattle | undefined>(undefined);

/**
 * Context for managing user data and state.
 */
export const UserContext = createContext<{
  data: UserWithRelations;
  notifications: NavBarDropdownLink[] | undefined;
  userAgent: string | undefined;
  status: string;
  pusher: Pusher | undefined;
  timeDiff: number;
  userId: string | null | undefined;
  isClerkLoaded: boolean;
  updateUser: (data: Partial<UserWithRelations>) => Promise<void>;
  updateNotifications: (
    notifications: NavBarDropdownLink[] | undefined,
  ) => Promise<void>;
}>({
  data: undefined,
  notifications: undefined,
  userAgent: undefined,
  status: "unknown",
  pusher: undefined,
  timeDiff: 0,
  userId: null,
  isClerkLoaded: false,
  updateUser: async () => {
    // do nothing
  },
  updateNotifications: async () => {
    // do nothing
  },
});

/**
 * UserContextProvider component provides a context for managing user-related data and functionality.
 * It includes features such as managing Clerk token, Pusher connection, current user battle, time difference between client and server, and user data retrieval.
 *
 * @param props - The component props.
 * @param props.children - The child components.
 * @returns The UserContextProvider component.
 */
export function UserContextProvider(props: { children: React.ReactNode }) {
  // Difference between client time and server time
  const [timeDiff, setTimeDiff] = useState<number>(0);

  // Identity is the tab's PINNED Clerk session, not the browser-global active
  // session, so the displayed profile cannot flip to another signed-in account
  // when the active session changes (reload/refocus/background under multi-session).
  const { isLoaded, user } = useUser();
  const { pinnedUserId } = useSessionPin();
  const userId = pinnedUserId;

  // tRPC utility
  const utils = api.useUtils();

  // Get user data. Pass the pinned Clerk userId so the React Query cache is scoped
  // per account (Clerk multi-session) and the server can reject cross-account reads.
  // The transient multi-session auth failures (fail-closed UNAUTHORIZED, viewer
  // mismatch FORBIDDEN) self-heal on the next per-tab-token request, so retry them
  // instead of settling into a terminal error that reads as "signed out".
  const { data, status: userStatus } = api.profile.getUser.useQuery(
    getUserQueryInput(userId),
    {
      enabled: !!userId && isLoaded,
      retry: (failureCount, error) =>
        failureCount < 3 &&
        isTransientMultiSessionAuthError(error.data?.code, error.message),
      refetchInterval: 300000,
    },
  );

  // Listen on user channel for live updates on things
  const pusher = usePusherHandler(userId, data?.userData);

  // Optimistic user info update function. Fail closed when there is no pinned
  // account: writing with an undefined input would land on the legacy unscoped
  // profile.getUser cache key, which no account reads.
  const updateUser = async (updatedData: Partial<UserWithRelations>) => {
    const queryInput = getUserQueryInput(userId);
    if (!queryInput) return;
    await utils.profile.getUser.cancel(queryInput);
    utils.profile.getUser.setData(queryInput, (old) => {
      return { ...old, userData: { ...old?.userData, ...updatedData } } as typeof old;
    });
  };

  // Optimistic notification update function (see updateUser for the fail-closed note)
  const updateNotifications = async (
    notifications: NavBarDropdownLink[] | undefined,
  ) => {
    const queryInput = getUserQueryInput(userId);
    if (!queryInput) return;
    await utils.profile.getUser.cancel(queryInput);
    utils.profile.getUser.setData(queryInput, (old) => {
      return { ...old, notifications } as typeof old;
    });
  };

  // Time diff setting
  useEffect(() => {
    if (data?.serverTime) {
      const discrepancy = Date.now() - data.serverTime;
      if (data.userData) {
        // Adjust updatedAt to client-time, effectively making client-time
        // seem the same as server-time, although server-time is still used
        // for all calculations
        data.userData.updatedAt = secondsFromDate(
          -discrepancy / 1000,
          data.userData.updatedAt,
        );
      }
      // Save the time-discrepancy between client and server for reference
      // e.g. in the battle system
      setTimeDiff(discrepancy);
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
        // Only attach the Clerk email when the browser-active user matches the
        // pinned account; otherwise it could be another signed-in account's email.
        email:
          user?.id === data.userData.userId
            ? user?.primaryEmailAddress?.emailAddress
            : undefined,
      });
    } else {
      // Clear user context when logged out
      Sentry.setUser(null);
    }
  }, [data?.userData, user?.id, user?.primaryEmailAddress?.emailAddress]);

  return (
    <UserContext
      value={{
        data: data?.userData,
        notifications: data?.notifications,
        userAgent: data?.userAgent,
        pusher: pusher,
        status: userStatus,
        timeDiff: timeDiff,
        userId: userId,
        isClerkLoaded: isLoaded,
        updateUser: updateUser,
        updateNotifications: updateNotifications,
      }}
    >
      {props.children}
    </UserContext>
  );
}

// Easy hook for getting the current user data
export const useUserData = () => {
  return useContext(UserContext);
};

// Require the user to be logged in
export const useRequiredUserData = () => {
  // Router for redirection
  const router = useRouter();
  // Get auth information
  const { isLoaded, isSignedIn } = useUser();
  // Clerk multi-session: this TAB is signed in as long as its pinned session is —
  // the browser-global active session can flip or drop (other account signed out,
  // cross-tab active-context races) while the pinned session is perfectly valid.
  // Redirecting on the browser-global signal alone booted signed-in users to the
  // logged-out landing page; only treat the tab as signed out when NEITHER the
  // pinned session nor the browser-global session is signed in.
  const { pinnedUserId } = useSessionPin();
  // Get user information
  const info = useUserData();
  // Redirection if not logged in
  const { data, status } = info;
  useEffect(() => {
    const signedOutTab = !isSignedIn && !pinnedUserId;
    if (isLoaded && (signedOutTab || (data === undefined && status !== "pending"))) {
      router.push("/");
    }
  }, [status, data, isLoaded, isSignedIn, pinnedUserId]);

  // Return state
  return info;
};

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
    notifications,
    timeDiff,
    updateUser,
    updateNotifications,
  } = useRequiredUserData();
  // Get sector information based on user data
  const { data: sectorVillage, isPending } = api.travel.getVillageInSector.useQuery(
    { sector: userData?.sector ?? -1, isOutlaw: userData?.isOutlaw ?? false },
    { enabled: !!userData?.sector },
  );
  const ownVillage = userData?.village?.sector === sectorVillage?.sector;
  const router = useRouter();
  useEffect(() => {
    if (userData && !isPending) {
      if (!userData.isOutlaw) {
        // Check structure access
        const access = canAccessStructure(userData, structureRoute, sectorVillage);
        // Redirect user
        if (!sectorVillage || !access) {
          void router.push("/");
        } else {
          setAccess(true);
        }
      } else {
        setAccess(true);
      }
    }
  }, [userData, sectorVillage, router, isPending, structureRoute, ownVillage]);
  return {
    userData,
    notifications,
    updateUser,
    updateNotifications,
    sectorVillage,
    ownVillage,
    timeDiff,
    access,
  };
};
