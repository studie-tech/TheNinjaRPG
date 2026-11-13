"use client";

import type React from "react";
import { api } from "@/app/_trpc/client";
import Loader from "@/layout/Loader";
import NindoChange from "@/layout/NindoChange";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

/**
 * Nindo change component
 */
export const OwnNindoChange: React.FC = () => {
  // State
  const { data: userData } = useRequiredUserDataSelector((u) => ({ userId: u.userId }));
  const utils = api.useUtils();

  // Mutations
  const { mutate, isPending: isUpdating } = api.profile.updateNindo.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getNindo.invalidate();
      }
    },
  });

  if (isUpdating) return <Loader explanation="Updating" />;
  if (!userData) return <Loader explanation="Loading profile..." />;

  return (
    <NindoChange
      userId={userData.userId}
      onChange={(data) => mutate({ userId: userData.userId, content: data.content })}
    />
  );
};
