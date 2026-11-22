"use client";

import { useSetAtom } from "jotai";
import type React from "react";
import { useEffect, useState } from "react";
import { useLocalStorage } from "@/hooks/localstorage";
import { useActivityStreaks } from "@/hooks/useActivityStreaks";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { useSplash } from "@/hooks/useSplash";
import { loadActivityStreakPanel, WelcomeDialog } from "@/layout/WelcomeDialog";
import {
  isActivityStreakPopupBlocking,
  resolveActivityStreakDateLatches,
  resolveActivityStreakPopupOpen,
  shouldFetchActivityStreaksForPopup,
} from "@/libs/activityStreak";
import { isBrowserAuthPath } from "@/libs/native/deepLink";
import { isTutorialActive } from "@/libs/tutorial";
import { usePublicPathname } from "@/utils/routing";
import { getDateKey, nextUtcDayAt } from "@/utils/time";
import { blockingPopupOpenAtom, useUserDataSelector } from "@/utils/UserContext";

const ActivityStreakPopup: React.FC = () => {
  const pathname = usePublicPathname();
  // Browser authentication must keep its account confirmation reachable without
  // claiming or dismissing rewards that remain eligible in the game.
  const isSuppressedRoute =
    // The announcement editor owns its preview so the automatic dialog cannot cover it.
    pathname === "/manual/splash" ||
    pathname === "/merch" ||
    pathname.startsWith("/merch/") ||
    isBrowserAuthPath(pathname);
  const currentDateKey = getDateKey(new Date());
  // Once opened, the popup stays mounted through reward refetches so the user can see the
  // claimed state until they explicitly close it.
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  // A plain boolean would remain latched if this tab stays mounted across midnight.
  const [userClosedDateKey, setUserClosedDateKey] = useState<string | null>(null);

  // Signals the overworld arrival prompt to hold while this dialog is up or pending.
  const setBlockingPopupOpen = useSetAtom(blockingPopupOpenAtom);

  // Persist the dismissed date under a stable key so tomorrow starts eligible again.
  const [dismissedDateKey, setDismissedDateKey] = useLocalStorage<string | null>(
    "streakPopupDismissedDateX",
    null,
  );
  const { dismissedToday, userClosed } = resolveActivityStreakDateLatches(
    currentDateKey,
    dismissedDateKey,
    userClosedDateKey,
  );

  // Query
  const { data: userData, timeDiff } = useUserDataSelector((user) => ({
    tutorialOn: user.tutorialOn,
    tutorialStep: user.tutorialStep,
  }));

  // Read off userData rather than a shared atom so the suppression holds from
  // the very first render, with no window where both can be on screen.
  const tutorialActive = isTutorialActive(userData);

  // Only fetch while the dialog is still allowed to open. Tutorial / dismissed-today /
  // session-close already forbid it; querying then is 13KB on every signed-in page
  // for a popup that cannot appear. Re-enables when those latches clear (tutorial
  // finished, date rollover) so an unclaimed reward is not dropped.
  const shouldFetchStreaks = shouldFetchActivityStreaksForPopup({
    hasUser: !!userData && !isSuppressedRoute,
    tutorialActive,
    dismissedToday,
    userClosed,
  });
  const { data: userStreaks, isLoading: isLoadingStreaks } = useActivityStreaks(
    shouldFetchStreaks,
    timeDiff,
  );
  const splash = useSplash(shouldFetchStreaks, timeDiff);
  useRefreshAt(
    [nextUtcDayAt(new Date(Date.now() - timeDiff))],
    () => setUserClosedDateKey(null),
    timeDiff,
    !!userData,
  );
  const isLoading = isLoadingStreaks || splash.isLoading;
  useEffect(() => {
    if (shouldFetchStreaks)
      void loadActivityStreakPanel().catch(() => {
        // The dialog boundary reports failed downloads and keeps rewards dismissible.
      });
  }, [shouldFetchStreaks]);

  // Determine if we should show the popup
  const hasUnclaimedRewards =
    userStreaks?.streaks.some((s) => s.canClaimToday) ?? false;
  const needsCatchUp = userStreaks?.streaks.some((s) => s.needsCatchUp) ?? false;
  const hasRecurringToEnroll = !!userStreaks?.activeRecurringConfig;
  const shouldShowPopup =
    !isSuppressedRoute &&
    (!!splash.data?.announcements.length ||
      hasUnclaimedRewards ||
      needsCatchUp ||
      hasRecurringToEnroll);

  useEffect(() => {
    setIsModalOpen(
      (isOpen) =>
        !isSuppressedRoute &&
        resolveActivityStreakPopupOpen({
          isOpen,
          isLoading,
          shouldShowPopup,
          dismissedToday,
          userClosed,
          tutorialActive,
        }),
    );
  }, [
    isLoading,
    shouldShowPopup,
    dismissedToday,
    userClosed,
    tutorialActive,
    isSuppressedRoute,
  ]);

  // This popup blocks the overworld arrival prompt while it is on screen OR while its
  // show-decision is still loading — the latter closes a fresh-login race where the arrival
  // prompt would otherwise open in the gap before this dialog mounts. Gated on `userClosed`
  // so that once the user closes it, the arrival prompt is free to fire.
  const isBlocking =
    !isSuppressedRoute &&
    isActivityStreakPopupBlocking(!!userData, {
      isOpen: isModalOpen,
      isLoading,
      shouldShowPopup,
      dismissedToday,
      userClosed,
      tutorialActive,
    });
  useEffect(() => {
    setBlockingPopupOpen(isBlocking);
    return () => setBlockingPopupOpen(false);
  }, [isBlocking, setBlockingPopupOpen]);

  // Handle simple close - just close the dialog, will show again on refresh
  const handleClose = () => {
    setUserClosedDateKey(currentDateKey);
    setIsModalOpen(false);
  };

  // Handle dismiss for today - won't show again until tomorrow
  const handleDismissForToday = () => {
    setUserClosedDateKey(currentDateKey);
    setDismissedDateKey(currentDateKey);
    setIsModalOpen(false);
  };

  // The unified board owns both announcement and reward content.
  if (isSuppressedRoute || !userData || !isModalOpen) {
    return null;
  }

  return (
    <WelcomeDialog
      announcements={splash.data?.announcements ?? []}
      onClose={handleClose}
      onDismissForToday={handleDismissForToday}
    />
  );
};

export default ActivityStreakPopup;
