"use client";

import { LayoutTemplate, RefreshCw, Settings, Volume2, VolumeX } from "lucide-react";
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
import { api } from "@/app/_trpc/client";
import { NativeSettingsEntry } from "@/components/native/NativeSettingsEntry";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { BUTTON_CLICK_SFX_URLS, CONFETTI_SFX_URL } from "@/drizzle/constants";
import { useDayNightMapOverlays } from "@/hooks/day-night-overlay";
import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
  useLocalStorage,
} from "@/hooks/localstorage";
import { useAudio } from "@/hooks/useAudio";
import { useSelectGameLayout } from "@/hooks/useGameLayout";
import { useIframeMute } from "@/hooks/useIframeMute";
import { GameLayoutPicker } from "@/layout/GameLayoutPicker";
import Link from "@/layout/Link";
import { UncontrolledSliderField } from "@/layout/SliderField";
import {
  getAudioPreference,
  isLocalAudioSession,
  setLocalAudioPreference,
} from "@/libs/audioPreferences";
import {
  LIGHT_LAYOUT_STORAGE_KEY,
  SWAP_SIDEBARS_STORAGE_KEY,
} from "@/libs/layoutPreference";
import { getBackgroundMusicSrc } from "@/libs/music";
import { audioSession, platform } from "@/libs/native";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { playPreloadedAudio, preloadAudioBuffers } from "@/utils/audio";
import { useActiveLayout } from "@/utils/LayoutContext";

/** The settings page, which holds every game, profile and account setting. */
export const SETTINGS_HREF = "/profile?tab=edit";

/** Which part of the game settings to show: sound, layout and display, or both. */
export type GameSettingsSection = "all" | "audio" | "display";

interface GameSettingsProps {
  onNavigate?: () => void;
  section?: GameSettingsSection;
  userData?: UserWithRelations | null;
  updateUser?: (data: Partial<UserWithRelations>) => Promise<void>;
  trigger?: "audio" | "settings";
  triggerClassName?: string;
}

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

const getRandomButtonSfxUrl = () => {
  return BUTTON_CLICK_SFX_URLS[
    Math.floor(Math.random() * BUTTON_CLICK_SFX_URLS.length)
  ];
};

/**
 * Global context for sharing audio instance across all components
 */
const AudioContext = createContext<AudioContextValue | null>(null);

/**
 * Provider that creates and manages the singleton audio instance
 */
export const GlobalAudioProvider: React.FC<{
  children: ReactNode;
  userData?: UserWithRelations | null;
}> = ({ children, userData }) => {
  // Mount flag to keep SSR/CSR output in sync
  const [isClient, setIsClient] = useState(false);
  // Bridge calls are asynchronous. Serialising them keeps a music-off deactivation from
  // being overtaken by an earlier activation.
  const audioSessionQueue = useRef<Promise<void>>(Promise.resolve());
  const hasActiveAudioSession = useRef(false);
  // Remote Pause also works while Control Center is open and the WebView is visible.
  const isRemotePaused = useRef(false);
  const isMusicTurnedOff = useRef(false);
  const pauseVersion = useRef(0);
  // Release focus when playback is already stopped; transport Pause keeps Play available.
  const releaseAudioSession = (preserveControls = false) => {
    audioSessionQueue.current = audioSessionQueue.current
      .catch(() => undefined)
      .then(async () => {
        await audioSession.deactivate(preserveControls);
        hasActiveAudioSession.current = false;
      });
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

  const [buttonSfxOn, setButtonSfxOn] = useState<boolean>(() =>
    isClient ? getInitialButtonSfxState() : true,
  );
  const [sfxVolume, setSfxVolume] = useState<number>(() =>
    isClient ? getInitialSfxVolumeState() : 0.8,
  );

  // Battle, event, bloodline, outlaw or village theme (see getBackgroundMusicSrc)
  const musicSrc = getBackgroundMusicSrc(
    userData
      ? {
          villageName: userData.village?.name,
          isOutlaw: userData.isOutlaw,
          bloodlineId: userData.bloodlineId,
          inBattle: userData.status === "BATTLE",
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

  const savedMusicOn = userData?.musicOn;
  const savedButtonSfxOn = userData?.buttonSfxOn;

  // Sync saved preferences when those preferences actually change. Lock-screen controls
  // are transient playback commands, so an unrelated profile refresh must not overwrite
  // the local play/pause state they selected.
  useEffect(() => {
    if (!isClient) return;
    const shouldPlay = getInitialMusicState();
    isRemotePaused.current = false;
    isMusicTurnedOff.current = !shouldPlay;
    if (!shouldPlay) {
      pauseVersion.current += 1;
      if (!audioEnabled && !isPlaying) releaseAudioSession();
    }
    void setAudioEnabled(shouldPlay, true);
  }, [isClient, savedMusicOn]);

  useEffect(() => {
    if (!isClient) return;
    setButtonSfxOn(getInitialButtonSfxState());
  }, [isClient, savedButtonSfxOn]);

  // Claim the native media session once playback starts. iOS keeps it through incidental
  // WebView pauses so the player can resume without repeatedly changing the audio route.
  useEffect(() => {
    if (!isClient) return;
    audioSessionQueue.current = audioSessionQueue.current
      .catch(() => undefined)
      .then(async () => {
        if (!audioEnabled) {
          // WebKit can fire the background pause before our remote-command callback.
          // Keep Play available for either order, while releasing audio focus.
          const preserveControls =
            platform() === "ios" &&
            !isMusicTurnedOff.current &&
            (isRemotePaused.current || document.hidden);
          if (preserveControls && isPlaying) return;
          await audioSession.deactivate(preserveControls);
          hasActiveAudioSession.current = false;
          return;
        }
        if (!isPlaying && platform() !== "ios") {
          if (hasActiveAudioSession.current) {
            await audioSession.deactivate();
            hasActiveAudioSession.current = false;
          }
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
      audioSessionQueue.current = audioSessionQueue.current
        .catch(() => undefined)
        .then(async () => {
          await audioSession.deactivate(
            platform() === "ios" && isRemotePaused.current && !isMusicTurnedOff.current,
          );
          hasActiveAudioSession.current = false;
        });
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
        audioSessionQueue.current = audioSessionQueue.current
          .catch(() => undefined)
          .then(async () => {
            if (pauseVersion.current !== requestedPauseVersion) return;
            const activated = await audioSession.activate();
            if (!activated) return;
            if (
              pauseVersion.current !== requestedPauseVersion ||
              isMusicTurnedOff.current
            ) {
              await audioSession.deactivate(
                isRemotePaused.current && !isMusicTurnedOff.current,
              );
              hasActiveAudioSession.current = false;
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
    // The in-game switch is a preference change, not a transport pause.
    isRemotePaused.current = false;
    isMusicTurnedOff.current = !enabled;
    if (!enabled) {
      pauseVersion.current += 1;
      if (!audioEnabled && !isPlaying) releaseAudioSession();
    }
    return setAudioEnabled(enabled, true);
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
const useGlobalAudio = () => {
  const context = use(AudioContext);
  if (!context) {
    throw new Error("useGlobalAudio must be used within GlobalAudioProvider");
  }
  return context;
};

/**
 * Manage settings through the global audio instance and persisted preferences.
 */
export const useGameSettings = (
  userData?: UserWithRelations | null,
  updateUser?: GameSettingsProps["updateUser"],
) => {
  // Use the global audio instance
  const {
    audioEnabled,
    setAudioEnabled,
    buttonSfxOn,
    setButtonSfxOn,
    sfxVolume,
    setSfxVolume,
    requiresInteraction,
  } = useGlobalAudio();

  // Mount flag to keep SSR/CSR output in sync
  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, []);

  // SFX preference state
  const getInitialSfxState = (): boolean => {
    return getAudioPreference("sfxOn", userData?.sfxOn);
  };
  const [sfxOn, setSfxOn] = useState<boolean>(() =>
    isClient ? getInitialSfxState() : true,
  );

  // Light layout preference state
  const [lightLayout, setLightLayout] = useLocalStorage<boolean>(
    LIGHT_LAYOUT_STORAGE_KEY,
    false,
  );

  // Swapped sidebars apply immediately in every layout through GameLayoutController
  const [swapSidebars, setSwapSidebars] = useLocalStorage<boolean>(
    SWAP_SIDEBARS_STORAGE_KEY,
    false,
  );

  // Day/night map overlay preference (applies immediately, no refresh)
  const { showDayNightMapOverlays, setShowDayNightMapOverlays } =
    useDayNightMapOverlays();

  // Embedded iframe mute state
  const { isIframesMuted, setIframesMuted } = useIframeMute();

  // Sync saved SFX changes without overwriting a local toggle on unrelated profile refreshes.
  const savedSfxOn = userData?.sfxOn;
  useEffect(() => {
    if (!isClient) return;
    if (isLocalAudioSession()) {
      setSfxOn(getInitialSfxState());
      return;
    }
    if (typeof savedSfxOn === "boolean") {
      setSfxOn(savedSfxOn);
      // Non-React celebration playback reads the current account preference from storage.
      safeLocalStorageSetItem("sfxOn", JSON.stringify(savedSfxOn));
    } else {
      setSfxOn(safeLocalStorageGetItem("sfxOn") !== "false");
    }
  }, [isClient, savedSfxOn]);

  // Update preferences mutation
  const { mutate: updatePreferences } = api.profile.updatePreferences.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        showMutationToast(result);
      }
    },
  });

  const setSfxEnabled = (enabled: boolean) => {
    const isLocalPreference = setLocalAudioPreference("sfxOn", enabled);
    if (!isLocalPreference) {
      safeLocalStorageSetItem("sfxOn", JSON.stringify(enabled));
    }
    setSfxOn(enabled);
    if (userData && !isLocalPreference) {
      updatePreferences({
        preferredGeneral1: userData.preferredGeneral1 ?? null,
        preferredGeneral2: userData.preferredGeneral2 ?? null,
        sfxOn: enabled,
      });
      if (updateUser) {
        void updateUser({ sfxOn: enabled });
      }
    }
  };

  return {
    audioEnabled,
    setAudioEnabled,
    sfxOn,
    setSfxEnabled,
    buttonSfxOn,
    setButtonSfxOn,
    sfxVolume,
    setSfxVolume,
    lightLayout,
    setLightLayout,
    swapSidebars,
    setSwapSidebars,
    showDayNightMapOverlays,
    setShowDayNightMapOverlays,
    isIframesMuted,
    setIframesMuted,
    requiresInteraction,
    updatePreferences,
  };
};

/**
 * Shared settings content component
 */
interface GameSettingsContentProps extends GameSettingsProps {
  variant?: "panel" | "popover";
}

const GameSettingsContent: React.FC<GameSettingsContentProps> = ({
  userData,
  updateUser,
  variant = "panel",
  section = "all",
  onNavigate,
}) => {
  const {
    audioEnabled,
    setAudioEnabled,
    sfxOn,
    setSfxEnabled,
    buttonSfxOn,
    setButtonSfxOn,
    sfxVolume,
    setSfxVolume,
    lightLayout,
    setLightLayout,
    swapSidebars,
    setSwapSidebars,
    showDayNightMapOverlays,
    setShowDayNightMapOverlays,
    isIframesMuted,
    setIframesMuted,
    requiresInteraction,
    updatePreferences,
  } = useGameSettings(userData, updateUser);

  // Track initial lightLayout value to detect changes
  const [initialLightLayout] = useState<boolean>(lightLayout);
  const [lightLayoutChanged, setLightLayoutChanged] = useState(false);
  // Decorative chrome controls follow the rendered shell, including for signed-out visitors.
  const activeLayout = useActiveLayout();
  const isClassicLayout = activeLayout === "default";

  // Update tracking when lightLayout changes
  useEffect(() => {
    setLightLayoutChanged(isClassicLayout && lightLayout !== initialLightLayout);
  }, [lightLayout, initialLightLayout, isClassicLayout]);

  const handleRefreshPage = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  const handleMusicToggle = async (checked: boolean) => {
    // iOS can leave audio.play() pending; preference saving must not wait for it.
    void setAudioEnabled(checked);
    if (isLocalAudioSession()) return;
    if (userData) {
      updatePreferences({
        preferredGeneral1: userData.preferredGeneral1 ?? null,
        preferredGeneral2: userData.preferredGeneral2 ?? null,
        musicOn: checked,
      });
      if (updateUser) {
        await updateUser({ musicOn: checked });
      }
    } else {
      safeLocalStorageSetItem("musicOn", JSON.stringify(checked));
    }
  };

  const handleButtonSfxToggle = (checked: boolean) => {
    setButtonSfxOn(checked);
    if (setLocalAudioPreference("buttonSfxOn", checked)) return;
    if (userData) {
      updatePreferences({
        preferredGeneral1: userData.preferredGeneral1 ?? null,
        preferredGeneral2: userData.preferredGeneral2 ?? null,
        buttonSfxOn: checked,
      });
      if (updateUser) {
        void updateUser({ buttonSfxOn: checked });
      }
    } else {
      safeLocalStorageSetItem("buttonSfxOn", JSON.stringify(checked));
    }
  };

  const handleSfxVolumeChange = (nextValue: React.SetStateAction<number>) => {
    let percent: number;
    if (typeof nextValue === "function") {
      percent = nextValue(Math.round(sfxVolume * 100));
    } else {
      percent = nextValue;
    }
    const safePercent = Math.min(100, Math.max(0, percent));
    const newVolume = safePercent / 100;
    setSfxVolume(newVolume);
    safeLocalStorageSetItem("sfxVolume", JSON.stringify(newVolume));
  };

  const handleLayoutChange = useSelectGameLayout();

  const isPanel = variant === "panel";
  const sectionClass = isPanel ? "space-y-4" : "space-y-3";
  const textClass = isPanel ? "text-sm" : "text-xs text-muted-foreground";
  const headerClass = "text-lg font-bold";
  const showAudio = section !== "display";
  const showDisplay = section !== "audio";

  return (
    <div className={sectionClass}>
      {showAudio && (
        <>
          <div>
            <p className={headerClass}>Music</p>
            <div className="flex items-center justify-between">
              <div>
                <p className={textClass}>Background soundtrack</p>
                {isPanel && (
                  <p className="text-muted-foreground text-xs">
                    {audioEnabled ? "Playing" : "Paused"}
                  </p>
                )}
              </div>
              <Switch
                checked={!!audioEnabled}
                onCheckedChange={handleMusicToggle}
                aria-label="Toggle music"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <p className={textClass}>Nindo Audio</p>
                {isPanel && (
                  <p className="text-muted-foreground text-xs">
                    Embedded iframe audio control
                  </p>
                )}
              </div>
              <Switch
                checked={!isIframesMuted}
                onCheckedChange={(checked) => setIframesMuted(!checked)}
                aria-label="Toggle embedded iframe audio"
              />
            </div>
          </div>

          <div>
            <p className={headerClass}>Sound effects</p>
            <div className="flex items-center justify-between">
              <div>
                <p className={textClass}>Combat SFX</p>
                {isPanel && (
                  <p className="text-muted-foreground text-xs">
                    {sfxOn ? "Enabled" : "Disabled"}
                  </p>
                )}
              </div>
              <Switch
                checked={!!sfxOn}
                onCheckedChange={setSfxEnabled}
                aria-label="Toggle sound effects"
              />
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div>
                <p className={textClass}>Button SFX</p>
                {isPanel && (
                  <p className="text-muted-foreground text-xs">
                    {buttonSfxOn ? "Enabled" : "Disabled"}
                  </p>
                )}
              </div>
              <Switch
                checked={!!buttonSfxOn}
                onCheckedChange={handleButtonSfxToggle}
                aria-label="Toggle button sound effects"
              />
            </div>
          </div>

          {(sfxOn || buttonSfxOn) && (
            <div className="space-y-2">
              <div>
                <p className={textClass}>
                  {isPanel
                    ? "SFX Volume"
                    : `SFX Volume (${Math.round(sfxVolume * 100)}%)`}
                </p>
                {isPanel && (
                  <p className="text-muted-foreground text-xs">
                    Current volume: {Math.round(sfxVolume * 100)}%
                  </p>
                )}
              </div>
              <UncontrolledSliderField
                id="sfxVolume"
                label=""
                value={Math.round(sfxVolume * 100)}
                min={0}
                max={100}
                setValue={handleSfxVolumeChange}
              />
            </div>
          )}
        </>
      )}

      {showDisplay && (
        <>
          <div>
            {/* The settings page titles this section itself. */}
            {section === "all" && <p className={headerClass}>Display</p>}
            <div className="mb-4 space-y-2">
              <div className="flex items-start gap-2">
                <LayoutTemplate className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className={textClass}>Game Layout</p>
                </div>
              </div>
              <GameLayoutPicker
                layout={activeLayout}
                onLayoutChange={handleLayoutChange}
              />
              <Link
                href="/layouts"
                className="inline-flex min-h-11 items-center text-primary text-sm underline"
              >
                Explore game layouts
              </Link>
            </div>
            {isClassicLayout && (
              <div className="flex items-center justify-between">
                <div>
                  <p className={textClass}>Lighter Layout</p>
                  {isPanel && (
                    <p className="text-muted-foreground text-xs">
                      {lightLayout ? "Enabled" : "Disabled"}
                    </p>
                  )}
                </div>
                <Switch
                  checked={!!lightLayout}
                  onCheckedChange={setLightLayout}
                  aria-label="Toggle lighter layout"
                />
              </div>
            )}
            <div
              className={`flex items-center justify-between ${isClassicLayout ? "mt-3" : ""}`}
            >
              <div>
                <p className={textClass}>Day/night map overlays</p>
                {isPanel && (
                  <p className="text-muted-foreground text-xs">
                    {showDayNightMapOverlays ? "Enabled" : "Disabled"}
                  </p>
                )}
              </div>
              <Switch
                checked={!!showDayNightMapOverlays}
                onCheckedChange={setShowDayNightMapOverlays}
                aria-label="Toggle day/night map overlays"
              />
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div>
                <p className={textClass}>Swap sidebars</p>
                {isPanel && (
                  <p className="text-muted-foreground text-xs">
                    {swapSidebars
                      ? "Player and world panels on opposite sides"
                      : "Layout default"}
                  </p>
                )}
              </div>
              <Switch
                checked={!!swapSidebars}
                onCheckedChange={setSwapSidebars}
                aria-label="Swap sidebars"
              />
            </div>
            {lightLayoutChanged && (
              <div className={isPanel ? "mt-3" : "mt-2"}>
                <Button
                  onClick={handleRefreshPage}
                  variant="default"
                  size="sm"
                  className="w-full"
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {isPanel ? "Refresh to Apply Changes" : "Refresh to Apply"}
                </Button>
              </div>
            )}
          </div>

          <NativeSettingsEntry onNavigate={onNavigate} />
        </>
      )}

      {showAudio && requiresInteraction && audioEnabled && (
        <p
          className={
            isPanel
              ? "text-muted-foreground text-xs italic"
              : "text-[10px] text-muted-foreground"
          }
        >
          Audio requires interaction on this browser; click anywhere to start
        </p>
      )}
    </div>
  );
};

/**
 * Game settings panel component (for use in tabs, settings pages, etc.)
 */
export const GameSettingsPanel: React.FC<GameSettingsProps> = ({
  onNavigate,
  userData,
  updateUser,
  section,
}) => {
  return (
    <div className="p-4">
      <GameSettingsContent
        userData={userData}
        updateUser={updateUser}
        variant="panel"
        section={section}
        onNavigate={onNavigate}
      />
    </div>
  );
};

/**
 * Settings popover button (for use in navbar/header). With `section="audio"` it is a
 * quick sound switch that links to the full settings page.
 */
export const GameSettingsPopover: React.FC<GameSettingsProps> = ({
  userData,
  updateUser,
  trigger = "audio",
  triggerClassName,
  section,
}) => {
  const { audioEnabled } = useGameSettings(userData);
  const isSettingsTrigger = trigger === "settings";
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={isSettingsTrigger ? "Game settings" : "Audio settings"}
          className={
            triggerClassName ??
            "group/audio mx-1 inline-flex items-center justify-center rounded-full text-slate-700"
          }
        >
          <span
            className={
              triggerClassName
                ? undefined
                : "inline-flex rounded-full bg-blue-100 bg-opacity-80 group-hover/audio:bg-blue-300 group-hover/audio:text-black"
            }
          >
            {isSettingsTrigger ? (
              <Settings className="h-4 w-4" suppressHydrationWarning />
            ) : audioEnabled ? (
              <Volume2 className="h-6 w-6 p-1 xl:h-7 xl:w-7" suppressHydrationWarning />
            ) : (
              <VolumeX className="h-6 w-6 p-1 xl:h-7 xl:w-7" suppressHydrationWarning />
            )}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="max-h-[80dvh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto"
        sideOffset={8}
      >
        <GameSettingsContent
          userData={userData}
          updateUser={updateUser}
          variant="popover"
          section={section}
          onNavigate={() => setOpen(false)}
        />
        {section === "audio" && (
          <Link
            href={SETTINGS_HREF}
            onClick={() => setOpen(false)}
            className="text-primary mt-3 flex min-h-11 items-center gap-2 border-t pt-3 text-sm font-medium hover:underline"
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
            All settings
          </Link>
        )}
      </PopoverContent>
    </Popover>
  );
};
