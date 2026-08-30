"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MIN_NATIVE_APP_VERSION } from "@/drizzle/constants";
import { useLiveActivity } from "@/hooks/useLiveActivity";
import { useNativePush } from "@/hooks/useNativePush";
import {
  appEvents,
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
  const { data: userData, userId, isClerkLoaded, pusher, timeDiff } = useUserData();
  const router = useRouter();
  const pathname = usePathname();
  const [isOutdated, setIsOutdated] = useState(false);
  const isSignedOut = isClerkLoaded && !userId;

  const { unregister } = useNativePush({ enabled: !!userData });
  useLiveActivity(userData, timeDiff);

  // The shell version is only knowable in the browser, so this runs after mount rather
  // than during render — checking it inline would break hydration.
  useEffect(() => {
    const client = parseNativeUserAgent(navigator.userAgent);
    setIsOutdated(isOutdatedNativeClient(client, MIN_NATIVE_APP_VERSION));
  }, []);

  // Capacitor's default for the Android back button is to exit the app from wherever the
  // player happens to be, which drops them out of the game from three menus deep. Play
  // reviewers check this too.
  useEffect(() => {
    if (!isNative()) return;
    return appEvents.onBackButton((canGoBack) => {
      if (canGoBack && pathname !== "/") {
        router.back();
      } else {
        void appEvents.exitApp();
      }
    });
  }, [pathname, router]);

  // Universal Links and App Links arrive here rather than as a page load. OAuth returns
  // are handled by useNativeAuth, which is listening for its own redirect.
  useEffect(() => {
    if (!isNative()) return;
    return appEvents.onUrlOpen((url) => {
      try {
        const parsed = new URL(url);
        if (!parsed.hostname.endsWith("theninja-rpg.com")) return;
        router.push(`${parsed.pathname}${parsed.search}${parsed.hash}`);
      } catch {
        // A malformed deep link is not worth reacting to.
      }
    });
  }, [router]);

  // The WebSocket is dropped while the app is backgrounded and the client does not always
  // notice, which leaves the player looking at a world that has stopped updating.
  useEffect(() => {
    if (!isNative() || !pusher) return;
    return appEvents.onStateChange((isActive) => {
      if (isActive && pusher.connection.state !== "connected") {
        pusher.connect();
      }
    });
  }, [pusher]);

  // Leaving a token bound to a signed-out account would send the next person to pick up
  // the phone somebody else's alerts, and leave their stats on the home screen. Gated on
  // Clerk having resolved, because userData is undefined during load for a signed-in
  // player too.
  useEffect(() => {
    if (!isNative() || !isSignedOut) return;
    void unregister();
    void widgets.clear();
  }, [isSignedOut, unregister]);

  // Home screen widgets read a snapshot from the shared container rather than the API, so
  // they stay correct while the app is closed. Refresh it whenever the player's vitals
  // change; `sync` is a no-op when the shell has no widget plugin.
  useEffect(() => {
    if (!isNative() || !userData) return;
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
