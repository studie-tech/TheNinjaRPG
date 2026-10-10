import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { deactivate, onRemoteCommand, setNowPlaying } from "@/libs/native/audioSession";

const globals = ["window", "navigator", "MediaMetadata"] as const;
let original: Array<PropertyDescriptor | undefined>;
beforeEach(() => {
  original = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
});
afterEach(() => {
  globals.forEach((key, index) => {
    const descriptor = original[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
});
const setGlobal = (key: string, value: unknown) => {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
};

describe("native soundtrack metadata", () => {
  it("updates and clears WebKit metadata alongside the iOS plugin", async () => {
    const nativeMetadata = vi.fn();
    const nativeDeactivate = vi.fn();
    setGlobal("window", {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
        Plugins: {
          TNRAudioSession: {
            setNowPlaying: nativeMetadata,
            deactivate: nativeDeactivate,
          },
        },
      },
    });
    const session: { metadata: MediaMetadataInit | null; playbackState: string } = { metadata: null, playbackState: "none" };
    setGlobal("navigator", { mediaSession: session });
    setGlobal("MediaMetadata", function (info: MediaMetadataInit) {
      return info;
    });

    const info = { title: "TheNinja-RPG", artist: "Horizon" };
    await setNowPlaying(info);
    expect(nativeMetadata).toHaveBeenCalledWith(info);
    expect(session.metadata).toEqual({ ...info, artwork: [] });
    expect(session.playbackState).toBe("playing");

    await deactivate(true);
    expect(session.metadata).toEqual({ ...info, artwork: [] });
    expect(session.playbackState).toBe("paused");

    await deactivate();
    expect(nativeDeactivate).toHaveBeenLastCalledWith({ preserveControls: false });
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe("none");
  });

  it("routes WebKit play and pause through the app and removes them on cleanup", () => {
    const setActionHandler = vi.fn();
    setGlobal("window", {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
        Plugins: {},
      },
    });
    setGlobal("navigator", { mediaSession: { setActionHandler } });
    const handler = vi.fn();
    const remove = onRemoteCommand(handler);
    const play = setActionHandler.mock.calls.find(([action]) => action === "play")?.[1];
    const pause = setActionHandler.mock.calls.find(([action]) => action === "pause")?.[1];
    play();
    pause();
    expect(handler.mock.calls).toEqual([["play"], ["pause"]]);
    remove();
    expect(setActionHandler.mock.calls.slice(-2)).toEqual([
      ["play", null],
      ["pause", null],
    ]);
  });

  it.each(["web", "android"])("leaves %s browser metadata alone", async (platform) => {
    setGlobal("window", { Capacitor: { getPlatform: () => platform } });
    const metadata = { title: "Another player" };
    const session = { metadata, playbackState: "playing", setActionHandler: vi.fn() };
    setGlobal("navigator", { mediaSession: session });

    await setNowPlaying({ title: "TheNinja-RPG" });
    await deactivate();
    expect(session.metadata).toBe(metadata);
    expect(session.playbackState).toBe("playing");
    onRemoteCommand(vi.fn())();
    expect(session.setActionHandler).not.toHaveBeenCalled();
  });
});
