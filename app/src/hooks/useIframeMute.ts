import { useState, useEffect, useCallback } from "react";
import {
  initIframeMuteObserver,
  getIframeMuteObserver,
  setIframeMuteState,
} from "@/utils/audio";
import { useUserData } from "@/utils/UserContext";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/api/routers/profile";

interface UseIframeMuteReturn {
  isIframesMuted: boolean;
  setIframesMuted: (muted: boolean) => void;
  toggleIframesMute: () => void;
}

/**
 * Get initial mute state from user data or localStorage
 * @param userData
 * @returns boolean
 */
const getInitialIframeMuteState = (
  userData: UserWithRelations | undefined,
): boolean => {
  // Respect explicit user preference when logged in
  if (userData && typeof userData === "object" && userData !== undefined) {
    const record = userData as unknown as {
      iframesMuted?: unknown;
    };
    if (typeof record.iframesMuted === "boolean") return record.iframesMuted;
  }

  // Fallback to locally saved preference
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem("iframesMuted");
    if (saved !== null) return JSON.parse(saved) as boolean;
  }

  return false;
};

/**
 * Hook for managing user iframe muting state
 * Integrates with user database and localStorage fallback
 */
export const useIframeMute = (): UseIframeMuteReturn => {
  const { data: userData } = useUserData();
  const [isIframesMuted, setIsIframesMuted] = useState<boolean>(false);

  // Initialize state on mount
  useEffect(() => {
    const initialMuteState = getInitialIframeMuteState(userData);
    setIsIframesMuted(initialMuteState);

    // Initialize the observer with the current mute state
    const observer = initIframeMuteObserver(initialMuteState);

    // Cleanup on unmount
    return () => {
      observer.stop();
    };
  }, [userData]);

  // Update preferences mutation
  const { mutate: updatePreferences } = api.profile.updatePreferences.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
    },
  });

  // Set iframes muted state
  const setIframesMuted = useCallback(
    (muted: boolean) => {
      setIsIframesMuted(muted);

      // Update all existing user iframes
      setIframeMuteState(muted);

      // Update observer state
      const observer = getIframeMuteObserver();
      if (observer) {
        observer.setMuted(muted);
      }

      // Save to database if user is logged in, otherwise localStorage
      if (userData) {
        updatePreferences({
          preferredStat: userData.preferredStat ?? null,
          preferredGeneral1: userData.preferredGeneral1 ?? null,
          preferredGeneral2: userData.preferredGeneral2 ?? null,
          iframesMuted: muted,
        });
      } else if (typeof window !== "undefined") {
        localStorage.setItem("iframesMuted", JSON.stringify(muted));
      }
    },
    [userData, updatePreferences],
  );

  // Toggle iframes mute state
  const toggleIframesMute = useCallback(() => {
    setIframesMuted(!isIframesMuted);
  }, [isIframesMuted, setIframesMuted]);

  return {
    isIframesMuted,
    setIframesMuted,
    toggleIframesMute,
  };
};
