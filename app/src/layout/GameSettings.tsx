"use client";

import { LayoutTemplate, RefreshCw, Settings, Volume2, VolumeX } from "lucide-react";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  use,
  useEffect,
  useState,
} from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import {
  BUTTON_CLICK_SFX_URLS,
  MUSIC_AKIKAZE_THEME,
  MUSIC_SHIROHANA_THEME,
  MUSIC_SYNDICATE_THEME,
  MUSIC_TSUKIMORI_THEME,
  MUSIC_WELCOME_TO_SEICHI,
} from "@/drizzle/constants";
import { useDayNightMapOverlays } from "@/hooks/day-night-overlay";
import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
  useLocalStorage,
} from "@/hooks/localstorage";
import { useAudio } from "@/hooks/useAudio";
import { useIframeMute } from "@/hooks/useIframeMute";
import { UncontrolledSliderField } from "@/layout/SliderField";
import {
  type EffectiveLayout,
  LAYOUT_PREFERENCE_COOKIE,
  persistLayoutPreferenceCookie,
} from "@/libs/layoutPreference";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { playPreloadedAudio, preloadAudioBuffers } from "@/utils/audio";
import { useActiveLayout } from "@/utils/LayoutContext";

interface GameSettingsProps {
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
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Get initial audio preference from user data or localStorage
  const getInitialMusicState = (): boolean => {
    if (userData) return userData.musicOn;
    const saved = safeLocalStorageGetItem("musicOn");
    if (saved !== null) return JSON.parse(saved) as boolean;
    return true;
  };

  const getInitialButtonSfxState = (): boolean => {
    if (userData && typeof userData.buttonSfxOn === "boolean") {
      return userData.buttonSfxOn;
    }
    const saved = safeLocalStorageGetItem("buttonSfxOn");
    if (saved !== null) return JSON.parse(saved) as boolean;
    return true;
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

  // Use village-specific music if user has a village, otherwise use default
  let musicSrc = MUSIC_WELCOME_TO_SEICHI;
  if (userData?.village?.name === "Tsukimori") {
    musicSrc = MUSIC_TSUKIMORI_THEME;
  } else if (userData?.village?.name === "Shirohana") {
    musicSrc = MUSIC_SHIROHANA_THEME;
  } else if (userData?.village?.name === "Akikaze") {
    musicSrc = MUSIC_AKIKAZE_THEME;
  } else if (userData?.village?.name === "Syndicate") {
    musicSrc = MUSIC_SYNDICATE_THEME;
  }

  // Initialize the single audio instance
  const {
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

  // Sync with user data changes
  useEffect(() => {
    if (!isClient) return;
    if (userData) {
      void setAudioEnabled(!!userData.musicOn);
      setButtonSfxOn(getInitialButtonSfxState());
    } else {
      void setAudioEnabled(getInitialMusicState());
      setButtonSfxOn(getInitialButtonSfxState());
    }
  }, [isClient, userData]);

  useEffect(() => {
    if (!isClient) return;
    setSfxVolume(getInitialSfxVolumeState());
    void preloadAudioBuffers([...BUTTON_CLICK_SFX_URLS]);
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

  const contextValue: AudioContextValue = {
    audioEnabled,
    setAudioEnabled,
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
 * Hook to manage all audio-related state and logic
 * Now uses the global audio instance instead of creating its own
 */
export const useGameSettings = (userData?: UserWithRelations | null) => {
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
    if (userData && typeof userData.sfxOn === "boolean") return userData.sfxOn;
    const saved = safeLocalStorageGetItem("sfxOn");
    if (saved !== null) return JSON.parse(saved) as boolean;
    return true;
  };
  const [sfxOn, setSfxOn] = useState<boolean>(() =>
    isClient ? getInitialSfxState() : true,
  );

  // Light layout preference state
  const [lightLayout, setLightLayout] = useLocalStorage<boolean>("lightLayout", false);

  // Day/night map overlay preference (applies immediately, no refresh)
  const { showDayNightMapOverlays, setShowDayNightMapOverlays } =
    useDayNightMapOverlays();

  // Full layout preference state
  const activeLayout = useActiveLayout();
  const [anonymousLayout, setAnonymousLayout] = useLocalStorage<EffectiveLayout>(
    LAYOUT_PREFERENCE_COOKIE,
    activeLayout,
  );
  const layoutPreference: EffectiveLayout = anonymousLayout || activeLayout;

  // Embedded iframe mute state
  const { isIframesMuted, setIframesMuted } = useIframeMute();

  // Sync SFX with user data changes
  useEffect(() => {
    if (!isClient) return;
    if (userData) {
      setSfxOn(!!userData.sfxOn);
    } else {
      setSfxOn(getInitialSfxState());
    }
  }, [isClient, userData]);

  // Update preferences mutation
  const { mutate: updatePreferences } = api.profile.updatePreferences.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        showMutationToast(result);
      }
    },
  });

  return {
    audioEnabled,
    setAudioEnabled,
    sfxOn,
    setSfxOn,
    buttonSfxOn,
    setButtonSfxOn,
    sfxVolume,
    setSfxVolume,
    lightLayout,
    setLightLayout,
    showDayNightMapOverlays,
    setShowDayNightMapOverlays,
    layoutPreference,
    setAnonymousLayout,
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
}) => {
  const {
    audioEnabled,
    setAudioEnabled,
    sfxOn,
    setSfxOn,
    buttonSfxOn,
    setButtonSfxOn,
    sfxVolume,
    setSfxVolume,
    lightLayout,
    setLightLayout,
    showDayNightMapOverlays,
    setShowDayNightMapOverlays,
    layoutPreference,
    setAnonymousLayout,
    isIframesMuted,
    setIframesMuted,
    requiresInteraction,
    updatePreferences,
  } = useGameSettings(userData);

  // Track initial lightLayout value to detect changes
  const [initialLightLayout] = useState<boolean>(lightLayout);
  const [lightLayoutChanged, setLightLayoutChanged] = useState(false);
  const isPixelLayout = layoutPreference === "pixel";

  // Update tracking when lightLayout changes
  useEffect(() => {
    setLightLayoutChanged(!isPixelLayout && lightLayout !== initialLightLayout);
  }, [lightLayout, initialLightLayout, isPixelLayout]);

  const handleRefreshPage = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  const handleMusicToggle = async (checked: boolean) => {
    await setAudioEnabled(checked);
    if (userData) {
      updatePreferences({
        preferredStat: userData.preferredStat ?? null,
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

  const handleSfxToggle = (checked: boolean) => {
    setSfxOn(checked);
    if (userData) {
      updatePreferences({
        preferredStat: userData.preferredStat ?? null,
        preferredGeneral1: userData.preferredGeneral1 ?? null,
        preferredGeneral2: userData.preferredGeneral2 ?? null,
        sfxOn: checked,
      });
      if (updateUser) {
        void updateUser({ sfxOn: checked });
      }
    } else {
      safeLocalStorageSetItem("sfxOn", JSON.stringify(checked));
    }
  };

  const handleButtonSfxToggle = (checked: boolean) => {
    setButtonSfxOn(checked);
    if (userData) {
      updatePreferences({
        preferredStat: userData.preferredStat ?? null,
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

  const handleLayoutChange = (value: string) => {
    const nextLayout = value === "pixel" ? "pixel" : "default";
    if (nextLayout === layoutPreference) return;
    safeLocalStorageSetItem(LAYOUT_PREFERENCE_COOKIE, JSON.stringify(nextLayout));
    persistLayoutPreferenceCookie(nextLayout);
    setAnonymousLayout(nextLayout);
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  const isPanel = variant === "panel";
  const sectionClass = isPanel ? "space-y-4" : "space-y-3";
  const textClass = isPanel ? "text-sm" : "text-xs text-muted-foreground";
  const headerClass = "text-lg font-bold";

  return (
    <div className={sectionClass}>
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
            onCheckedChange={handleSfxToggle}
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
              {isPanel ? "SFX Volume" : `SFX Volume (${Math.round(sfxVolume * 100)}%)`}
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

      <div>
        <p className={headerClass}>Display</p>
        <div className="mb-4 space-y-2">
          <div className="flex items-start gap-2">
            <LayoutTemplate className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className={textClass}>Game Layout</p>
              {isPanel && (
                <p className="text-muted-foreground text-xs">
                  Choose the chrome used across landing and in-game screens.
                </p>
              )}
            </div>
          </div>
          <RadioGroup
            value={layoutPreference}
            onValueChange={handleLayoutChange}
            className="grid grid-cols-2 gap-2"
          >
            <label
              htmlFor="layout-default"
              className="flex cursor-pointer items-center gap-2 rounded-md border border-border p-2 text-sm hover:bg-accent"
            >
              <RadioGroupItem id="layout-default" value="default" />
              Classic
            </label>
            <label
              htmlFor="layout-pixel"
              className="flex cursor-pointer items-center gap-2 rounded-md border border-border p-2 text-sm hover:bg-accent"
            >
              <RadioGroupItem id="layout-pixel" value="pixel" />
              Pixel
            </label>
          </RadioGroup>
        </div>
        {!isPixelLayout && (
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
          className={`flex items-center justify-between ${!isPixelLayout ? "mt-3" : ""}`}
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

      {requiresInteraction && audioEnabled && (
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
  userData,
  updateUser,
}) => {
  return (
    <div className="p-4">
      <GameSettingsContent
        userData={userData}
        updateUser={updateUser}
        variant="panel"
      />
    </div>
  );
};

/**
 * Audio settings popover button (for use in navbar/header)
 */
export const GameSettingsPopover: React.FC<GameSettingsProps> = ({
  userData,
  updateUser,
  trigger = "audio",
  triggerClassName,
}) => {
  const { audioEnabled } = useGameSettings(userData);
  const isSettingsTrigger = trigger === "settings";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={isSettingsTrigger ? "Game settings" : "Audio settings"}
          className={
            triggerClassName ??
            "mx-1 rounded-full bg-blue-100 bg-opacity-80 text-slate-700 hover:bg-blue-300 hover:text-black"
          }
        >
          {isSettingsTrigger ? (
            <Settings className="h-4 w-4" suppressHydrationWarning />
          ) : audioEnabled ? (
            <Volume2 className="h-6 w-6 p-1 xl:h-7 xl:w-7" suppressHydrationWarning />
          ) : (
            <VolumeX className="h-6 w-6 p-1 xl:h-7 xl:w-7" suppressHydrationWarning />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72" sideOffset={8}>
        <GameSettingsContent
          userData={userData}
          updateUser={updateUser}
          variant="popover"
        />
      </PopoverContent>
    </Popover>
  );
};
