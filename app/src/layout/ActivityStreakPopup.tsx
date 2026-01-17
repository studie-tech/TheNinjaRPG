"use client";

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useUserData } from "@/utils/UserContext";
import { api } from "@/app/_trpc/client";
import { cn } from "@/libs/shadui";
import { useLocalStorage } from "@/hooks/localstorage";
import { getDateKey } from "@/utils/time";
import { Gift, X, BellOff } from "lucide-react";
import ActivityStreakPanel from "@/layout/ActivityStreakPanel";

/** Get today's date as a string for localStorage key */
const getTodayKey = () => {
  return `streakPopupDismissedX-${getDateKey(new Date())}`;
};

const ActivityStreakPopup: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  // Track if user has explicitly dismissed the popup for today
  const [dismissedToday, setDismissedToday] = useLocalStorage<boolean>(
    getTodayKey(),
    false,
  );

  // Query
  const { data: userData } = useUserData();

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
  const hasRecurringToEnroll = !!userStreaks?.activeRecurringConfig;
  const shouldShowPopup = hasUnclaimedRewards || hasRecurringToEnroll;

  // Show modal when there are unclaimed rewards and user hasn't dismissed today
  useEffect(() => {
    if (!isLoading && shouldShowPopup && !dismissedToday) {
      setIsModalOpen(true);
    }
  }, [isLoading, shouldShowPopup, dismissedToday]);

  // Handle simple close - just close the dialog, will show again on refresh
  const handleClose = () => {
    setIsModalOpen(false);
  };

  // Handle dismiss for today - won't show again until tomorrow
  const handleDismissForToday = () => {
    setDismissedToday(true);
    setIsModalOpen(false);
  };

  // Don't render anything if no user, loading, dismissed today, or no rewards
  if (!userData || isLoading || dismissedToday || !shouldShowPopup) {
    return null;
  }

  return (
    <>
      {isModalOpen && (
        <Dialog open={isModalOpen} onOpenChange={(open) => !open && handleClose()}>
          <DialogContent className={cn("max-w-2xl", "overflow-y-auto max-h-[90vh]")}>
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

            <div className="flex justify-between pt-2 gap-2">
              <Button variant="ghost" size="sm" onClick={handleDismissForToday}>
                <BellOff className="h-4 w-4 mr-2" />
                Dismiss for today
              </Button>
              <Button variant="outline" onClick={handleClose}>
                <X className="h-4 w-4 mr-2" />
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};

export default ActivityStreakPopup;
