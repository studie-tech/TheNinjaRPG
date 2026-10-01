import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAudio } from "@/hooks/useAudio";
import { ensureDom } from "../setup-dom.mjs";

vi.mock("@/utils/audio", () => ({
  isSafariOrIOS: () => true,
  addUserInteractionListeners: () => () => undefined,
}));

ensureDom();

let audio: HTMLAudioElement;

beforeEach(() => {
  audio = document.createElement("audio");
  vi.spyOn(globalThis, "Audio").mockImplementation(function () {
    return audio;
  });
  vi.spyOn(audio, "play").mockImplementation(async () => {
    audio.dispatchEvent(new Event("play"));
  });
  vi.spyOn(audio, "pause").mockImplementation(() => {
    audio.dispatchEvent(new Event("pause"));
  });
  vi.spyOn(audio, "load").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const soundtrack = "https://example.com/soundtrack.mp3";

describe("soundtrack preference and transport lifecycle", () => {
  it("makes explicit Off inaudible and restores audible playback when enabled again", async () => {
    const { result } = renderHook(() => useAudio({ src: soundtrack }));
    act(() => audio.dispatchEvent(new Event("canplay")));

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
    act(() => audio.dispatchEvent(new Event("canplay")));

    await act(() => result.current.setEnabled(false));
    expect(result.current.isPlaying).toBe(false);
    expect(audio.muted).toBe(false);
    expect(audio.src).toBe(soundtrack);

    await act(() => result.current.setEnabled(true));
    expect(result.current.isPlaying).toBe(true);
    expect(audio.muted).toBe(false);
  });
});
