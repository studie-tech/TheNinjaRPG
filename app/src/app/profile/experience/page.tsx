"use client";

import { useRef } from "react";
import { api } from "@/app/_trpc/client";
import Loader from "@/layout/Loader";
import DistributeStatsForm from "@/layout/StatsDistributionForm";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";

export default function AssignExperience() {
  // State
  const {
    data: userData,
    notifications,
    updateUser,
    updateNotifications,
  } = useRequiredUserData();
  const submissionInFlight = useRef(false);
  const latestNotifications = useRef(notifications);
  latestNotifications.current = notifications;

  // Mutations
  const { mutateAsync: updateStats, isPending } =
    api.profile.useUnusedExperiencePoints.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success && result.data) {
          await updateUser(result.data);
          if (result.data.earnedExperience <= 0) {
            await updateNotifications(
              latestNotifications.current?.filter(
                (notification) => !notification.name.includes("Assign XP"),
              ),
            );
          }
        }
      },
    });

  const submitStats = async (data: Parameters<typeof updateStats>[0]) => {
    if (submissionInFlight.current) return;

    submissionInFlight.current = true;
    try {
      await updateStats(data);
    } catch {
      // The shared tRPC error handler reports failures; retain the current draft.
    } finally {
      submissionInFlight.current = false;
    }
  };

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;

  // Show component
  return (
    <DistributeStatsForm
      id="tutorial-unassigned-stats-contentbox"
      userData={userData}
      onAccept={submitStats}
      availableStats={userData.earnedExperience}
      title="Assign Experience Points"
      subtitle={`You have ${userData.earnedExperience.toLocaleString()} unused experience points`}
      defaultBackHref="/profile"
      isPending={isPending}
      pendingLabel="Assigning"
    />
  );
}
