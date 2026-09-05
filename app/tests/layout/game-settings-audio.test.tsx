import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobalAudioProvider } from "@/layout/GameSettings";
import type { UserWithRelations } from "@/routers/profile";
import { ensureDom } from "../setup-dom.mjs";

type RemoteCommand = "play" | "pause" | "toggle";
type AudioTestMocks = {
  remoteCommand?: (command: RemoteCommand) => void;
  setEnabled: ReturnType<typeof vi.fn>;
};

function getAudioTestMocks(): AudioTestMocks {
  const globals = globalThis as typeof globalThis & {
    __audioTestMocks?: AudioTestMocks;
  };
  globals.__audioTestMocks ??= {
    setEnabled: vi.fn(async (_enabled: boolean) => undefined),
  };
  return globals.__audioTestMocks;
}

vi.mock("@/hooks/useAudio", () => ({
  useAudio: () => ({
    isPlaying: false,
    requiresInteraction: false,
    enabled: true,
    setEnabled: getAudioTestMocks().setEnabled,
  }),
}));

vi.mock("@/libs/native", () => ({
  audioSession: {
    activate: vi.fn(async () => undefined),
    deactivate: vi.fn(async () => undefined),
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
  audio.remoteCommand = undefined;
});

describe("GlobalAudioProvider", () => {
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
