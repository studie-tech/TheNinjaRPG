import { useCallback, useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { observeUserIframes, setIframeMuteState } from "@/utils/audio";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";
import { useUserDataSelector } from "@/utils/UserContext";

interface UseIframeMuteReturn {
  isIframesMuted: boolean;
  setIframesMuted: (muted: boolean) => void;
}

/**
 * Hook for managing user iframe muting state
 * Integrates with user database and localStorage fallback
 */
export const useIframeMute = (): UseIframeMuteReturn => {
  const {
    data: userData,
    prepareUserUpdate,
    updateUser,
  } = useUserDataSelector((user) => ({
    preferredGeneral1: user.preferredGeneral1,
    preferredGeneral2: user.preferredGeneral2,
    iframesMuted: "iframesMuted" in user ? user.iframesMuted : undefined,
  }));
  const [isIframesMuted, setIsIframesMuted] = useState<boolean>(false);

  // Initialize state on mount
  useEffect(() => {
    const initialMuteState = getInitialIframeMuteState(userData);
    setIsIframesMuted(initialMuteState);

    // Mute iframes added from now on; existing ones keep their state until a toggle
    return observeUserIframes(initialMuteState);
  }, [userData]);

  // Update preferences mutation
  const { mutate: updatePreferences } = api.profile.updatePreferences.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (result, _input, revision) => {
      if (result.success) await updateUser(result, { revision });
      showMutationToast(result);
    },
  });

  // Set iframes muted state
  const setIframesMuted = useCallback(
    (muted: boolean) => {
      setIsIframesMuted(muted);

      setIframeMuteState(muted);

      // Save to database if user is logged in, otherwise localStorage
      if (userData) {
        updatePreferences({
          preferredGeneral1: userData.preferredGeneral1 ?? null,
          preferredGeneral2: userData.preferredGeneral2 ?? null,
          iframesMuted: muted,
        });
      } else {
        safeLocalStorageSetItem("iframesMuted", JSON.stringify(muted));
      }
    },
    [userData, updatePreferences],
  );

  return {
    isIframesMuted,
    setIframesMuted,
  };
};

/**
 * Get initial mute state from user data or localStorage
 * @param userData
 * @returns boolean
 */
const getInitialIframeMuteState = (
  userData: { iframesMuted?: boolean } | undefined,
): boolean => {
  // Respect explicit user preference when logged in
  if (typeof userData?.iframesMuted === "boolean") return userData.iframesMuted;

  // Fallback to locally saved preference
  const saved = safeLocalStorageGetItem("iframesMuted");
  if (saved !== null) return JSON.parse(saved) as boolean;

  return false;
};
