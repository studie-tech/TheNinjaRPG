import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { MUSIC_HALLOWEEN_THEME, MUSIC_WELCOME_TO_SEICHI } from "@/drizzle/constants";
import * as audioHook from "@/hooks/useAudio";
import * as iframeHook from "@/hooks/useIframeMute";
import { useGameSettings } from "@/layout/GameSettings";
import { GlobalAudioProvider } from "@/layout/GlobalAudioProvider";
import * as audioPreferences from "@/libs/audioPreferences";
import * as native from "@/libs/native";
import type { RemoteCommand } from "@/libs/native/audioSession";
import type { UserWithRelations } from "@/routers/profile";
import * as audioUtils from "@/utils/audio";
import * as timeUtils from "@/utils/time";
import {
  type CapacitorBridge,
  capacitorWindow,
  removeCapacitor,
} from "../setup/native";

/** Audio hook state and native session fakes the provider reads; reset after each test. */
const audio = {
  remoteCommand: undefined as ((command: RemoteCommand) => void) | undefined,
  setEnabled: vi.fn(
    async (_enabled: boolean, _isPreferenceChange?: boolean) => undefined,
  ),
  activate: vi.fn(async () => true),
  deactivate: vi.fn(async (_preserveControls?: boolean) => undefined),
  isPlaying: false,
  enabled: true,
};

const user = (level: number, musicOn = true) =>
  ({
    userId: "user-1",
    musicOn,
    buttonSfxOn: true,
    level,
  }) as NonNullable<UserWithRelations>;

beforeEach(() => {
  vi.spyOn(audioPreferences, "isLocalAudioSession").mockReturnValue(false);
  // Restore hook and utility exports between suites sharing Bun's module cache.
  vi.spyOn(audioHook, "useAudio").mockImplementation(() => ({
    isPlaying: audio.isPlaying,
    requiresInteraction: false,
    enabled: audio.enabled,
    setEnabled: audio.setEnabled,
  }));
  vi.spyOn(audioUtils, "playPreloadedAudio").mockResolvedValue(undefined);
  vi.spyOn(audioUtils, "preloadAudioBuffers").mockResolvedValue(undefined);
  vi.spyOn(native.audioSession, "activate").mockImplementation(audio.activate);
  vi.spyOn(native.audioSession, "deactivate").mockImplementation(audio.deactivate);
  vi.spyOn(native.audioSession, "setNowPlaying").mockResolvedValue(undefined);
  vi.spyOn(native.audioSession, "onRemoteCommand").mockImplementation((callback) => {
    audio.remoteCommand = callback;
    return () => undefined;
  });
});

afterEach(() => {
  removeCapacitor();
  cleanup();
  vi.restoreAllMocks();
  audio.setEnabled.mockClear();
  audio.activate.mockClear();
  audio.activate.mockResolvedValue(true);
  audio.deactivate.mockClear();
  audio.isPlaying = false;
  audio.enabled = true;
  audio.remoteCommand = undefined;
});

/** Only the platform, so the shell reads as present without any native plugins. */
const setShellPlatform = (platform: string) => {
  capacitorWindow.Capacitor = { getPlatform: () => platform } as CapacitorBridge;
};

describe("GlobalAudioProvider", () => {
  it("switches Halloween music only after login and restores welcome music on logout", () => {
    vi.spyOn(timeUtils, "getCurrentSeason").mockReturnValue("halloween");
    const useAudioSpy = vi.spyOn(audioHook, "useAudio");
    const view = render(
      <GlobalAudioProvider>
        <span>child</span>
      </GlobalAudioProvider>,
    );
    const currentSource = () => useAudioSpy.mock.calls.at(-1)?.[0].src;
    expect(currentSource()).toBe(MUSIC_WELCOME_TO_SEICHI);

    view.rerender(
      <GlobalAudioProvider userData={user(1)}>
        <span>child</span>
      </GlobalAudioProvider>,
    );
    expect(currentSource()).toBe(MUSIC_HALLOWEEN_THEME);

    view.rerender(
      <GlobalAudioProvider userData={null}>
        <span>child</span>
      </GlobalAudioProvider>,
    );
    expect(currentSource()).toBe(MUSIC_WELCOME_TO_SEICHI);
  });

  it("ignores Android remote commands while the saved music preference is off", async () => {
    setShellPlatform("android");
    const view = render(
      <GlobalAudioProvider userData={user(1, false)}>
        <span>child</span>
      </GlobalAudioProvider>,
    );
    try {
      await waitFor(() => expect(audio.remoteCommand).toBeTypeOf("function"));
      audio.setEnabled.mockClear();
      act(() => {
        audio.remoteCommand?.("play");
        audio.remoteCommand?.("toggle");
        audio.remoteCommand?.("pause");
      });
      expect(audio.setEnabled).not.toHaveBeenCalled();

      view.rerender(
        <GlobalAudioProvider userData={user(1, true)}>
          <span>child</span>
        </GlobalAudioProvider>,
      );
      await waitFor(() => expect(audio.setEnabled).toHaveBeenCalledWith(true, true));
      audio.setEnabled.mockClear();
      act(() => audio.remoteCommand?.("play"));
      expect(audio.setEnabled).toHaveBeenCalledWith(true);
    } finally {
      view.unmount();
    }
  });

  it("starts iOS remote Play during the gesture and keeps a later Pause authoritative", async () => {
    setShellPlatform("ios");
    audio.enabled = false;
    const view = render(
      <GlobalAudioProvider userData={user(1)}>
        <span>child</span>
      </GlobalAudioProvider>,
    );
    let resolveActivation: (activated: boolean) => void = () => undefined;
    try {
      await waitFor(() => expect(audio.remoteCommand).toBeTypeOf("function"));
      await act(async () => undefined);
      audio.setEnabled.mockClear();
      audio.deactivate.mockClear();
      audio.activate.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveActivation = resolve;
          }),
      );

      act(() => audio.remoteCommand?.("play"));
      // WebKit's playback gesture ends when the action handler returns. The bridge
      // response must not be a prerequisite for asking the audio element to play.
      expect(audio.setEnabled).toHaveBeenCalledTimes(1);
      expect(audio.setEnabled).toHaveBeenCalledWith(true);
      await waitFor(() => expect(audio.activate).toHaveBeenCalledTimes(1));

      act(() => audio.remoteCommand?.("pause"));
      await act(async () => resolveActivation(true));
      await waitFor(() => expect(audio.deactivate).toHaveBeenCalledWith(true));
      expect(audio.setEnabled.mock.calls).toEqual([[true], [false]]);
    } finally {
      resolveActivation(true);
      view.unmount();
    }
  });

  it("retries iOS session activation after a failed attempt", async () => {
    setShellPlatform("ios");
    audio.isPlaying = true;
    audio.activate.mockResolvedValueOnce(false);
    const view = render(
      <GlobalAudioProvider userData={user(1)}>
        <span>child</span>
      </GlobalAudioProvider>,
    );

    await waitFor(() => expect(audio.activate).toHaveBeenCalledTimes(1));
    audio.isPlaying = false;
    view.rerender(
      <GlobalAudioProvider userData={user(1)}>
        <span>child</span>
      </GlobalAudioProvider>,
    );
    audio.isPlaying = true;
    view.rerender(
      <GlobalAudioProvider userData={user(1)}>
        <span>child</span>
      </GlobalAudioProvider>,
    );
    await waitFor(() => expect(audio.activate).toHaveBeenCalledTimes(2));
    view.unmount();
  });

  it("keeps the iOS audio session through a brief pause and releases it when music is off", async () => {
    setShellPlatform("ios");
    audio.isPlaying = true;
    const view = render(
      <GlobalAudioProvider userData={user(1)}>
        <span>child</span>
      </GlobalAudioProvider>,
    );

    await waitFor(() => expect(audio.activate).toHaveBeenCalledTimes(1));
    audio.isPlaying = false;
    view.rerender(
      <GlobalAudioProvider userData={user(1)}>
        <span>child</span>
      </GlobalAudioProvider>,
    );
    await act(async () => undefined);
    expect(audio.deactivate).not.toHaveBeenCalled();

    audio.enabled = false;
    view.rerender(
      <GlobalAudioProvider userData={user(1)}>
        <span>child</span>
      </GlobalAudioProvider>,
    );
    await waitFor(() => expect(audio.deactivate).toHaveBeenCalledTimes(1));
    view.unmount();
  });

  it("keeps a remote pause through unrelated profile refreshes", async () => {
    const view = render(
      <GlobalAudioProvider userData={user(1)}>
        <span>child</span>
      </GlobalAudioProvider>,
    );

    await waitFor(() => expect(audio.remoteCommand).toBeTypeOf("function"));
    audio.setEnabled.mockClear();

    act(() => audio.remoteCommand?.("pause"));
    expect(audio.setEnabled).toHaveBeenCalledTimes(1);
    expect(audio.setEnabled).toHaveBeenCalledWith(false);

    audio.setEnabled.mockClear();
    view.rerender(
      <GlobalAudioProvider userData={user(2)}>
        <span>child</span>
      </GlobalAudioProvider>,
    );

    await act(async () => undefined);
    expect(audio.setEnabled).not.toHaveBeenCalled();
  });

  it("releases the soundtrack when the saved music preference is off", async () => {
    const view = render(
      <GlobalAudioProvider userData={user(1)}>
        <span>child</span>
      </GlobalAudioProvider>,
    );
    await waitFor(() => expect(audio.setEnabled).toHaveBeenCalledWith(true, true));
    audio.setEnabled.mockClear();

    view.rerender(
      <GlobalAudioProvider userData={user(1, false)}>
        <span>child</span>
      </GlobalAudioProvider>,
    );
    await waitFor(() => expect(audio.setEnabled).toHaveBeenCalledWith(false, true));
  });
});

describe("shared SFX preference action", () => {
  const updatePreferences = vi.fn();

  beforeEach(() => {
    updatePreferences.mockClear();
    Object.assign(vi.spyOn(client, "api" as never), {
      profile: {
        updatePreferences: { useMutation: () => ({ mutate: updatePreferences }) },
      },
    });
    vi.spyOn(iframeHook, "useIframeMute").mockReturnValue({
      isIframesMuted: false,
      setIframesMuted: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.removeItem("sfxOn");
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <GlobalAudioProvider>{children}</GlobalAudioProvider>
  );

  it("keeps signed-out SFX changes local and restores them on remount", () => {
    const updateUser = vi.fn(async () => undefined);
    const view = renderHook(() => useGameSettings(null, updateUser), { wrapper });

    act(() => view.result.current.setSfxEnabled(false));
    expect(view.result.current.sfxOn).toBe(false);
    expect(localStorage.getItem("sfxOn")).toBe("false");
    expect(updatePreferences).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();

    view.unmount();
    const remounted = renderHook(() => useGameSettings(), { wrapper });
    expect(remounted.result.current.sfxOn).toBe(false);
    act(() => remounted.result.current.setSfxEnabled(true));
    expect(remounted.result.current.sfxOn).toBe(true);
    expect(localStorage.getItem("sfxOn")).toBe("true");
    expect(updatePreferences).not.toHaveBeenCalled();
  });

  it("updates playback preferences immediately and uses the current account and cache updater", () => {
    const updateUser = vi.fn(() => new Promise<void>(() => undefined));
    const initialUser: NonNullable<UserWithRelations> = {
      ...user(1),
      sfxOn: true,
      preferredGeneral1: "Strength",
      preferredGeneral2: null,
    };
    const view = renderHook(
      (props) => useGameSettings(props.userData, props.updateUser),
      { initialProps: { userData: initialUser, updateUser }, wrapper },
    );

    act(() => view.result.current.setSfxEnabled(false));
    expect(view.result.current.sfxOn).toBe(false);
    expect(localStorage.getItem("sfxOn")).toBe("false");
    expect(updatePreferences).toHaveBeenLastCalledWith({
      preferredGeneral1: "Strength",
      preferredGeneral2: null,
      sfxOn: false,
    });
    expect(updateUser).toHaveBeenCalledWith({ sfxOn: false });

    // An unrelated profile refresh must preserve the optimistic preference.
    view.rerender({ userData: { ...initialUser, level: 2 }, updateUser });
    expect(view.result.current.sfxOn).toBe(false);

    const nextUpdateUser = vi.fn(async () => undefined);
    view.rerender({
      userData: { ...user(1), userId: "user-2", sfxOn: false },
      updateUser: nextUpdateUser,
    });
    act(() => view.result.current.setSfxEnabled(true));
    expect(view.result.current.sfxOn).toBe(true);
    expect(localStorage.getItem("sfxOn")).toBe("true");
    expect(updatePreferences).toHaveBeenLastCalledWith({
      preferredGeneral1: null,
      preferredGeneral2: null,
      sfxOn: true,
    });
    expect(nextUpdateUser).toHaveBeenCalledWith({ sfxOn: true });
    expect(updateUser).toHaveBeenCalledTimes(1);
  });

  it("starts localhost muted despite saved preferences and keeps opt-ins local", () => {
    vi.spyOn(audioPreferences, "isLocalAudioSession").mockReturnValue(true);
    const keys = ["musicOn", "sfxOn", "buttonSfxOn"] as const;
    keys.forEach((key) => {
      audioPreferences.setLocalAudioPreference(key, false);
      localStorage.setItem(key, "true");
    });
    const account = { ...user(1), sfxOn: true };
    const updateUser = vi.fn(async () => undefined);
    const localWrapper = ({ children }: { children: React.ReactNode }) => (
      <GlobalAudioProvider userData={account}>{children}</GlobalAudioProvider>
    );
    try {
      const view = renderHook(() => useGameSettings(account, updateUser), {
        wrapper: localWrapper,
      });
      expect(audioHook.useAudio).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: false }),
      );
      expect(audio.setEnabled).toHaveBeenCalledWith(false, true);
      expect(view.result.current.buttonSfxOn).toBe(false);
      expect(view.result.current.sfxOn).toBe(false);

      act(() => view.result.current.setSfxEnabled(true));
      expect(view.result.current.sfxOn).toBe(true);
      expect(audioPreferences.getAudioPreference("sfxOn", false)).toBe(true);
      act(() => {
        void view.result.current.setAudioEnabled(true);
      });
      expect(audioPreferences.getAudioPreference("musicOn", false)).toBe(true);
      expect(updatePreferences).not.toHaveBeenCalled();
      expect(updateUser).not.toHaveBeenCalled();
      expect(localStorage.getItem("sfxOn")).toBe("true");
      view.unmount();
    } finally {
      keys.forEach((key) => {
        audioPreferences.setLocalAudioPreference(key, false);
        localStorage.removeItem(key);
      });
    }
  });
});
