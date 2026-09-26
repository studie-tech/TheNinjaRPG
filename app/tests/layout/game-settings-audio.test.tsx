import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobalAudioProvider } from "@/layout/GameSettings";
import { getPlatform } from "@/libs/native/bridge";
import type { UserWithRelations } from "@/routers/profile";
import { ensureDom } from "../setup-dom.mjs";

type RemoteCommand = "play" | "pause" | "toggle";
type AudioTestMocks = {
  remoteCommand?: (command: RemoteCommand) => void;
  setEnabled: ReturnType<typeof vi.fn>;
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
    setEnabled: vi.fn(async (_enabled: boolean) => undefined),
    activate: vi.fn(async () => true),
    deactivate: vi.fn(async () => undefined),
    isPlaying: false,
    enabled: true,
  };
  return globals.__audioTestMocks;
}

vi.mock("@/hooks/useAudio", () => ({
  useAudio: () => ({
    isPlaying: getAudioTestMocks().isPlaying,
    requiresInteraction: false,
    enabled: getAudioTestMocks().enabled,
    setEnabled: getAudioTestMocks().setEnabled,
  }),
}));

vi.mock("@/libs/native", () => ({
  platform: getPlatform,
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

vi.mock("@/utils/audio", () => ({
  playPreloadedAudio: vi.fn(),
  preloadAudioBuffers: vi.fn(async () => undefined),
}));

const user = (level: number) =>
  ({
    userId: "user-1",
    musicOn: true,
    buttonSfxOn: true,
    level,
  }) as UserWithRelations;

ensureDom();

afterEach(() => {
  cleanup();
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
});
