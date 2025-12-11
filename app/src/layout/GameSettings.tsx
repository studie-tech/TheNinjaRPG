"use client";

import { useEffect, useState, createContext, use, type ReactNode } from "react";
import { Volume2, VolumeX, RefreshCw } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { UncontrolledSliderField } from "@/layout/SliderField";
import { useAudio } from "@/hooks/useAudio";
import { useIframeMute } from "@/hooks/useIframeMute";
import {
  useLocalStorage,
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from "@/hooks/localstorage";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import {
  MUSIC_WELCOME_TO_SEICHI,
  MUSIC_SHINE_THEME,
  MUSIC_TSUKIMORI_THEME,
  MUSIC_CURRENT_THEME,
  MUSIC_SYNDICATE_THEME,
} from "@/drizzle/constants";
import type { UserWithRelations } from "@/routers/profile";

interface GameSettingsProps {
  userData?: UserWithRelations | null;
  updateUser?: (data: Partial<UserWithRelations>) => Promise<void>;
}

/**
 * Audio context value containing the singleton audio controls
 */
interface AudioContextValue {
  audioEnabled: boolean;
  setAudioEnabled: (enabled: boolean) => Promise<void>;
  requiresInteraction: boolean;
}

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

  // Use village-specific music if user has a village, otherwise use default
  let musicSrc = MUSIC_WELCOME_TO_SEICHI;
  if (userData?.village?.name === "Tsukimori") {
    musicSrc = MUSIC_TSUKIMORI_THEME;
  } else if (userData?.village?.name === "Shine") {
    musicSrc = MUSIC_SHINE_THEME;
  } else if (userData?.village?.name === "Current") {
    musicSrc = MUSIC_CURRENT_THEME;
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
    } else {
      void setAudioEnabled(getInitialMusicState());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClient, userData]);

  const contextValue: AudioContextValue = {
    audioEnabled,
    setAudioEnabled,
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
  const { audioEnabled, setAudioEnabled, requiresInteraction } = useGlobalAudio();

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

  // SFX volume state
  const getInitialSfxVolumeState = (): number => {
    const saved = safeLocalStorageGetItem("sfxVolume");
    if (saved !== null) return JSON.parse(saved) as number;
    return 0.8;
  };
  const [sfxVolume, setSfxVolume] = useState<number>(() =>
    isClient ? getInitialSfxVolumeState() : 0.8,
  );

  // Light layout preference state
  const [lightLayout, setLightLayout] = useLocalStorage<boolean>("lightLayout", false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    sfxVolume,
    setSfxVolume,
    lightLayout,
    setLightLayout,
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
    sfxVolume,
    setSfxVolume,
    lightLayout,
    setLightLayout,
    isIframesMuted,
    setIframesMuted,
    requiresInteraction,
    updatePreferences,
  } = useGameSettings(userData);

  // Track initial lightLayout value to detect changes
  const [initialLightLayout] = useState<boolean>(lightLayout);
  const [lightLayoutChanged, setLightLayoutChanged] = useState(false);

  // Update tracking when lightLayout changes
  useEffect(() => {
    setLightLayoutChanged(lightLayout !== initialLightLayout);
  }, [lightLayout, initialLightLayout]);

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
              <p className="text-xs text-muted-foreground">
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
              <p className="text-xs text-muted-foreground">
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
              <p className="text-xs text-muted-foreground">
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
      </div>

      {sfxOn && (
        <div className="space-y-2">
          <div>
            <p className={textClass}>
              {isPanel ? "SFX Volume" : `SFX Volume (${Math.round(sfxVolume * 100)}%)`}
            </p>
            {isPanel && (
              <p className="text-xs text-muted-foreground">
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
        <div className="flex items-center justify-between">
          <div>
            <p className={textClass}>Lighter Layout</p>
            {isPanel && (
              <p className="text-xs text-muted-foreground">
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
        {lightLayoutChanged && (
          <div className={isPanel ? "mt-3" : "mt-2"}>
            <Button
              onClick={handleRefreshPage}
              variant="default"
              size="sm"
              className="w-full"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {isPanel ? "Refresh to Apply Changes" : "Refresh to Apply"}
            </Button>
          </div>
        )}
      </div>

      {requiresInteraction && audioEnabled && (
        <p
          className={
            isPanel
              ? "text-xs text-muted-foreground italic"
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
}) => {
  const { audioEnabled } = useGameSettings(userData);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="Audio settings"
          className="rounded-full mx-1 hover:text-black hover:bg-blue-300 text-slate-700 bg-blue-100 bg-opacity-80"
        >
          {audioEnabled ? (
            <Volume2 className="h-6 w-6 xl:h-7 xl:w-7 p-1" suppressHydrationWarning />
          ) : (
            <VolumeX className="h-6 w-6 xl:h-7 xl:w-7 p-1" suppressHydrationWarning />
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
