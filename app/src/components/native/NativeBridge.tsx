"use client";

import { useEffect } from "react";
import { useNativePush } from "@/hooks/useNativePush";
import { isNative, widgets } from "@/libs/native";
import { useUserData } from "@/utils/UserContext";

/**
 * Everything the native shell needs wired up once, mounted from the root layout.
 *
 * Renders nothing and does nothing at all in a browser, so it is safe to keep in the tree
 * for every visitor.
 */
export default function NativeBridge() {
  const { data: userData } = useUserData();

  useNativePush({ enabled: !!userData });

  // Home screen widgets read a snapshot from the shared container rather than the API, so
  // they stay correct while the app is closed. Refresh it whenever the player's vitals
  // change; `sync` is a no-op when the shell has no widget plugin.
  useEffect(() => {
    if (!isNative()) return;
    if (!userData) {
      void widgets.clear();
      return;
    }
    void widgets.sync({
      updatedAt: new Date().toISOString(),
      username: userData.username,
      avatar: userData.avatar ?? undefined,
      village: userData.village?.name,
      rank: userData.rank,
      level: userData.level,
      curHealth: Math.round(userData.curHealth),
      maxHealth: Math.round(userData.maxHealth),
      curChakra: Math.round(userData.curChakra),
      maxChakra: Math.round(userData.maxChakra),
      curStamina: Math.round(userData.curStamina),
      maxStamina: Math.round(userData.maxStamina),
      unreadNotifications: userData.unreadNotifications,
    });
  }, [userData]);

  return null;
}
