"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { addUserInteractionListeners, isSafariOrIOS } from "@/utils/audio";

interface UseAudioOptions {
  src: string;
  loop?: boolean;
  volume?: number;
  preload?: "none" | "metadata" | "auto";
  enabled?: boolean; // Whether audio should be enabled/disabled
  autoPlay?: boolean; // Whether to auto-play when enabled
}

interface UseAudioReturn {
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  canPlay: boolean;
  requiresInteraction: boolean;
  enabled: boolean;
  toggle: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setVolume: (volume: number) => void;
}

/**
 * Custom hook for handling audio playback with Safari/iOS compatibility
 * Handles autoplay restrictions, user interaction requirements, and state management
 */
export const useAudio = (options: UseAudioOptions): UseAudioReturn => {
  const {
    src,
    loop = true,
    volume = 0.5,
    preload = "metadata",
    enabled = true,
    autoPlay = true,
  } = options;

  // Safari works better with "auto" preload
  const effectivePreload = isSafariOrIOS() ? "auto" : preload;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canPlay, setCanPlay] = useState(false);
  const [requiresInteraction, setRequiresInteraction] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(enabled);

  // Internal play function
  const playAudio = useCallback(async (): Promise<void> => {
    if (!audioRef.current || !canPlay) return;

    try {
      await audioRef.current.play();
      setRequiresInteraction(false);
    } catch (error) {
      // Check if it's an autoplay restriction
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setRequiresInteraction(true);
        throw new Error("User interaction required to play audio");
      } else {
        setError("Failed to play audio");
        throw error;
      }
    }
  }, [canPlay]);

  // Internal pause function
  const pauseAudio = useCallback((): void => {
    if (!audioRef.current) return;
    audioRef.current.pause();
  }, []);

  // Initialize audio element
  useEffect(() => {
    if (!src) return;

    const audio = new Audio();
    audio.src = src;
    audio.loop = loop;
    audio.volume = volume;
    audio.preload = effectivePreload;

    // Handle loading states
    const handleLoadStart = () => {
      setIsLoading(true);
    };

    const handleLoadedMetadata = () => {
      // Metadata loaded
    };

    const handleCanPlay = () => {
      setIsLoading(false);
      setCanPlay(true);
      setError(null);
    };

    const handleCanPlayThrough = () => {
      setIsLoading(false);
      setCanPlay(true);
      setError(null);
    };

    const handleError = () => {
      setIsLoading(false);
      setError("Failed to load audio");
    };

    // Handle play/pause events
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);

    // Safari fallback: track if canPlay has been handled to avoid stale closure issues
    let canPlayHandled = false;
    const wrappedHandleCanPlay = () => {
      canPlayHandled = true;
      handleCanPlay();
    };

    // Safari fallback: if loading events don't fire within 5 seconds, assume ready
    const safariTimeout = setTimeout(() => {
      if (isSafariOrIOS() && !canPlayHandled) {
        canPlayHandled = true;
        setIsLoading(false);
        setCanPlay(true);
        setError(null);
      }
    }, 5000);

    // Add event listeners - Safari needs both canplay and canplaythrough
    audio.addEventListener("loadstart", handleLoadStart);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("canplay", wrappedHandleCanPlay); // Safari often fires this before canplaythrough
    audio.addEventListener("canplaythrough", handleCanPlayThrough);
    audio.addEventListener("error", handleError);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);

    audioRef.current = audio;

    // Test autoplay capability
    const testAutoplay = async () => {
      try {
        await audio.play();
        audio.pause();
        setRequiresInteraction(false);
      } catch {
        setRequiresInteraction(true);
      }
    };

    // Safari/iOS always requires interaction
    if (isSafariOrIOS()) {
      setRequiresInteraction(true);
    } else {
      void testAutoplay();
    }

    // Cleanup
    return () => {
      clearTimeout(safariTimeout);
      audio.removeEventListener("loadstart", handleLoadStart);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("canplay", wrappedHandleCanPlay);
      audio.removeEventListener("canplaythrough", handleCanPlayThrough);
      audio.removeEventListener("error", handleError);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);

      audio.pause();
      audio.src = "";
    };
  }, [src, loop, volume, effectivePreload]);

  // Handle audio playback based on enabled state
  useEffect(() => {
    if (!canPlay) return;

    if (audioEnabled && autoPlay && !isPlaying) {
      // Try to play audio
      playAudio().catch(() => {
        // This is expected on Safari/iOS - user interaction will be required
      });
    } else if (!audioEnabled && isPlaying) {
      // Pause audio when disabled
      pauseAudio();
    }
  }, [
    audioEnabled,
    canPlay,
    isPlaying,
    playAudio,
    pauseAudio,
    autoPlay,
    requiresInteraction,
  ]);

  // Set up user interaction listeners for Safari/iOS
  useEffect(() => {
    if (!requiresInteraction || !audioEnabled || !canPlay) return;

    const cleanup = addUserInteractionListeners(() => {
      if (audioEnabled && !isPlaying && canPlay) {
        void playAudio().catch(() => {
          // User interaction failed - audio might not be supported
        });
      }
    });

    cleanupRef.current = cleanup;
    return cleanup;
  }, [requiresInteraction, audioEnabled, isPlaying, playAudio, canPlay]);

  // Toggle function - this IS a user interaction, so should work on Safari
  const toggle = useCallback(async (): Promise<void> => {
    const newState = !audioEnabled;
    setAudioEnabled(newState);

    if (newState && canPlay) {
      // Toggle is a user interaction, so this should work on Safari
      try {
        await playAudio();
      } catch {
        // Even user interaction failed - might be a deeper issue
        setRequiresInteraction(true);
      }
    } else if (!newState) {
      pauseAudio();
    }
  }, [audioEnabled, canPlay, playAudio, pauseAudio]);

  // Set enabled function
  const setEnabled = useCallback(
    async (enabled: boolean): Promise<void> => {
      setAudioEnabled(enabled);

      // If enabling and we can play, try to start immediately
      if (enabled && canPlay && autoPlay && !isPlaying) {
        try {
          await playAudio();
        } catch {
          // Audio failed to start
        }
      }
    },
    [canPlay, autoPlay, isPlaying, playAudio],
  );

  // Set volume function
  const setVolume = useCallback((newVolume: number): void => {
    if (!audioRef.current) return;

    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    audioRef.current.volume = clampedVolume;
  }, []);

  // Update enabled state when options change
  useEffect(() => {
    setAudioEnabled(enabled);
  }, [enabled]);

  return {
    isPlaying,
    isLoading,
    error,
    canPlay,
    requiresInteraction,
    enabled: audioEnabled,
    toggle,
    setEnabled,
    setVolume,
  };
};
