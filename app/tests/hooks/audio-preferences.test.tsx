import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useAudio } from "@/hooks/useAudio";
import * as native from "@/libs/native";
import * as audioUtils from "@/utils/audio";

let audio: HTMLAudioElement;
let play: ReturnType<typeof vi.fn<() => Promise<void>>>;
let hidden = false;
const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, "hidden");

beforeEach(() => {
  vi.spyOn(native, "platform").mockReturnValue("web");
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  vi.spyOn(audioUtils, "isSafariOrIOS").mockReturnValue(true);
  vi.spyOn(audioUtils, "addUserInteractionListeners").mockImplementation(
    () => () => undefined,
  );
  audio = document.createElement("audio");
  vi.spyOn(
    globalThis as unknown as { Audio: (src?: string) => HTMLAudioElement },
    "Audio",
  ).mockImplementation(function () {
    return audio;
  });
  play = vi.spyOn(audio, "play").mockImplementation(async () => {
    audio.dispatchEvent(new window.Event("play"));
  });
  vi.spyOn(audio, "pause").mockImplementation(() => {
    audio.dispatchEvent(new window.Event("pause"));
  });
  vi.spyOn(audio, "load").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (hiddenDescriptor) Object.defineProperty(document, "hidden", hiddenDescriptor);
  else Reflect.deleteProperty(document, "hidden");
});

const soundtrack = "https://example.com/soundtrack.mp3";

describe("soundtrack preference and transport lifecycle", () => {
  it("does not probe autoplay or play a disabled soundtrack", async () => {
    vi.spyOn(audioUtils, "isSafariOrIOS").mockReturnValue(false);
    const { result } = renderHook(() => useAudio({ src: soundtrack, enabled: false }));
    await act(async () => audio.dispatchEvent(new window.Event("canplay")));
    expect(play).not.toHaveBeenCalled();
    expect(result.current.enabled).toBe(false);

    await act(() => result.current.setEnabled(true, true));
    expect(play).toHaveBeenCalled();
  });

  it("yields background Android playback until the player explicitly resumes", async () => {
    vi.spyOn(audioUtils, "isSafariOrIOS").mockReturnValue(false);
    vi.spyOn(native, "platform").mockReturnValue("android");
    const { result, rerender } = renderHook(() => useAudio({ src: soundtrack }));
    await act(async () => undefined);
    await act(async () => audio.dispatchEvent(new window.Event("canplay")));
    expect(result.current.isPlaying).toBe(true);
    const playCalls = play.mock.calls.length;

    hidden = true;
    await act(async () => audio.dispatchEvent(new window.Event("pause")));
    expect(result.current.enabled).toBe(false);
    expect(result.current.isPlaying).toBe(false);
    expect(play.mock.calls.length).toBe(playCalls);
    expect(audio.src).toBe(soundtrack);
    expect(audio.muted).toBe(false);

    hidden = false;
    rerender();
    await act(async () => audio.dispatchEvent(new window.Event("canplay")));
    expect(play.mock.calls.length).toBe(playCalls);
    await act(() => result.current.setEnabled(true));
    expect(result.current.isPlaying).toBe(true);
  });

  it.each(["web", "android"] as const)(
    "retains foreground %s startup retries after an incidental pause",
    async (platform) => {
      vi.spyOn(audioUtils, "isSafariOrIOS").mockReturnValue(false);
      vi.spyOn(native, "platform").mockReturnValue(platform);
      const { result } = renderHook(() => useAudio({ src: soundtrack }));
      await act(async () => undefined);
      await act(async () => audio.dispatchEvent(new window.Event("canplay")));
      const playCalls = play.mock.calls.length;
      await act(async () => audio.dispatchEvent(new window.Event("pause")));
      expect(result.current.enabled).toBe(true);
      expect(result.current.isPlaying).toBe(true);
      expect(play.mock.calls.length).toBeGreaterThan(playCalls);
    },
  );

  it.each([
    ["web", false, true],
    ["ios", true, false],
  ] as const)(
    "preserves the existing hidden %s pause policy",
    async (platform, safari, staysEnabled) => {
      vi.spyOn(audioUtils, "isSafariOrIOS").mockReturnValue(safari);
      vi.spyOn(native, "platform").mockReturnValue(platform);
      const { result } = renderHook(() => useAudio({ src: soundtrack }));
      await act(async () => undefined);
      await act(async () => audio.dispatchEvent(new window.Event("canplay")));
      const playCalls = play.mock.calls.length;
      hidden = true;
      await act(async () => audio.dispatchEvent(new window.Event("pause")));
      expect(result.current.enabled).toBe(staysEnabled);
      expect(play.mock.calls.length > playCalls).toBe(staysEnabled);
    },
  );

  it("makes explicit Off inaudible and restores audible playback when enabled again", async () => {
    const { result } = renderHook(() => useAudio({ src: soundtrack }));
    act(() => audio.dispatchEvent(new window.Event("canplay")));

    await act(() => result.current.setEnabled(false, true));
    expect(result.current.enabled).toBe(false);
    expect(audio.muted).toBe(true);
    expect(audio.getAttribute("src")).toBeNull();

    await act(() => result.current.setEnabled(true, true));
    expect(audio.muted).toBe(false);
    expect(audio.src).toBe(soundtrack);
    expect(result.current.isPlaying).toBe(true);
  });

  it("retains an audible source for remote Pause and resumes from it", async () => {
    const { result } = renderHook(() => useAudio({ src: soundtrack }));
    act(() => audio.dispatchEvent(new window.Event("canplay")));

    await act(() => result.current.setEnabled(false));
    expect(result.current.isPlaying).toBe(false);
    expect(audio.muted).toBe(false);
    expect(audio.src).toBe(soundtrack);

    await act(() => result.current.setEnabled(true));
    expect(result.current.isPlaying).toBe(true);
    expect(audio.muted).toBe(false);
  });
});
