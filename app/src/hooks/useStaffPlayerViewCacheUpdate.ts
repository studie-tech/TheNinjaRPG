import { useQueryClient } from "@tanstack/react-query";
import { trpcPathFromKey } from "@/libs/queryTelemetry";
import { useUserInfo } from "@/utils/UserContext";

/** Reconcile content filtered by the saved player view, including omitted profile relations. */
export const useStaffPlayerViewCacheUpdate = () => {
  const client = useQueryClient();
  const { updateUser, refreshUser } = useUserInfo();

  /** Apply the saved preference and reload content that cannot be recovered from cached rows. */
  const updatePlayerView = async (playsAsPlayer: boolean) => {
    await updateUser({ playsAsPlayer });
    // Changing the view can hide or restore quest history and concealed locations.
    await Promise.all([
      refreshUser(),
      client.invalidateQueries({
        predicate: (query) => trpcPathFromKey(query.queryKey) !== "profile.getUser",
      }),
    ]);
  };

  return { updatePlayerView };
};
