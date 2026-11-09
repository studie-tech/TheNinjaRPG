import { describe, expect, it, vi } from "bun:test";
import {
  getIframeProviderName,
  playPreloadedAudio,
  preloadAudioBuffers,
  toPrivacyEnhancedEmbedUrl,
} from "@/utils/audio";

describe("toPrivacyEnhancedEmbedUrl", () => {
  it("moves bare youtube-nocookie.com embeds to the www host the CSP allows", () => {
    expect(toPrivacyEnhancedEmbedUrl("https://youtube-nocookie.com/embed/abc")).toBe(
      "https://www.youtube-nocookie.com/embed/abc",
    );
  });

  it("moves YouTube embeds to youtube-nocookie.com", () => {
    expect(toPrivacyEnhancedEmbedUrl("https://youtube.com/embed/abc?start=5")).toBe(
      "https://www.youtube-nocookie.com/embed/abc?start=5",
    );
  });

  it("leaves other URLs untouched", () => {
    for (const url of [
      "https://www.youtube-nocookie.com/embed/abc",
      "https://www.youtube.com/watch?v=abc",
      "https://player.vimeo.com/video/1",
      "not a url",
    ]) {
      expect(toPrivacyEnhancedEmbedUrl(url)).toBe(url);
    }
  });
});

describe("getIframeProviderName", () => {
  it("names providers by exact domain or subdomain only", () => {
    expect(getIframeProviderName("https://www.youtube-nocookie.com/embed/a")).toBe(
      "YouTube",
    );
    expect(getIframeProviderName("https://player.vimeo.com/video/1")).toBe("Vimeo");
    expect(getIframeProviderName("https://w.soundcloud.com/player")).toBe("SoundCloud");
    expect(getIframeProviderName("https://evilvimeo.com/video/1")).toBe(
      "an external site",
    );
    expect(getIframeProviderName("https://youtube.com.example.org/")).toBe(
      "an external site",
    );
  });
});

describe("preloaded sound effects", () => {
  it("load uploads from the CDN and play them from the preloaded buffer", async () => {
    const started = vi.fn();
    const buffer = { duration: 1 } as AudioBuffer;
    const context = {
      state: "running",
      resume: async () => {},
      destination: {},
      decodeAudioData: (_data: ArrayBuffer, resolve: (decoded: AudioBuffer) => void) =>
        resolve(buffer),
      createGain: () => ({
        gain: { value: 0 },
        connect: (next: unknown) => next,
        disconnect() {},
      }),
      createBufferSource: () => {
        const source = {
          buffer: null as AudioBuffer | null,
          playbackRate: { value: 1 },
          connect: (next: unknown) => next,
          disconnect() {},
          start: () => started(source.buffer),
          onended: null,
        };
        return source;
      },
    };
    Object.assign(window, { __sharedAudioContext: context });
    const fetched = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(new ArrayBuffer(8)));
    try {
      const upload = "https://ui0arpl8sm.ufs.sh/f/sound-effect.mp3";
      await preloadAudioBuffers([upload]);
      expect(fetched).toHaveBeenCalledTimes(1);
      expect(String(fetched.mock.calls[0]?.[0])).toBe(
        "https://uploadthing.b-cdn.net/f/sound-effect.mp3",
      );
      // Playback by the stored upload address finds the buffer without another download.
      await playPreloadedAudio(upload);
      expect(fetched).toHaveBeenCalledTimes(1);
      expect(started).toHaveBeenCalledWith(buffer);
    } finally {
      fetched.mockRestore();
      Object.assign(window, {
        __sharedAudioContext: undefined,
        __audioBufferCache: undefined,
        __audioBufferPending: undefined,
      });
    }
  });
});
