"use client";

import { useAtomValue } from "jotai";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  use,
  useEffect,
  useRef,
  useState,
} from "react";
import { BUTTON_CLICK_SFX_URLS, CONFETTI_SFX_URL } from "@/drizzle/constants";
import { useAudio } from "@/hooks/useAudio";
import type { GameSettingsUser } from "@/layout/GameSettings";
import { getAudioPreference, setLocalAudioPreference } from "@/libs/audioPreferences";
import { getBackgroundMusicSrc } from "@/libs/music";
import { audioSession, platform } from "@/libs/native";
import { getRandomElement } from "@/utils/array";
import { createSerialQueue } from "@/utils/async";
import { playPreloadedAudio, preloadAudioBuffers } from "@/utils/audio";
import { safeLocalStorageGetItem } from "@/utils/storage";
import { combatThemeHeldAtom } from "@/utils/UserContext";

/**
 * Audio context value containing the singleton audio controls
 */
interface AudioContextValue {
  audioEnabled: boolean;
  setAudioEnabled: (enabled: boolean) => Promise<void>;
  buttonSfxOn: boolean;
  setButtonSfxOn: Dispatch<SetStateAction<boolean>>;
  sfxVolume: number;
  setSfxVolume: Dispatch<SetStateAction<number>>;
  requiresInteraction: boolean;
}

const BUTTON_SFX_VOLUME_MULTIPLIER = 0.45;
const BUTTON_SFX_TARGET_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "label[for]",
  '[role="button"]',
  '[role="menuitem"]',
  '[role="tab"]',
  "[data-slot='menubar-item']",
  "[data-slot='menubar-trigger']",
  "[data-button-sfx]",
].join(",");

const shouldPlayButtonSfxForTarget = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false;
  const interactive = target.closest<HTMLElement>(BUTTON_SFX_TARGET_SELECTOR);
  if (!interactive) return false;
  if (interactive.closest("[data-button-sfx='off'], [data-disable-button-sfx]")) {
    return false;
  }
  return (
    interactive.getAttribute("aria-disabled") !== "true" &&
    interactive.getAttribute("data-disabled") === null
  );
};

const getRandomButtonSfxUrl = () => getRandomElement(BUTTON_CLICK_SFX_URLS);

/**
 * Global context for sharing audio instance across all components
 */
const AudioContext = createContext<AudioContextValue | null>(null);

/**
 * Provider that creates and manages the singleton audio instance
 */
export const GlobalAudioProvider: React.FC<{
  children: ReactNode;
  userData?: GameSettingsUser | null;
}> = ({ children, userData }) => {
  // Mount flag to keep SSR/CSR output in sync
  const [isClient, setIsClient] = useState(false);
  // Bridge calls are asynchronous. Serialising them keeps a music-off deactivation from
  // being overtaken by an earlier activation.
  const enqueueAudioSession = useRef(createSerialQueue());
  const hasActiveAudioSession = useRef(false);
  // Remote Pause also works while Control Center is open and the WebView is visible.
  const isRemotePaused = useRef(false);
  const isMusicTurnedOff = useRef(false);
  const pauseVersion = useRef(0);
  // Runs inside a queued task; enqueueing from there would land behind later activations.
  const deactivateAudioSession = async (preserveControls = false) => {
    await audioSession.deactivate(preserveControls);
    hasActiveAudioSession.current = false;
  };
  // Release focus when playback is already stopped; transport Pause keeps Play available.
  const releaseAudioSession = (preserveControls = false) => {
    void enqueueAudioSession.current(() => deactivateAudioSession(preserveControls));
  };
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Get initial audio preference from user data or localStorage
  const getInitialMusicState = (): boolean => {
    return getAudioPreference("musicOn", userData?.musicOn);
  };

  const getInitialButtonSfxState = (): boolean => {
    return getAudioPreference("buttonSfxOn", userData?.buttonSfxOn);
  };

  const getInitialSfxVolumeState = (): number => {
    const saved = safeLocalStorageGetItem("sfxVolume");
    if (saved !== null) return JSON.parse(saved) as number;
    return 0.8;
  };

  // Post-mount effects load the saved values
  const [buttonSfxOn, setButtonSfxOn] = useState<boolean>(true);
  const [sfxVolume, setSfxVolume] = useState<number>(0.8);

  const combatThemeHeld = useAtomValue(combatThemeHeldAtom);
  // Battle, event, bloodline, outlaw or village theme (see getBackgroundMusicSrc)
  const musicSrc = getBackgroundMusicSrc(
    userData
      ? {
          villageName: userData.village?.name,
          isOutlaw: userData.isOutlaw,
          bloodlineId: userData.bloodlineId,
          inBattle: userData.status === "BATTLE" || combatThemeHeld,
        }
      : undefined,
  );

  // Initialize the single audio instance
  const {
    isPlaying,
    requiresInteraction,
    enabled: audioEnabled,
    setEnabled: setAudioEnabled,
  } = useAudio({
    src: musicSrc,
    loop: true,
    volume: 0.5,
    preload: "metadata",
    enabled: isClient ? getInitialMusicState() : false,
    autoPlay: isClient,
  });

  // A preference change, not a transport pause.
  const applyMusicPreference = (enabled: boolean) => {
    isRemotePaused.current = false;
    isMusicTurnedOff.current = !enabled;
    if (!enabled) {
      pauseVersion.current += 1;
      if (!audioEnabled && !isPlaying) releaseAudioSession();
    }
    return setAudioEnabled(enabled, true);
  };

  const savedMusicOn = userData?.musicOn;
  const savedButtonSfxOn = userData?.buttonSfxOn;

  // Sync saved preferences when those preferences actually change. Lock-screen controls
  // are transient playback commands, so an unrelated profile refresh must not overwrite
  // the local play/pause state they selected.
  useEffect(() => {
    if (!isClient) return;
    void applyMusicPreference(getInitialMusicState());
  }, [isClient, savedMusicOn]);

  useEffect(() => {
    if (!isClient) return;
    setButtonSfxOn(getInitialButtonSfxState());
  }, [isClient, savedButtonSfxOn]);

  // Claim the native media session once playback starts. iOS keeps it through incidental
  // WebView pauses so the player can resume without repeatedly changing the audio route.
  useEffect(() => {
    if (!isClient) return;
    void enqueueAudioSession.current(async () => {
      if (!audioEnabled) {
        // WebKit can fire the background pause before our remote-command callback.
        // Keep Play available for either order, while releasing audio focus.
        const preserveControls =
          platform() === "ios" &&
          !isMusicTurnedOff.current &&
          (isRemotePaused.current || document.hidden);
        if (preserveControls && isPlaying) return;
        await deactivateAudioSession(preserveControls);
        return;
      }
      if (!isPlaying && platform() !== "ios") {
        if (hasActiveAudioSession.current) await deactivateAudioSession();
        return;
      }
      if (!isPlaying) return;
      if (!hasActiveAudioSession.current) {
        hasActiveAudioSession.current = await audioSession.activate();
        if (!hasActiveAudioSession.current) return;
      }
      await audioSession.setNowPlaying({
        title: "TheNinja-RPG",
        artist: userData?.village?.name ?? "Seichi",
      });
    });
  }, [audioEnabled, isClient, isPlaying, userData?.village?.name]);

  useEffect(
    () => () => {
      releaseAudioSession(
        platform() === "ios" && isRemotePaused.current && !isMusicTurnedOff.current,
      );
    },
    [],
  );

  // Lock-screen and headset controls update the same state as the in-game toggle.
  useEffect(() => {
    if (!isClient) return;
    return audioSession.onRemoteCommand((command) => {
      // A delayed transport command must not undo an explicit Music-off preference.
      if (isMusicTurnedOff.current) return;
      if (platform() !== "ios") {
        if (command === "play") void setAudioEnabled(true);
        else if (command === "pause") void setAudioEnabled(false);
        else void setAudioEnabled(!audioEnabled);
        return;
      }
      if (command === "pause" || (command === "toggle" && audioEnabled)) {
        isRemotePaused.current = true;
        isMusicTurnedOff.current = false;
        pauseVersion.current += 1;
        if (!audioEnabled && !isPlaying) releaseAudioSession(true);
        void setAudioEnabled(false);
      } else {
        const requestedPauseVersion = pauseVersion.current;
        // WebKit grants a playback gesture only while its media action handler runs.
        // Start the audio before asynchronous bridge work; keep native session changes
        // serialised so a later Pause or Music Off still wins.
        isRemotePaused.current = false;
        void setAudioEnabled(true);
        void enqueueAudioSession.current(async () => {
          if (pauseVersion.current !== requestedPauseVersion) return;
          const activated = await audioSession.activate();
          if (!activated) return;
          if (
            pauseVersion.current !== requestedPauseVersion ||
            isMusicTurnedOff.current
          ) {
            await deactivateAudioSession(
              isRemotePaused.current && !isMusicTurnedOff.current,
            );
            return;
          }
          hasActiveAudioSession.current = true;
        });
      }
    });
  }, [audioEnabled, isClient, setAudioEnabled]);

  useEffect(() => {
    if (!isClient) return;
    setSfxVolume(getInitialSfxVolumeState());
    void preloadAudioBuffers([...BUTTON_CLICK_SFX_URLS, CONFETTI_SFX_URL]);
  }, [isClient]);

  useEffect(() => {
    if (!isClient || !buttonSfxOn) return;

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0 || !shouldPlayButtonSfxForTarget(event.target)) return;
      const url = getRandomButtonSfxUrl();
      if (!url) return;
      void playPreloadedAudio(url, sfxVolume * BUTTON_SFX_VOLUME_MULTIPLIER);
    };

    document.addEventListener("click", handleClick, { capture: true });
    return () => document.removeEventListener("click", handleClick, { capture: true });
  }, [isClient, buttonSfxOn, sfxVolume]);

  const setMusicEnabled = (enabled: boolean) => {
    setLocalAudioPreference("musicOn", enabled);
    return applyMusicPreference(enabled);
  };

  const contextValue: AudioContextValue = {
    audioEnabled,
    setAudioEnabled: setMusicEnabled,
    buttonSfxOn,
    setButtonSfxOn,
    sfxVolume,
    setSfxVolume,
    requiresInteraction,
  };

  return <AudioContext value={contextValue}>{children}</AudioContext>;
};

/**
 * Hook to access the global audio instance
 */
export const useGlobalAudio = () => {
  const context = use(AudioContext);
  if (!context) {
    throw new Error("useGlobalAudio must be used within GlobalAudioProvider");
  }
  return context;
};
