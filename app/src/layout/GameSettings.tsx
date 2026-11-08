"use client";

import { RefreshCw, Settings, Volume2, VolumeX } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { api } from "@/app/_trpc/client";
import { NativeSettingsEntry } from "@/components/native/NativeSettingsEntry";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalStorage } from "@/hooks/localstorage";
import { useActivityDock } from "@/hooks/useActivityDock";
import { useSelectGameLayout } from "@/hooks/useGameLayout";
import { useIframeMute } from "@/hooks/useIframeMute";
import { useVisualEffects } from "@/hooks/visual-effects";
import { GameLayoutPicker } from "@/layout/GameLayoutPicker";
import { useGlobalAudio } from "@/layout/GlobalAudioProvider";
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
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { useActiveLayout } from "@/utils/LayoutContext";
import { clamp } from "@/utils/math";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";

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
  const [sfxOn, setSfxOn] = useState<boolean>(true);

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
  // Decorative chrome controls follow the rendered shell, including for signed-out visitors.
  const activeLayout = useActiveLayout();
  const isClassicLayout = activeLayout === "default";

  const lightLayoutChanged = isClassicLayout && lightLayout !== initialLightLayout;

  const handleRefreshPage = () => {
    window.location.reload();
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
    const safePercent = clamp(percent, 0, 100);
    const newVolume = safePercent / 100;
    setSfxVolume(newVolume);
    safeLocalStorageSetItem("sfxVolume", JSON.stringify(newVolume));
  };

  const handleLayoutChange = useSelectGameLayout();
  const { swapSides, setSwapSides } = useActivityDock();

  const sections = {
    audio: (
      <div className="space-y-3 pt-2">
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
            description="Battle effects and background attack alerts"
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
        <Link
          href="/layouts"
          onClick={onNavigate}
          className="text-primary inline-flex min-h-9 items-center text-xs underline underline-offset-2"
        >
          Explore layouts
        </Link>
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
          <SettingsToggle
            label="Swap Chat and Activity sides"
            description={
              swapSides ? "Chat left · Activity right" : "Chat right · Activity left"
            }
            checked={swapSides}
            onCheckedChange={setSwapSides}
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
      <div className="divide-border/50 divide-y">
        <SettingsToggle
          label="Sunlight"
          description="Directional light from the sun"
          checked={visualEffects.sunlight}
          onCheckedChange={(enabled) => setVisualEffect("sunlight", enabled)}
        />
        <SettingsToggle
          label="Day/night colors"
          description="Ambient colors change with the world clock"
          checked={visualEffects.dayNight}
          onCheckedChange={(enabled) => setVisualEffect("dayNight", enabled)}
        />
        <SettingsToggle
          label="Local lights"
          description="Lanterns, windows and nearby light sources"
          checked={visualEffects.localLights}
          onCheckedChange={(enabled) => setVisualEffect("localLights", enabled)}
        />
        <SettingsToggle
          label="Shadows"
          description="Shadows from the sun and nearby lights"
          checked={visualEffects.shadows}
          onCheckedChange={(enabled) => setVisualEffect("shadows", enabled)}
        />
        <SettingsToggle
          label="Weather"
          description="Rain, snow, storms, cloud shadows and other weather effects"
          checked={visualEffects.weather}
          onCheckedChange={(enabled) => setVisualEffect("weather", enabled)}
        />
        <SettingsToggle
          label="Wind"
          description="Swaying trees, grass and foliage"
          checked={visualEffects.wind}
          onCheckedChange={(enabled) => setVisualEffect("wind", enabled)}
        />
        <SettingsToggle
          label="Wildlife"
          description="Animals roaming the world map"
          checked={visualEffects.wildlife}
          onCheckedChange={(enabled) => setVisualEffect("wildlife", enabled)}
        />
        <SettingsToggle
          label="Sprite animations"
          description="Animated characters, scenery and effects"
          checked={visualEffects.spriteAnimations}
          onCheckedChange={(enabled) => setVisualEffect("spriteAnimations", enabled)}
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
  section = "all",
}) => {
  return (
    <div className={section === "all" ? "p-4" : undefined}>
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
                : "relative inline-flex rounded-full bg-blue-100 bg-opacity-80 group-hover/audio:bg-blue-300 group-hover/audio:text-black"
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
            {isSettingsTrigger && !triggerClassName && (
              // Keeps the sound state visible on the gear; toggled by class so hydration matches.
              <VolumeX
                aria-hidden="true"
                data-muted-mark
                className={`absolute -right-1 -bottom-1 h-3.5 w-3.5 rounded-full bg-white p-[1px] text-slate-700 ring-1 ring-slate-400 ${audioEnabled ? "hidden" : ""}`}
                suppressHydrationWarning
              />
            )}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="Game settings"
        className="max-h-[80dvh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto"
        sideOffset={8}
      >
        {section === "audio" && <p className="text-base font-semibold">Audio</p>}
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
