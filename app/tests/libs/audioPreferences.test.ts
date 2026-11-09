import { afterEach, describe, expect, it, vi } from "bun:test";
import {
  getAudioPreference,
  isLocalAudioSession,
  setLocalAudioPreference,
} from "@/libs/audioPreferences";
import * as native from "@/libs/native";

const originalWindow = window;

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
  vi.restoreAllMocks();
  localStorage.removeItem("musicOn");
});

describe("audio preference origins", () => {
  it.each(["http://localhost:3100", "http://127.0.0.1:3100", "http://[::1]:3100"])(
    "defaults browser playback off at %s",
    (url) => {
      vi.spyOn(native, "platform").mockReturnValue("web");
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: { location: new URL(url) },
      });
      expect(isLocalAudioSession()).toBe(true);
      expect(getAudioPreference("musicOn", true)).toBe(false);
      expect(getAudioPreference("sfxOn", true)).toBe(false);
      expect(getAudioPreference("buttonSfxOn", true)).toBe(false);
    },
  );

  it.each(["https://www.theninja-rpg.com", "https://localhost.example.com"])(
    "retains account preferences at %s",
    (url) => {
      vi.spyOn(native, "platform").mockReturnValue("web");
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: { location: new URL(url), localStorage },
      });
      expect(isLocalAudioSession()).toBe(false);
      expect(getAudioPreference("musicOn")).toBe(true);
      localStorage.setItem("musicOn", "false");
      expect(getAudioPreference("musicOn")).toBe(false);
      expect(getAudioPreference("musicOn", true)).toBe(true);
      expect(setLocalAudioPreference("musicOn", false)).toBe(false);
    },
  );

  it.each(["ios", "android"] as const)(
    "retains %s shell audio on localhost",
    (platform) => {
      vi.spyOn(native, "platform").mockReturnValue(platform);
      expect(isLocalAudioSession()).toBe(false);
      expect(getAudioPreference("musicOn", true)).toBe(true);
      expect(getAudioPreference("sfxOn", false)).toBe(false);
    },
  );
});
