import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deactivate, setNowPlaying } from "@/libs/native/audioSession";

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
    const session = { metadata: null };
    setGlobal("navigator", { mediaSession: session });
    setGlobal("MediaMetadata", function (info: MediaMetadataInit) {
      return info;
    });

    const info = { title: "TheNinja-RPG", artist: "Horizon" };
    await setNowPlaying(info);
    expect(nativeMetadata).toHaveBeenCalledWith(info);
    expect(session.metadata).toEqual({ ...info, artwork: [] });

    await deactivate();
    expect(nativeDeactivate).toHaveBeenCalledOnce();
    expect(session.metadata).toBeNull();
  });

  it.each(["web", "android"])("leaves %s browser metadata alone", async (platform) => {
    setGlobal("window", { Capacitor: { getPlatform: () => platform } });
    const metadata = { title: "Another player" };
    const session = { metadata };
    setGlobal("navigator", { mediaSession: session });

    await setNowPlaying({ title: "TheNinja-RPG" });
    await deactivate();
    expect(session.metadata).toBe(metadata);
  });
});
