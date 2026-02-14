"use client";

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

  // Mutations
  const { mutate: updateStats } = api.profile.useUnusedExperiencePoints.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success && result.data) {
        await updateUser(result.data);
        if (result.data.earnedExperience <= 0) {
          await updateNotifications(
            notifications?.filter((n) => !n.name.includes("Assign XP")),
          );
        }
      }
    },
  });

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;

  // Show component
  return (
    <DistributeStatsForm
      id="tutorial-unassigned-stats-contentbox"
      userData={userData}
      onAccept={updateStats}
      availableStats={userData.earnedExperience}
      title="Assign Experience Points"
      subtitle={`You have ${userData.earnedExperience.toLocaleString()} unused experience points`}
      defaultBackHref="/profile"
    />
  );
}
