"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { platform } from "@/libs/native";
import { addUserInteractionListeners, isSafariOrIOS } from "@/utils/audio";

const FADE_OUT_MS = 700;
const FADE_STEP_MS = 40;

/** Stop and unload an element; one still playing fades, so a track change is not a cut. */
const retireAudio = (audio: HTMLAudioElement) => {
  const unload = () => {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  };
  if (audio.paused || audio.volume === 0) return unload();
  const step = (audio.volume * FADE_STEP_MS) / FADE_OUT_MS;
  const startedAt = Date.now();
  const fade = setInterval(() => {
    audio.volume = Math.max(0, audio.volume - step);
    // Platforms with fixed media volume still stop on time, as theirs never lands.
    if (audio.volume > 0 && Date.now() - startedAt < FADE_OUT_MS) return;
    clearInterval(fade);
    unload();
  }, FADE_STEP_MS);
};

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
  requiresInteraction: boolean;
  enabled: boolean;
  setEnabled: (enabled: boolean, isPreferenceChange?: boolean) => Promise<void>;
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
  const isSourceDetached = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [canPlay, setCanPlay] = useState(false);
  const [requiresInteraction, setRequiresInteraction] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(enabled);

  // Internal play function
  const playAudio = useCallback(
    async (allowLoading = false): Promise<void> => {
      if (!audioRef.current || (!canPlay && !allowLoading)) return;

      try {
        await audioRef.current.play();
        setRequiresInteraction(false);
      } catch (error) {
        // Check if it's an autoplay restriction
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          setRequiresInteraction(true);
          throw new Error("User interaction required to play audio");
        } else {
          throw error;
        }
      }
    },
    [canPlay],
  );

  // Internal pause function
  const pauseAudio = useCallback((): void => {
    if (!audioRef.current) return;
    audioRef.current.pause();
  }, []);

  // Initialize audio element
  useEffect(() => {
    setIsPlaying(false);
    setCanPlay(false);
    if (!src) return;

    const audio = new Audio();
    if (!isSourceDetached.current) audio.src = src;
    audio.loop = loop;
    audio.volume = volume;
    audio.preload = effectivePreload;

    // Handle play/pause events
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => {
      setIsPlaying(false);
      // Yield when another app takes background audio, including Android WebView.
      // Retrying would steal its focus back. Foreground native-session startup can
      // also pause playback, so keep that retry and the saved Music preference.
      if ((isSafariOrIOS() || platform() === "android") && document.hidden) {
        setAudioEnabled(false);
      }
    };
    const handleEnded = () => setIsPlaying(false);

    // Safari fallback: track if canPlay has been handled to avoid stale closure issues
    let canPlayHandled = false;
    /** Share readiness updates between media events and Safari's fallback timer. */
    const markReady = () => {
      canPlayHandled = true;
      setCanPlay(true);
    };

    // Safari fallback: if loading events don't fire within 5 seconds, assume ready
    const safariTimeout = setTimeout(() => {
      if (isSafariOrIOS() && !canPlayHandled && !isSourceDetached.current) markReady();
    }, 5000);

    // Add event listeners - Safari needs both canplay and canplaythrough
    audio.addEventListener("canplay", markReady); // Safari often fires this before canplaythrough
    audio.addEventListener("canplaythrough", markReady);
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
    } else if (enabled && autoPlay) {
      // Probing autoplay starts real playback, so respect the disabled preference here too.
      void testAutoplay();
    }

    // Cleanup
    return () => {
      clearTimeout(safariTimeout);
      audio.removeEventListener("canplay", markReady);
      audio.removeEventListener("canplaythrough", markReady);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);

      audioRef.current = null;
      retireAudio(audio);
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

    return addUserInteractionListeners(() => {
      if (audioEnabled && !isPlaying && canPlay) {
        void playAudio().catch(() => {
          // User interaction failed - audio might not be supported
        });
      }
    });
  }, [requiresInteraction, audioEnabled, isPlaying, playAudio, canPlay]);

  // Set enabled function
  const setEnabled = useCallback(
    async (enabled: boolean, isPreferenceChange = false): Promise<void> => {
      setAudioEnabled(enabled);
      const audio = audioRef.current;

      if (!enabled && isPreferenceChange) {
        isSourceDetached.current = true;
        // WebKit excludes muted media from Now Playing, even while unloading its source.
        if (audio) audio.muted = true;
        audio?.pause();
        audio?.removeAttribute("src");
        audio?.load();
        setCanPlay(false);
        return;
      }

      if (enabled && isSourceDetached.current) {
        isSourceDetached.current = false;
        if (audio) {
          audio.muted = false;
          audio.src = src;
          audio.load();
          if (autoPlay) {
            // Start during the switch gesture; waiting for canplay loses iOS permission.
            try {
              await playAudio(true);
            } catch {
              // Audio failed to start; the interaction listener can retry.
            }
          }
        }
        return;
      }

      // If enabling and we can play, try to start immediately
      if (enabled && canPlay && autoPlay && !isPlaying) {
        try {
          await playAudio();
        } catch {
          // Audio failed to start
        }
      }
    },
    [canPlay, autoPlay, isPlaying, playAudio, src],
  );

  // Update enabled state when options change
  useEffect(() => {
    setAudioEnabled(enabled);
  }, [enabled]);

  return {
    isPlaying,
    requiresInteraction,
    enabled: audioEnabled,
    setEnabled,
  };
};
