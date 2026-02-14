"use client";

import { Volume2, VolumeX } from "lucide-react";
import { createContext, type ReactNode, use, useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  MUSIC_CURRENT_THEME,
  MUSIC_SHINE_THEME,
  MUSIC_SYNDICATE_THEME,
  MUSIC_TSUKIMORI_THEME,
  MUSIC_WELCOME_TO_SEICHI,
} from "@/drizzle/constants";
import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
  useLocalStorage,
} from "@/hooks/localstorage";
import { useAudio } from "@/hooks/useAudio";
import { useIframeMute } from "@/hooks/useIframeMute";
import { UncontrolledSliderField } from "@/layout/SliderField";
import { showMutationToast } from "@/libs/toast";
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
const useGameSettings = (userData?: UserWithRelations | null) => {
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
 * Game settings panel component (for use in tabs, settings pages, etc.)
 */
export const GameSettingsPanel: React.FC<GameSettingsProps> = ({
  userData,
  updateUser,
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

  return (
    <div className="space-y-4 p-4">
      <div>
        <p className="mb-3 font-medium">Music</p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">Background soundtrack</p>
            <p className="text-muted-foreground text-xs">
              {audioEnabled ? "Playing" : "Paused"}
            </p>
          </div>
          <Switch
            checked={!!audioEnabled}
            onCheckedChange={async (checked) => {
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
            }}
            aria-label="Toggle music"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <p className="text-sm">Nindo Audio</p>
            <p className="text-muted-foreground text-xs">
              Embedded iframe audio control
            </p>
          </div>
          <Switch
            checked={!isIframesMuted}
            onCheckedChange={(checked) => {
              setIframesMuted(!checked);
            }}
            aria-label="Toggle embedded iframe audio"
          />
        </div>
      </div>

      <div>
        <p className="mb-3 font-medium">Sound effects</p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">Combat SFX</p>
            <p className="text-muted-foreground text-xs">
              {sfxOn ? "Enabled" : "Disabled"}
            </p>
          </div>
          <Switch
            checked={!!sfxOn}
            onCheckedChange={(checked) => {
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
            }}
            aria-label="Toggle sound effects"
          />
        </div>
      </div>

      {sfxOn && (
        <div className="space-y-2">
          <div>
            <p className="text-sm">SFX Volume</p>
            <p className="text-muted-foreground text-xs">
              Current volume: {Math.round(sfxVolume * 100)}%
            </p>
          </div>
          <UncontrolledSliderField
            id="sfxVolume"
            label=""
            value={Math.round(sfxVolume * 100)}
            min={0}
            max={100}
            setValue={(nextValue: React.SetStateAction<number>) => {
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
            }}
          />
        </div>
      )}

      <div>
        <p className="mb-3 font-medium">Display</p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">Lighter Layout</p>
            <p className="text-muted-foreground text-xs">
              {lightLayout ? "Enabled" : "Disabled"}
            </p>
          </div>
          <Switch
            checked={!!lightLayout}
            onCheckedChange={setLightLayout}
            aria-label="Toggle lighter layout"
          />
        </div>
      </div>

      {requiresInteraction && audioEnabled && (
        <p className="text-muted-foreground text-xs italic">
          Audio requires interaction on this browser; click anywhere to start
        </p>
      )}
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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Audio settings"
          className="mx-1 rounded-full bg-blue-100 bg-opacity-80 text-slate-700 hover:bg-blue-300 hover:text-black"
        >
          {audioEnabled ? (
            <Volume2 className="h-6 w-6 p-1 xl:h-7 xl:w-7" suppressHydrationWarning />
          ) : (
            <VolumeX className="h-6 w-6 p-1 xl:h-7 xl:w-7" suppressHydrationWarning />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72" sideOffset={8}>
        <div className="space-y-3">
          <p className="font-medium">Music</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-muted-foreground text-xs">Background soundtrack</p>
            </div>
            <Switch
              checked={!!audioEnabled}
              onCheckedChange={async (checked) => {
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
              }}
              aria-label="Toggle music"
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <p className="text-muted-foreground text-xs">Nindo Audio</p>
            </div>
            <Switch
              checked={!isIframesMuted}
              onCheckedChange={(checked) => {
                setIframesMuted(!checked);
              }}
              aria-label="Toggle embedded iframe audio"
            />
          </div>
          <p className="font-medium">Sound effects</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-muted-foreground text-xs">Combat SFX</p>
            </div>
            <Switch
              checked={!!sfxOn}
              onCheckedChange={(checked) => {
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
              }}
              aria-label="Toggle sound effects"
            />
          </div>
          {sfxOn && (
            <div className="space-y-2">
              <div>
                <p className="text-muted-foreground text-xs">
                  SFX Volume ({Math.round(sfxVolume * 100)}%)
                </p>
              </div>
              <UncontrolledSliderField
                id="sfxVolume"
                label=""
                value={Math.round(sfxVolume * 100)}
                min={0}
                max={100}
                setValue={(nextValue: React.SetStateAction<number>) => {
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
                }}
              />
            </div>
          )}
          <p className="font-medium">Display</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-muted-foreground text-xs">Lighter Layout</p>
            </div>
            <Switch
              checked={!!lightLayout}
              onCheckedChange={setLightLayout}
              aria-label="Toggle lighter layout"
            />
          </div>
          {requiresInteraction && audioEnabled && (
            <p className="text-[10px] text-muted-foreground">
              Audio requires interaction on this browser; click anywhere to start
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
