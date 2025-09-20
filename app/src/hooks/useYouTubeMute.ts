import { useState, useEffect, useCallback } from "react";
import { 
  initYouTubeMuteObserver, 
  getYouTubeMuteObserver, 
  setYouTubeMuteState,
  muteAllYouTubeVideos,
  unmuteAllYouTubeVideos
} from "@/utils/audio";
import { useUserData } from "@/utils/UserContext";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";

interface UseYouTubeMuteReturn {
  isYouTubeMuted: boolean;
  setYouTubeMuted: (muted: boolean) => void;
  toggleYouTubeMute: () => void;
}

/**
 * Hook for managing YouTube video muting state
 * Integrates with user database and localStorage fallback
 */
export const useYouTubeMute = (): UseYouTubeMuteReturn => {
  const { data: userData } = useUserData();
  const [isYouTubeMuted, setIsYouTubeMuted] = useState<boolean>(false);

  // Get initial mute state from user data or localStorage
  const getInitialYouTubeMuteState = (): boolean => {
    // Respect explicit user preference when logged in
    if (userData && typeof userData.youtubeMuted === "boolean") return userData.youtubeMuted;
    
    // Fallback to locally saved preference
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("youtubeMuted");
      if (saved !== null) return JSON.parse(saved) as boolean;
    }
    
    return false;
  };

  // Initialize state on mount
  useEffect(() => {
    const initialMuteState = getInitialYouTubeMuteState();
    setIsYouTubeMuted(initialMuteState);
    
    // Initialize the observer with the current mute state
    const observer = initYouTubeMuteObserver(initialMuteState);
    
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

  // Set YouTube muted state
  const setYouTubeMuted = useCallback((muted: boolean) => {
    setIsYouTubeMuted(muted);
    
    // Update all existing YouTube videos
    setYouTubeMuteState(muted);
    
    // Update observer state
    const observer = getYouTubeMuteObserver();
    if (observer) {
      observer.setMuted(muted);
    }

    // Save to database if user is logged in, otherwise localStorage
    if (userData) {
      updatePreferences({
        preferredStat: userData.preferredStat ?? null,
        preferredGeneral1: userData.preferredGeneral1 ?? null,
        preferredGeneral2: userData.preferredGeneral2 ?? null,
        youtubeMuted: muted,
      });
    } else if (typeof window !== "undefined") {
      localStorage.setItem("youtubeMuted", JSON.stringify(muted));
    }
  }, [userData, updatePreferences]);

  // Toggle YouTube mute state
  const toggleYouTubeMute = useCallback(() => {
    setYouTubeMuted(!isYouTubeMuted);
  }, [isYouTubeMuted, setYouTubeMuted]);

  return {
    isYouTubeMuted,
    setYouTubeMuted,
    toggleYouTubeMute,
  };
};
