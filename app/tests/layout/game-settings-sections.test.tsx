import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import * as nativeEntry from "@/components/native/NativeSettingsEntry";
import * as audioHook from "@/hooks/useAudio";
import * as gameLayoutHook from "@/hooks/useGameLayout";
import * as iframeHook from "@/hooks/useIframeMute";
import * as layoutPicker from "@/layout/GameLayoutPicker";
import {
  GameSettingsPanel,
  GameSettingsPopover,
  GlobalAudioProvider,
  SETTINGS_HREF,
} from "@/layout/GameSettings";
import { hasTutorialReminder } from "@/layout/TutorialSettings";
import * as audioPreferences from "@/libs/audioPreferences";
import type { UserWithRelations } from "@/routers/profile";
import * as audioUtils from "@/utils/audio";
import { ensureDom } from "../setup/dom.mjs";

ensureDom();

// Radix popovers dispatch DOM events, so tests use the window's Event classes.
const browserGlobals = ["Event", "CustomEvent", "ResizeObserver"] as const;
const browserDescriptors = browserGlobals.map((key) =>
  Object.getOwnPropertyDescriptor(globalThis, key),
);

const MUSIC = "Toggle music";
const SFX = "Toggle sound effects";
const OVERLAYS = "Toggle day/night map overlays";
const SIDEBARS = "Swap sidebars";

beforeEach(() => {
  ensureDom();
  Object.defineProperties(globalThis, {
    Event: { configurable: true, value: window.Event },
    CustomEvent: { configurable: true, value: window.CustomEvent },
    ResizeObserver: {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    },
  });
  vi.spyOn(audioPreferences, "isLocalAudioSession").mockReturnValue(false);
  vi.spyOn(audioHook, "useAudio").mockImplementation(() => ({
    isPlaying: false,
    isLoading: false,
    error: null,
    canPlay: true,
    requiresInteraction: false,
    enabled: true,
    setEnabled: vi.fn(async () => undefined),
    toggle: vi.fn(async () => undefined),
    setVolume: vi.fn(),
  }));
  vi.spyOn(audioUtils, "playPreloadedAudio").mockResolvedValue(undefined);
  vi.spyOn(audioUtils, "preloadAudioBuffers").mockResolvedValue(undefined);
  vi.spyOn(iframeHook, "useIframeMute").mockReturnValue({
    isIframesMuted: false,
    setIframesMuted: vi.fn(),
    toggleIframesMute: vi.fn(),
  });
  vi.spyOn(gameLayoutHook, "useSelectGameLayout").mockReturnValue(vi.fn());
  vi.spyOn(layoutPicker, "GameLayoutPicker").mockReturnValue(null as never);
  vi.spyOn(nativeEntry, "NativeSettingsEntry").mockReturnValue(null as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    profile: { updatePreferences: { useMutation: () => ({ mutate: vi.fn() }) } },
  });
});

afterEach(async () => {
  cleanup();
  // Radix restores focus on the next task, while it still needs DOM Event globals.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  browserGlobals.forEach((key, index) => {
    const descriptor = browserDescriptors[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
});

const renderInAudio = (node: React.ReactNode) =>
  render(<GlobalAudioProvider>{node}</GlobalAudioProvider>);

describe("game settings sections", () => {
  it("shows only sound controls for the sound section", () => {
    renderInAudio(<GameSettingsPanel section="audio" />);
    expect(screen.getByLabelText(MUSIC)).toBeTruthy();
    expect(screen.getByLabelText(SFX)).toBeTruthy();
    expect(screen.queryByLabelText(OVERLAYS)).toBeNull();
    expect(screen.queryByLabelText(SIDEBARS)).toBeNull();
  });

  it("shows only layout and display controls for the display section", () => {
    renderInAudio(<GameSettingsPanel section="display" />);
    expect(screen.getByLabelText(OVERLAYS)).toBeTruthy();
    expect(screen.getByLabelText(SIDEBARS)).toBeTruthy();
    expect(screen.queryByLabelText(MUSIC)).toBeNull();
    expect(screen.queryByLabelText(SFX)).toBeNull();
  });

  it("keeps every control in the full panel used by signed-out visitors", () => {
    renderInAudio(<GameSettingsPanel />);
    for (const label of [MUSIC, SFX, OVERLAYS, SIDEBARS]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it("turns the top-bar popover into a sound switch that links to all settings", () => {
    renderInAudio(<GameSettingsPopover section="audio" />);
    fireEvent.click(screen.getByRole("button", { name: "Audio settings" }));
    expect(screen.getByLabelText(MUSIC)).toBeTruthy();
    expect(screen.queryByLabelText(OVERLAYS)).toBeNull();
    const link = screen.getByRole("link", { name: "All settings" });
    expect(link.getAttribute("href")).toBe(SETTINGS_HREF);
  });

  it("keeps the full popover without a settings link elsewhere", () => {
    renderInAudio(<GameSettingsPopover trigger="settings" />);
    fireEvent.click(screen.getByRole("button", { name: "Game settings" }));
    expect(screen.getByLabelText(OVERLAYS)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "All settings" })).toBeNull();
  });
});

describe("tutorial reminder", () => {
  const userWith = (tutorialOn: boolean, questType: string, completed: number) =>
    ({
      tutorialOn,
      userQuests: [{ completed, quest: { questType } }],
    }) as unknown as NonNullable<UserWithRelations>;

  it("reminds only when the tutorial is off and starter or tier quests are open", () => {
    expect(hasTutorialReminder(userWith(false, "starter", 0))).toBe(true);
    expect(hasTutorialReminder(userWith(false, "tier", 0))).toBe(true);
    expect(hasTutorialReminder(userWith(true, "starter", 0))).toBe(false);
    expect(hasTutorialReminder(userWith(false, "starter", 1))).toBe(false);
    expect(hasTutorialReminder(userWith(false, "daily", 0))).toBe(false);
    expect(hasTutorialReminder(null)).toBe(false);
  });
});
