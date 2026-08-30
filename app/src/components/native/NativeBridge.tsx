"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MIN_NATIVE_APP_VERSION } from "@/drizzle/constants";
import { useLiveActivity } from "@/hooks/useLiveActivity";
import { readWidgetToken, useNativePush } from "@/hooks/useNativePush";
import { calcHealFinish } from "@/libs/hospital";
import {
  appEvents,
  isNative,
  isOutdatedNativeClient,
  liveActivity,
  parseNativeUserAgent,
  platform,
  purchases,
  toInternalPath,
  widgets,
} from "@/libs/native";
import { useUserData } from "@/utils/UserContext";
import { getStrucBoost } from "@/utils/village";

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
  // Signature of the last snapshot written, so a regeneration tick that changes nothing
  // the widget renders does not spend a WidgetKit reload.
  const lastSnapshot = useRef<string | null>(null);

  const { unregister } = useNativePush({ enabled: !!userData });
  useLiveActivity(userData, timeDiff);

  // The shell version is only knowable in the browser, so this runs after mount rather
  // than during render — checking it inline would break hydration.
  useEffect(() => {
    const client = parseNativeUserAgent(navigator.userAgent);
    setIsOutdated(isOutdatedNativeClient(client, MIN_NATIVE_APP_VERSION));
  }, []);

  // Read through a ref so the listener is attached once. Attaching and removing it on
  // every navigation would round-trip the bridge each time, and rapid navigation could
  // briefly leave zero or two listeners on the button.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  // Capacitor's default for the Android back button is to exit the app from wherever the
  // player happens to be, which drops them out of the game from three menus deep. Play
  // reviewers check this too.
  useEffect(() => {
    if (!isNative()) return;
    return appEvents.onBackButton((canGoBack) => {
      if (canGoBack && pathnameRef.current !== "/") {
        router.back();
      } else {
        void appEvents.exitApp();
      }
    });
  }, [router]);

  // Universal Links and App Links arrive here rather than as a page load. OAuth returns
  // are handled by useNativeAuth, which is listening for its own redirect.
  useEffect(() => {
    if (!isNative()) return;
    return appEvents.onUrlOpen((url) => {
      const path = toInternalPath(url);
      if (path) router.push(path);
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
    // RevenueCat stays bound to the previous appUserId until told otherwise, so a
    // purchase or restore by the next person on this phone would credit the last account.
    void purchases.logOut();
    // Belt and braces alongside useLiveActivity's own cleanup: if the app was killed
    // mid-stay, nothing holds the activity id any more, and endAll reaches it anyway.
    void liveActivity.endAll();
    // Forget the deduplication signature too. Without this, signing back in with the same
    // vitals produces a matching signature, the write is skipped as redundant, and the
    // widget stays on the signed-out placeholder until a rounded stat happens to change.
    lastSnapshot.current = null;
  }, [isSignedOut, unregister]);

  // Home screen widgets read a snapshot from the shared container rather than the API, so
  // they stay correct while the app is closed. `sync` is a no-op when the shell has no
  // widget plugin.
  useEffect(() => {
    if (!isNative() || !userData) return;
    const quest = activeQuest(userData);
    const snapshot = {
      widgetToken: readWidgetToken(),
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
      // Without these the Quest widget and the Status widget's hospital line have
      // nothing to render, even though the snapshot type declares them.
      hospitalUntil: hospitalFinishesAt(userData, timeDiff),
      activeQuest: quest?.name,
      questProgress: quest?.progress,
    };
    // userData changes on every regeneration tick, and WidgetKit budgets timeline reloads
    // per app per day — spending them on writes that redraw the same numbers is how a
    // widget ends up throttled and stale. `updatedAt` is deliberately not part of the
    // comparison, since it changes every time by definition.
    const signature = JSON.stringify(snapshot);
    if (signature === lastSnapshot.current) return;
    lastSnapshot.current = signature;
    void widgets.sync({ ...snapshot, updatedAt: new Date().toISOString() });
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

/**
 * The quest the widget should show, and how far through it the player is.
 *
 * Achievements are excluded: they are permanent background goals rather than something
 * the player is currently on, and they would crowd out the real mission.
 */
const activeQuest = (
  userData: NonNullable<ReturnType<typeof useUserData>["data"]>,
): { name: string; progress?: number } | undefined => {
  const entry = userData.userQuests?.find(
    (userQuest) => userQuest.quest?.questType !== "achievement",
  );
  if (!entry?.quest) return undefined;
  const goals = userData.questData?.find(
    (tracker) => tracker.id === entry.quest.id,
  )?.goals;
  if (!goals || goals.length === 0) return { name: entry.quest.name };
  const done = goals.filter((goal) => goal.done).length;
  return { name: entry.quest.name, progress: done / goals.length };
};

/**
 * When the player leaves hospital, or undefined if they are not in one.
 *
 * Two things this has to get right that a bare `calcHealFinish` does not. The village
 * hospital speed structure shortens the stay, exactly as the hospital screen applies it —
 * without it the widget would keep counting after the player was already healed. And the
 * result is rounded to the minute, because `calcHealFinish` derives its timestamp from
 * `Date.now()` and would otherwise produce a different value on every regeneration tick,
 * defeating the snapshot deduplication and spending WidgetKit's daily reload budget on
 * writes that change nothing anyone can see.
 */
const hospitalFinishesAt = (
  userData: NonNullable<ReturnType<typeof useUserData>["data"]>,
  timeDiff: number,
): string | undefined => {
  if (userData.status !== "HOSPITALIZED") return undefined;
  const boost = getStrucBoost("hospitalSpeedupPerLvl", userData.village?.structures);
  const finish = calcHealFinish({ user: userData, timeDiff, boost });
  const rounded = Math.round(finish.getTime() / 60_000) * 60_000;
  return new Date(rounded).toISOString();
};
