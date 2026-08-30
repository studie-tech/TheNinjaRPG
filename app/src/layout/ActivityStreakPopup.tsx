"use client";

import { useSetAtom } from "jotai";
import { BellOff, Gift, X } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocalStorage } from "@/hooks/localstorage";
import ActivityStreakPanel from "@/layout/ActivityStreakPanel";
import {
  isActivityStreakPopupBlocking,
  resolveActivityStreakDateLatches,
  resolveActivityStreakPopupOpen,
} from "@/libs/activityStreak";
import { cn } from "@/libs/shadui";
import { isTutorialActive } from "@/libs/tutorial";
import { getDateKey } from "@/utils/time";
import { blockingPopupOpenAtom, useUserData } from "@/utils/UserContext";

const ActivityStreakPopup: React.FC = () => {
  const currentDateKey = getDateKey(new Date());
  // Preserve the pre-overworld behavior: once opened, the popup stays mounted through reward
  // refetches so the user can see the claimed state until they explicitly close it.
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
  const { data: userData } = useUserData();

  // Read off userData rather than a shared atom so the suppression holds from
  // the very first render, with no window where both can be on screen.
  const tutorialActive = isTutorialActive(userData);

  // Always query streaks if we have a user (we check dismissedToday separately)
  const { data: userStreaks, isLoading } = api.activityStreak.getUserStreaks.useQuery(
    undefined,
    {
      enabled: !!userData,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  );

  // Determine if we should show the popup
  const hasUnclaimedRewards =
    userStreaks?.streaks.some((s) => s.canClaimToday) ?? false;
  const needsCatchUp = userStreaks?.streaks.some((s) => s.needsCatchUp) ?? false;
  const hasRecurringToEnroll = !!userStreaks?.activeRecurringConfig;
  const shouldShowPopup = hasUnclaimedRewards || needsCatchUp || hasRecurringToEnroll;

  useEffect(() => {
    setIsModalOpen((isOpen) =>
      resolveActivityStreakPopupOpen({
        isOpen,
        isLoading,
        shouldShowPopup,
        dismissedToday,
        userClosed,
        tutorialActive,
      }),
    );
  }, [isLoading, shouldShowPopup, dismissedToday, userClosed, tutorialActive]);

  // This popup blocks the overworld arrival prompt while it is on screen OR while its
  // show-decision is still loading — the latter closes a fresh-login race where the arrival
  // prompt would otherwise open in the gap before this dialog mounts. Gated on `userClosed`
  // so that once the user closes it, the arrival prompt is free to fire.
  const isBlocking = isActivityStreakPopupBlocking(!!userData, {
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

  // Don't render anything if no user, loading, dismissed today, or no rewards
  if (!userData || !isModalOpen) {
    return null;
  }

  return (
    <Dialog open={isModalOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className={cn("max-w-2xl", "max-h-[90vh] overflow-y-auto")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-primary" />
            Daily Activity Rewards
          </DialogTitle>
          <DialogDescription className="sr-only">
            View and claim your daily activity rewards
          </DialogDescription>
        </DialogHeader>

        <ActivityStreakPanel />

        <div className="flex justify-between gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={handleDismissForToday}>
            <BellOff className="mr-2 h-4 w-4" />
            Dismiss for today
          </Button>
          <Button variant="outline" onClick={handleClose}>
            <X className="mr-2 h-4 w-4" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ActivityStreakPopup;
