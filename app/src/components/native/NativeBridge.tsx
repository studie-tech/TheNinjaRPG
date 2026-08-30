"use client";

import { useEffect, useState } from "react";
import { MIN_NATIVE_APP_VERSION } from "@/drizzle/constants";
import { useNativePush } from "@/hooks/useNativePush";
import {
  isNative,
  isOutdatedNativeClient,
  parseNativeUserAgent,
  platform,
  widgets,
} from "@/libs/native";
import { useUserData } from "@/utils/UserContext";

/**
 * Everything the native shell needs wired up once, mounted from the root layout.
 *
 * Renders nothing and does nothing at all in a browser, so it is safe to keep in the tree
 * for every visitor.
 */
export default function NativeBridge() {
  const { data: userData } = useUserData();
  const [isOutdated, setIsOutdated] = useState(false);

  useNativePush({ enabled: !!userData });

  // The shell version is only knowable in the browser, so this runs after mount rather
  // than during render — checking it inline would break hydration.
  useEffect(() => {
    const client = parseNativeUserAgent(navigator.userAgent);
    setIsOutdated(isOutdatedNativeClient(client, MIN_NATIVE_APP_VERSION));
  }, []);

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

  if (!isOutdated) return null;
  return <UpdateWall />;
}

/**
 * Shown when the installed binary is older than `MIN_NATIVE_APP_VERSION`. There is no
 * dismiss: the point is that the site is about to use something this build cannot do, and
 * letting the player through would only produce confusing failures.
 */
const UpdateWall: React.FC = () => {
  const store = platform() === "ios" ? "the App Store" : "Google Play";
  return (
    <div className="fixed inset-0 z-100 flex flex-col items-center justify-center gap-4 bg-background p-8 text-center">
      <p className="text-6xl">🥷</p>
      <h1 className="font-bold text-2xl">Time to update</h1>
      <p className="max-w-sm text-muted-foreground text-sm">
        This version of TheNinja-RPG is too old to connect. Update the app from {store}{" "}
        to keep playing.
      </p>
    </div>
  );
};
