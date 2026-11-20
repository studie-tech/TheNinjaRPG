import { describe, expect, it, vi } from "bun:test";
import {
  getIframeProviderName,
  holdAudioPlayback,
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
      // Each play varies its pitch a little.
      const rates = new Set<number>();
      context.createBufferSource = () => {
        const source = {
          buffer: null as AudioBuffer | null,
          playbackRate: {
            set value(rate: number) {
              rates.add(rate);
            },
          },
          connect: (next: unknown) => next,
          disconnect() {},
          start: () => {},
          onended: null,
        };
        return source as never;
      };
      for (let play = 0; play < 8; play++) await playPreloadedAudio(upload);
      expect(rates.size).toBeGreaterThan(1);
      for (const rate of rates) {
        expect(rate).toBeGreaterThanOrEqual(0.9);
        expect(rate).toBeLessThanOrEqual(1.1);
      }
    } finally {
      fetched.mockRestore();
      Object.assign(window, {
        __sharedAudioContext: undefined,
        __audioBufferCache: undefined,
        __audioBufferPending: undefined,
      });
    }
  });

  it("varies the pitch the same way when a sound plays before its buffer is ready", async () => {
    const played: { playbackRate: number; preservesPitch: boolean }[] = [];
    class FakeAudio {
      crossOrigin = "";
      cloneNode() {
        const node = {
          volume: 1,
          crossOrigin: "",
          playbackRate: 1,
          preservesPitch: true,
          addEventListener: () => {},
          pause: () => {},
          play: async () => {
            played.push(node);
          },
        };
        return node;
      }
    }
    const original = globalThis.Audio;
    Object.assign(globalThis, { Audio: FakeAudio });
    Object.assign(window, { __sharedAudioContext: null, __audioCache: undefined });
    try {
      await playPreloadedAudio("https://uploadthing.b-cdn.net/f/not-loaded.mp3", 0.5);
      expect(played).toHaveLength(1);
      expect(played[0]?.preservesPitch).toBe(false);
      expect(played[0]?.playbackRate).toBeGreaterThanOrEqual(0.9);
      expect(played[0]?.playbackRate).toBeLessThanOrEqual(1.1);
    } finally {
      Object.assign(globalThis, { Audio: original });
      Object.assign(window, {
        __sharedAudioContext: undefined,
        __audioCache: undefined,
      });
    }
  });

  it("cuts off element playback when a hold begins and plays nothing while held", async () => {
    const nodes: { paused: boolean }[] = [];
    class FakeAudio {
      crossOrigin = "";
      cloneNode() {
        const node = {
          volume: 1,
          crossOrigin: "",
          playbackRate: 1,
          preservesPitch: true,
          paused: true,
          addEventListener: () => {},
          pause: () => {
            node.paused = true;
          },
          play: async () => {
            node.paused = false;
            nodes.push(node);
          },
        };
        return node;
      }
    }
    const original = globalThis.Audio;
    Object.assign(globalThis, { Audio: FakeAudio });
    Object.assign(window, { __sharedAudioContext: null, __audioCache: undefined });
    try {
      await playPreloadedAudio("https://uploadthing.b-cdn.net/f/fallback.mp3", 0.5);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.paused).toBe(false);

      holdAudioPlayback("muted", true);
      expect(nodes[0]?.paused).toBe(true);
      await playPreloadedAudio("https://uploadthing.b-cdn.net/f/fallback.mp3", 0.5);
      expect(nodes).toHaveLength(1);

      // Releasing one hold keeps the sound off while another still holds it.
      holdAudioPlayback("host", true);
      holdAudioPlayback("muted", false);
      await playPreloadedAudio("https://uploadthing.b-cdn.net/f/fallback.mp3", 0.5);
      expect(nodes).toHaveLength(1);

      holdAudioPlayback("host", false);
      await playPreloadedAudio("https://uploadthing.b-cdn.net/f/fallback.mp3", 0.5);
      expect(nodes).toHaveLength(2);
    } finally {
      holdAudioPlayback("muted", false);
      holdAudioPlayback("host", false);
      Object.assign(globalThis, { Audio: original });
      Object.assign(window, {
        __sharedAudioContext: undefined,
        __audioCache: undefined,
      });
    }
  });
});
