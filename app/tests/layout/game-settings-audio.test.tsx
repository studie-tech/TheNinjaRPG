import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { MUSIC_HALLOWEEN_THEME, MUSIC_WELCOME_TO_SEICHI } from "@/drizzle/constants";
import * as audioHook from "@/hooks/useAudio";
import { GlobalAudioProvider } from "@/layout/GameSettings";
import type { UserWithRelations } from "@/routers/profile";
import * as audioUtils from "@/utils/audio";
import * as timeUtils from "@/utils/time";
import { ensureDom } from "../setup-dom.mjs";

type RemoteCommand = "play" | "pause" | "toggle";
type AudioTestMocks = {
  remoteCommand?: (command: RemoteCommand) => void;
  setEnabled: ReturnType<
    typeof vi.fn<(enabled: boolean, isPreferenceChange?: boolean) => Promise<void>>
  >;
  activate: ReturnType<typeof vi.fn>;
  deactivate: ReturnType<typeof vi.fn>;
  isPlaying: boolean;
  enabled: boolean;
};

function getAudioTestMocks(): AudioTestMocks {
  const globals = globalThis as typeof globalThis & {
    __audioTestMocks?: AudioTestMocks;
  };
  globals.__audioTestMocks ??= {
    setEnabled: vi.fn(async (_enabled: boolean, _isPreferenceChange?: boolean) => undefined),
    activate: vi.fn(async () => true),
    deactivate: vi.fn(async () => undefined),
    isPlaying: false,
    enabled: true,
  };
  return globals.__audioTestMocks;
}

vi.mock("@/libs/native", () => ({
  platform: () => {
    const reported = (
      globalThis as typeof globalThis & {
        window?: Window & { Capacitor?: { getPlatform: () => string } };
      }
    ).window?.Capacitor?.getPlatform();
    return reported === "ios" || reported === "android" ? reported : "web";
  },
  audioSession: {
    activate: getAudioTestMocks().activate,
    deactivate: getAudioTestMocks().deactivate,
    setNowPlaying: vi.fn(async () => undefined),
    onRemoteCommand: (callback: (command: RemoteCommand) => void) => {
      getAudioTestMocks().remoteCommand = callback;
      return () => undefined;
    },
  },
}));

const user = (level: number, musicOn = true) =>
  ({
    userId: "user-1",
    musicOn,
    buttonSfxOn: true,
    level,
  }) as UserWithRelations;

ensureDom();

beforeEach(() => {
  // Restore hook and utility exports between suites sharing Bun's module cache.
  vi.spyOn(audioHook, "useAudio").mockImplementation(() => ({
    isPlaying: getAudioTestMocks().isPlaying,
    isLoading: false,
    error: null,
    canPlay: true,
    requiresInteraction: false,
    enabled: getAudioTestMocks().enabled,
    setEnabled: getAudioTestMocks().setEnabled,
    toggle: vi.fn(async () => undefined),
    setVolume: vi.fn(),
  }));
  vi.spyOn(audioUtils, "playPreloadedAudio").mockResolvedValue(undefined);
  vi.spyOn(audioUtils, "preloadAudioBuffers").mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  const audio = getAudioTestMocks();
  audio.setEnabled.mockClear();
  audio.activate.mockClear();
  audio.activate.mockResolvedValue(true);
  audio.deactivate.mockClear();
  audio.isPlaying = false;
  audio.enabled = true;
  audio.remoteCommand = undefined;
});

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
    const originalCapacitor = Object.getOwnPropertyDescriptor(window, "Capacitor");
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      value: { getPlatform: () => "android" },
    });
    const audio = getAudioTestMocks();
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
      if (originalCapacitor) {
        Object.defineProperty(window, "Capacitor", originalCapacitor);
      } else {
        Reflect.deleteProperty(window, "Capacitor");
      }
    }
  });

  it("starts iOS remote Play during the gesture and keeps a later Pause authoritative", async () => {
    const originalCapacitor = Object.getOwnPropertyDescriptor(window, "Capacitor");
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      value: { getPlatform: () => "ios" },
    });
    const audio = getAudioTestMocks();
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
      if (originalCapacitor) {
        Object.defineProperty(window, "Capacitor", originalCapacitor);
      } else {
        Reflect.deleteProperty(window, "Capacitor");
      }
    }
  });

  it("retries iOS session activation after a failed attempt", async () => {
    const originalCapacitor = Object.getOwnPropertyDescriptor(window, "Capacitor");
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      value: { getPlatform: () => "ios" },
    });
    const audio = getAudioTestMocks();
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
    if (originalCapacitor) {
      Object.defineProperty(window, "Capacitor", originalCapacitor);
    } else {
      Reflect.deleteProperty(window, "Capacitor");
    }
  });

  it("keeps the iOS audio session through a brief pause and releases it when music is off", async () => {
    const originalCapacitor = Object.getOwnPropertyDescriptor(window, "Capacitor");
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      value: { getPlatform: () => "ios" },
    });
    const audio = getAudioTestMocks();
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
    if (originalCapacitor) {
      Object.defineProperty(window, "Capacitor", originalCapacitor);
    } else {
      Reflect.deleteProperty(window, "Capacitor");
    }
  });

  it("keeps a remote pause through unrelated profile refreshes", async () => {
    const audio = getAudioTestMocks();
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
    const audio = getAudioTestMocks();
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
