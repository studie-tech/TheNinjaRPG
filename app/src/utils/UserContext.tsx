"use client";

import React, { createContext, useEffect, useState } from "react";
import { parseHtml } from "@/utils/parse";
import { useContext } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { api } from "@/app/_trpc/client";
import { secondsFromDate } from "@/utils/time";
import { showMutationToast } from "@/libs/toast";
import { canAccessStructure } from "@/utils/village";
import { atom } from "jotai";
import { usePusherHandler } from "@/layout/PusherHandler";
import * as Sentry from "@sentry/nextjs";
import type Pusher from "pusher-js";
import type { NavBarDropdownLink } from "@/libs/menus";
import type { UserWithRelations } from "@/api/routers/profile";
import type { ReturnedBattle } from "@/libs/combat/types";
import type { StructureRoute } from "@/drizzle/constants";

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

  // Get logged in user
  const { isSignedIn, isLoaded, user } = useUser();
  const userId = user?.id;

  // tRPC utility
  const utils = api.useUtils();

  // Get user data
  const { data: data, status: userStatus } = api.profile.getUser.useQuery(undefined, {
    enabled: !!userId && isSignedIn && isLoaded,
    retry: false,
    refetchInterval: 300000,
  });

  // Listen on user channel for live updates on things
  const pusher = usePusherHandler(userId, data?.userData);

  // Optimistic user info update function
  const updateUser = async (updatedData: Partial<UserWithRelations>) => {
    await utils.profile.getUser.cancel();
    utils.profile.getUser.setData(undefined, (old) => {
      return { ...old, userData: { ...old?.userData, ...updatedData } } as typeof old;
    });
  };

  // Optimistic notification update function
  const updateNotifications = async (
    notifications: NavBarDropdownLink[] | undefined,
  ) => {
    await utils.profile.getUser.cancel();
    utils.profile.getUser.setData(undefined, (old) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.serverTime]);

  // Show user notifications in toast
  useEffect(() => {
    data?.notifications
      .filter((n) => n.color === "toast")
      .map((n) => {
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
  }, [data?.userData, user?.primaryEmailAddress?.emailAddress]);

  return (
    <UserContext.Provider
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
    </UserContext.Provider>
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
  // Get user information
  const info = useUserData();
  // Redirection if not logged in
  const { data, status } = info;
  useEffect(() => {
    if (isLoaded && (!isSignedIn || (data === undefined && status !== "pending"))) {
      router.push("/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, data, isLoaded, isSignedIn]);

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
