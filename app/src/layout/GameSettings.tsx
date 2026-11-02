"use client";

import { RefreshCw, Settings, Volume2, VolumeX } from "lucide-react";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  use,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { api } from "@/app/_trpc/client";
import { NativeSettingsEntry } from "@/components/native/NativeSettingsEntry";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BUTTON_CLICK_SFX_URLS, CONFETTI_SFX_URL } from "@/drizzle/constants";
import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
  useLocalStorage,
} from "@/hooks/localstorage";
import { useAudio } from "@/hooks/useAudio";
import { useSelectGameLayout } from "@/hooks/useGameLayout";
import { useIframeMute } from "@/hooks/useIframeMute";
import { useVisualEffects } from "@/hooks/visual-effects";
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

/** Audio and preference fields consumed by settings and playback. */
export type GameSettingsUser = Pick<
  NonNullable<UserWithRelations>,
  | "musicOn"
  | "buttonSfxOn"
  | "sfxOn"
  | "village"
  | "isOutlaw"
  | "bloodlineId"
  | "status"
  | "preferredGeneral1"
  | "preferredGeneral2"
>;

/** The profile page that contains game, profile and account settings. */
export const SETTINGS_HREF = "/profile?tab=edit";

type GameSettingsSection = "all" | "audio" | "display" | "effects";

interface GameSettingsProps {
  onNavigate?: () => void;
  section?: GameSettingsSection;
  userData?: GameSettingsUser | null;
  updateUser?: (data: Partial<UserWithRelations>) => Promise<unknown>;
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
  userData?: GameSettingsUser | null;
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
  userData?: GameSettingsUser | null,
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
    isIframesMuted,
    setIframesMuted,
    requiresInteraction,
    updatePreferences,
  };
};

/**
 * Shared settings content component
 */
const GameSettingsContent: React.FC<GameSettingsProps> = ({
  userData,
  updateUser,
  onNavigate,
  section = "all",
}) => {
  const sfxVolumeId = useId();
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
    isIframesMuted,
    setIframesMuted,
    requiresInteraction,
    updatePreferences,
  } = useGameSettings(userData, updateUser);

  const [settingsTab, setSettingsTab] = useLocalStorage<string>(
    "gameSettingsTab",
    "audio",
  );
  const activeSettingsTab = ["audio", "layout", "effects"].includes(settingsTab)
    ? settingsTab
    : "audio";

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

  const sections = {
    audio: (
      <div className="space-y-3 pt-2">
        <p className="text-base font-semibold">Audio</p>
        <div className="divide-border/50 divide-y">
          <SettingsToggle
            label="Music"
            description="Background soundtrack"
            checked={!!audioEnabled}
            onCheckedChange={handleMusicToggle}
          />
          <SettingsToggle
            label="Nindo audio"
            description="Embedded profile audio"
            checked={!isIframesMuted}
            onCheckedChange={(checked) => setIframesMuted(!checked)}
          />
          <SettingsToggle
            label="Combat sounds"
            checked={!!sfxOn}
            onCheckedChange={setSfxEnabled}
          />
          <SettingsToggle
            label="Button sounds"
            checked={!!buttonSfxOn}
            onCheckedChange={handleButtonSfxToggle}
          />
        </div>
        {(sfxOn || buttonSfxOn) && (
          <div className="space-y-2 pb-2">
            <label htmlFor={sfxVolumeId} className="block text-sm">
              Effects volume{" "}
              <span className="text-muted-foreground float-right tabular-nums">
                {Math.round(sfxVolume * 100)}%
              </span>
            </label>
            <UncontrolledSliderField
              id={sfxVolumeId}
              label=""
              value={Math.round(sfxVolume * 100)}
              min={0}
              max={100}
              setValue={handleSfxVolumeChange}
            />
          </div>
        )}
        {requiresInteraction && audioEnabled && (
          <p className="text-muted-foreground text-xs">
            Click anywhere to start audio.
          </p>
        )}
      </div>
    ),
    layout: (
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-base font-semibold">Game layout</p>
          <Link
            href="/layouts"
            onClick={onNavigate}
            className="text-primary inline-flex min-h-9 items-center text-xs underline underline-offset-2"
          >
            Explore layouts
          </Link>
        </div>
        <GameLayoutPicker layout={activeLayout} onLayoutChange={handleLayoutChange} />
        <div className="divide-border/50 divide-y">
          {isClassicLayout && (
            <SettingsToggle
              label="Lighter layout"
              checked={!!lightLayout}
              onCheckedChange={setLightLayout}
            />
          )}
          <SettingsToggle
            label="Swap sidebars"
            description={
              swapSidebars
                ? "Player and world panels on opposite sides"
                : "Layout default"
            }
            checked={!!swapSidebars}
            onCheckedChange={setSwapSidebars}
          />
        </div>
        {lightLayoutChanged && (
          <Button
            onClick={handleRefreshPage}
            variant="default"
            size="sm"
            className="w-full"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh to apply
          </Button>
        )}
        <NativeSettingsEntry onNavigate={onNavigate} />
      </div>
    ),
    effects: (
      <div className="space-y-3 pt-2">
        <VisualEffectsSettings />
      </div>
    ),
  };

  if (section !== "all") {
    return sections[section === "display" ? "layout" : section];
  }

  return (
    <Tabs value={activeSettingsTab} onValueChange={setSettingsTab} className="min-w-0">
      <TabsList aria-label="Settings categories" className="flex-nowrap">
        <TabsTrigger value="audio" className="min-h-9 flex-1 px-2 text-xs">
          Audio
        </TabsTrigger>
        <TabsTrigger value="layout" className="min-h-9 flex-1 px-2 text-xs">
          Game layout
        </TabsTrigger>
        <TabsTrigger value="effects" className="min-h-9 flex-1 px-2 text-xs">
          Visual effects
        </TabsTrigger>
      </TabsList>
      <TabsContent value="audio">{sections.audio}</TabsContent>
      <TabsContent value="layout">{sections.layout}</TabsContent>
      <TabsContent value="effects">{sections.effects}</TabsContent>
    </Tabs>
  );
};

/** Graphics controls share one device preference across game and combat settings. */
export const VisualEffectsSettings = () => {
  const { visualEffects, setVisualEffect } = useVisualEffects();
  return (
    <div className="space-y-3">
      <div>
        <p className="text-base font-semibold">Visual effects</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Adjust graphics for your device.
        </p>
      </div>
      <div className="divide-border/50 divide-y">
        <SettingsToggle
          label="Lighting"
          description="Sunlight, day/night colors and local lights"
          checked={visualEffects.lighting}
          onCheckedChange={(enabled) => setVisualEffect("lighting", enabled)}
        />
        <SettingsToggle
          label="Shadows"
          description={
            visualEffects.lighting
              ? "Shadows from the sun and nearby lights"
              : "Enable lighting to show shadows"
          }
          checked={visualEffects.shadows}
          disabled={!visualEffects.lighting}
          onCheckedChange={(enabled) => setVisualEffect("shadows", enabled)}
        />
        <SettingsToggle
          label="Animations"
          description="Wind, weather and sprite animations"
          checked={visualEffects.animations}
          onCheckedChange={(enabled) => setVisualEffect("animations", enabled)}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        Shared across the game; saved on this device.
      </p>
    </div>
  );
};

/** A compact, labelled preference row with a full text target and optional explanation. */
export const SettingsToggle = ({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) => {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-2">
      <label
        htmlFor={id}
        className={`flex-1 cursor-pointer text-sm ${disabled ? "opacity-50" : ""}`}
      >
        {label}
        {description && (
          <span
            id={`${id}-description`}
            className="text-muted-foreground mt-0.5 block text-xs"
          >
            {description}
          </span>
        )}
      </label>
      <Switch
        id={id}
        aria-label={label}
        aria-describedby={description ? `${id}-description` : undefined}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
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
        onNavigate={onNavigate}
        section={section}
      />
    </div>
  );
};

/**
 * Game header settings, with an audio shortcut linking to the settings page.
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
              <Settings
                className={triggerClassName ? "h-4 w-4" : "h-6 w-6 p-1 xl:h-7 xl:w-7"}
                suppressHydrationWarning
              />
            ) : audioEnabled ? (
              <Volume2 className="h-6 w-6 p-1 xl:h-7 xl:w-7" suppressHydrationWarning />
            ) : (
              <VolumeX className="h-6 w-6 p-1 xl:h-7 xl:w-7" suppressHydrationWarning />
            )}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="Game settings"
        className="max-h-[80dvh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto"
        sideOffset={8}
      >
        <GameSettingsContent
          userData={userData}
          updateUser={updateUser}
          onNavigate={() => setOpen(false)}
          section={section}
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
