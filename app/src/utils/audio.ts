/**
 * Audio utility functions for handling browser compatibility and user interactions
 */

/**
 * Detect if the current browser is Safari or iOS
 */
export const isSafariOrIOS = (): boolean => {
  if (typeof window === "undefined") return false;

  const userAgent = window.navigator.userAgent;
  const isSafari = /^((?!chrome|android).)*safari/i.test(userAgent);
  const isIOS = /iPad|iPhone|iPod/.test(userAgent);

  return isSafari || isIOS;
};

/**
 * Detect if the current browser is mobile
 */
export const isMobile = (): boolean => {
  if (typeof window === "undefined") return false;

  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    window.navigator.userAgent,
  );
};

/**
 * Test if autoplay is supported in the current browser
 */
export const testAutoplaySupport = async (): Promise<boolean> => {
  if (typeof window === "undefined") return false;

  // Create a silent test audio element
  const audio = new Audio();
  audio.volume = 0;
  audio.muted = true;

  try {
    await audio.play();
    audio.pause();
    return true;
  } catch {
    return false;
  }
};

/**
 * Check if user interaction has occurred (needed for audio playback on some browsers)
 */
export const hasUserInteracted = (): boolean => {
  if (typeof window === "undefined") return false;

  // Check if we've stored user interaction flag
  return sessionStorage.getItem("userInteracted") === "true";
};

/**
 * Mark that user interaction has occurred
 */
export const markUserInteraction = (): void => {
  if (typeof window === "undefined") return;

  sessionStorage.setItem("userInteracted", "true");
};

/**
 * Add event listeners to detect user interaction
 */
export const addUserInteractionListeners = (callback?: () => void): (() => void) => {
  if (typeof window === "undefined") return () => {};

  const events = ["click", "touchstart", "keydown"];

  const handleInteraction = () => {
    markUserInteraction();
    if (callback) callback();

    // Remove listeners after first interaction
    events.forEach((event) => {
      document.removeEventListener(event, handleInteraction);
    });
  };

  events.forEach((event) => {
    document.addEventListener(event, handleInteraction, { once: true });
  });

  // Return cleanup function
  return () => {
    events.forEach((event) => {
      document.removeEventListener(event, handleInteraction);
    });
  };
};

/**
 * Get audio-specific error messages for better user feedback
 */
export const getAudioErrorMessage = (error: unknown): string => {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
        return "Audio playback requires user interaction. Please click anywhere to enable audio.";
      case "NotSupportedError":
        return "Audio format not supported by your browser.";
      case "AbortError":
        return "Audio playback was interrupted.";
      case "NetworkError":
        return "Network error while loading audio.";
      default:
        return "An error occurred while playing audio.";
    }
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown audio error occurred.";
};

/**
 * Create an audio context for better browser compatibility
 * This helps with iOS Safari audio issues
 */
export const createAudioContext = (): AudioContext | null => {
  if (typeof window === "undefined") return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    return new AudioContextClass();
  } catch (error) {
    console.warn("AudioContext not supported:", error);
    return null;
  }
};

/**
 * Resume audio context if it's suspended (common on iOS)
 */
export const resumeAudioContext = async (
  audioContext: AudioContext,
): Promise<boolean> => {
  if (!audioContext) return false;

  try {
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    return audioContext.state === "running";
  } catch (error) {
    console.error("Failed to resume audio context:", error);
    return false;
  }
};

// Simple in-memory cache for Audio elements by URL
const audioCache = new Map<string, HTMLAudioElement>();

// Shared AudioContext + caches for decoded AudioBuffers
let sharedAudioContext: AudioContext | null = null;
const audioBufferCache = new Map<string, AudioBuffer>();
const audioBufferPending = new Map<string, Promise<AudioBuffer>>();

const getSharedAudioContext = (): AudioContext | null => {
  if (typeof window === "undefined") return null;
  if (!sharedAudioContext) {
    sharedAudioContext = createAudioContext();
  }
  return sharedAudioContext;
};

const decodeAudioDataAsync = (
  ctx: AudioContext,
  data: ArrayBuffer,
): Promise<AudioBuffer> => {
  // Wrap both promise-returning and callback forms
  return new Promise<AudioBuffer>((resolve, reject) => {
    try {
      const result = ctx.decodeAudioData(
        data,
        (buffer) => resolve(buffer),
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
      // If result is promise-like, chain it to resolve/reject
      if (
        typeof result === "object" &&
        result !== null &&
        typeof (result as { then?: unknown }).then === "function"
      ) {
        (result as unknown as Promise<AudioBuffer>)
          .then((buffer) => resolve(buffer))
          .catch((err) => reject(err instanceof Error ? err : new Error(String(err))));
      }
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
};

/**
 * Preload audio into decoded AudioBuffers using Web Audio API for instant playback.
 */
export const preloadAudioBuffers = async (urls: string[]) => {
  if (typeof window === "undefined") return;
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  const unique = [...new Set(urls.filter(Boolean))];
  const results = await Promise.allSettled(
    unique.map(async (url) => {
      if (audioBufferCache.has(url)) return audioBufferCache.get(url)!;
      const existing = audioBufferPending.get(url);
      if (existing) return existing;
      const promise = (async () => {
        const response = await fetch(url, { mode: "cors", cache: "force-cache" });
        if (!response.ok) throw new Error(`Failed to fetch audio buffer: ${url}`);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = await decodeAudioDataAsync(ctx, arrayBuffer);
        audioBufferCache.set(url, buffer);
        return buffer;
      })().finally(() => audioBufferPending.delete(url));
      audioBufferPending.set(url, promise);
      return promise;
    }),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length) {
    console.warn(`preloadAudioBuffers: ${failed.length} audio file(s) failed`);
  }
};

/**
 * Play a preloaded audio URL (falls back to on-demand if not preloaded).
 */
export const playPreloadedAudio = async (url: string, volume = 0.8): Promise<void> => {
  if (!url || typeof window === "undefined") return;
  const ctx = getSharedAudioContext();
  const buffer = url ? audioBufferCache.get(url) : undefined;
  if (ctx && buffer) {
    try {
      await resumeAudioContext(ctx);
      const gain = ctx.createGain();
      const vol = Math.min(1, Math.max(0, volume));
      gain.gain.value = vol;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain).connect(ctx.destination);
      source.start(0);
      source.onended = () => {
        try {
          source.disconnect();
          gain.disconnect();
        } catch {}
      };
      return;
    } catch {
      // Fall through to element-based playback
    }
  }
  // Element-based fallback (still allows overlapping via clone)
  let audio = audioCache.get(url);
  if (!audio) {
    audio = new Audio(url);
    try {
      audio.crossOrigin = "anonymous";
    } catch {}
    audioCache.set(url, audio);
  }
  const node = audio.cloneNode(true) as HTMLAudioElement;
  node.volume = Math.min(1, Math.max(0, volume));
  try {
    node.crossOrigin = "anonymous";
  } catch {}
  try {
    await node.play();
  } catch {
    // Ignore play errors (autoplay restrictions etc.)
  }
};

/**
 * Check if an iframe element is user-embedded (eligible for global mute)
 * @param iframe - The iframe element to check
 * @returns True if the iframe element is user-embedded, false otherwise
 */
export const isUserIframe = (iframe: HTMLIFrameElement): boolean => {
  return !!iframe && iframe.hasAttribute("data-user-iframe");
};

/**
 * Get all user iframes on the page
 * @returns All user iframes on the page
 */
export const getAllUserIframes = (): HTMLIFrameElement[] => {
  if (typeof window === "undefined") return [];
  const selector = "iframe[data-user-iframe]";
  return Array.from(document.querySelectorAll<HTMLIFrameElement>(selector));
};

/**
 * Determine if an iframe src URL points to an allowed provider
 */
export const isAllowedIframeUrl = (src: string): boolean => {
  try {
    const url = new URL(src);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "youtube-nocookie.com") return true;
    if (host === "youtu.be") return true;
    if (host === "player.vimeo.com" || host === "vimeo.com") return true;
    if (host.endsWith("soundcloud.com")) return true;
    if (host.endsWith("spotify.com")) return true;
    return false;
  } catch {
    return false;
  }
};

/**
 * Remove autoplay permission from an iframe
 * @param iframe - The iframe element to remove autoplay permission from
 * @returns void
 */
const removeAutoplayPermission = (iframe: HTMLIFrameElement) => {
  const allow = iframe.getAttribute("allow") || "";
  if (!allow) return;
  if (!/\bautoplay\b/i.test(allow)) return;
  iframe.setAttribute("data-original-allow", allow);
  const newAllow = allow
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== "autoplay")
    .join("; ");
  iframe.setAttribute("allow", newAllow);
};

/**
 * Restore autoplay permission to an iframe
 * @param iframe - The iframe element to restore autoplay permission to
 * @returns void
 */
const restoreAutoplayPermission = (iframe: HTMLIFrameElement) => {
  const original = iframe.getAttribute("data-original-allow");
  if (original !== null) {
    iframe.setAttribute("allow", original);
    iframe.removeAttribute("data-original-allow");
  }
};

/**
 * Mute a user iframe (best-effort across providers)
 * @param iframe - The iframe element to mute
 * @returns
 */
export const muteUserIframe = (iframe: HTMLIFrameElement): void => {
  if (!isUserIframe(iframe) || !iframe.src) return;
  try {
    const url = new URL(iframe.src);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      url.searchParams.set("mute", "1");
      iframe.src = url.toString();
      return;
    }
    if (host === "youtu.be") {
      const videoId = url.pathname.substring(1);
      iframe.src = `https://www.youtube.com/embed/${videoId}?mute=1`;
      return;
    }
    if (host === "player.vimeo.com" || host === "vimeo.com") {
      url.searchParams.set("muted", "1");
      iframe.src = url.toString();
      return;
    }
    if (host.endsWith("soundcloud.com")) {
      url.searchParams.set("auto_play", "false");
      iframe.src = url.toString();
      return;
    }
    if (host.endsWith("spotify.com")) {
      // Spotify does not support a mute flag; limit autoplay as a fallback
      removeAutoplayPermission(iframe);
      return;
    }
    // Generic fallback: remove autoplay permission
    removeAutoplayPermission(iframe);
  } catch {
    // As a last resort, remove autoplay permission
    removeAutoplayPermission(iframe);
  }
};

/**
 * Unmute a user iframe
 * @param iframe - The iframe element to unmute
 * @returns void
 */
export const unmuteUserIframe = (iframe: HTMLIFrameElement): void => {
  if (!isUserIframe(iframe) || !iframe.src) return;
  try {
    const url = new URL(iframe.src);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      url.searchParams.delete("mute");
      iframe.src = url.toString();
      return;
    }
    if (host === "youtu.be") {
      const videoId = url.pathname.substring(1);
      iframe.src = `https://www.youtube.com/embed/${videoId}`;
      return;
    }
    if (host === "player.vimeo.com" || host === "vimeo.com") {
      url.searchParams.delete("muted");
      iframe.src = url.toString();
      return;
    }
    if (host.endsWith("soundcloud.com")) {
      // No-op; SoundCloud mute toggle not supported via URL; keep autoplay controls only
      return;
    }
    if (host.endsWith("spotify.com")) {
      restoreAutoplayPermission(iframe);
      return;
    }
    // Generic fallback: restore autoplay permission if we removed it
    restoreAutoplayPermission(iframe);
  } catch {
    restoreAutoplayPermission(iframe);
  }
};

/**
 * Mute all user iframes on the page
 * @returns void
 */
export const muteAllUserIframes = (): void => {
  const iframes = getAllUserIframes();
  iframes.forEach(muteUserIframe);
};

/**
 * Unmute all user iframes on the page
 * @returns void
 */
export const unmuteAllUserIframes = (): void => {
  const iframes = getAllUserIframes();
  iframes.forEach(unmuteUserIframe);
};

/**
 * Set mute state for all user iframes
 * @param muted - The mute state to set
 * @returns void
 * @param muted
 */
export const setIframeMuteState = (muted: boolean): void => {
  if (muted) {
    muteAllUserIframes();
  } else {
    unmuteAllUserIframes();
  }
};

/**
 * Observer to automatically mute new YouTube iframes as they're added to the DOM
 */
export class IframeMuteObserver {
  private observer: MutationObserver | null = null;
  private isMuted = false;

  constructor() {
    if (typeof window === "undefined") return;

    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;

            if (
              element.tagName === "IFRAME" &&
              isUserIframe(element as HTMLIFrameElement)
            ) {
              if (this.isMuted) {
                muteUserIframe(element as HTMLIFrameElement);
              }
            }

            const userIframes =
              element.querySelectorAll?.("iframe[data-user-iframe]") || [];
            userIframes.forEach((iframe) => {
              if (this.isMuted) {
                muteUserIframe(iframe as HTMLIFrameElement);
              }
            });
          }
        });
      });
    });
  }

  start(muted = false): void {
    if (!this.observer) return;
    this.isMuted = muted;
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  stop(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    setIframeMuteState(muted);
  }
}

// Global instance
let globalIframeObserver: IframeMuteObserver | null = null;

/**
 * Initialize the global YouTube mute observer
 */
export const initIframeMuteObserver = (muted = false): IframeMuteObserver => {
  if (typeof window === "undefined") {
    return new IframeMuteObserver();
  }
  if (!globalIframeObserver) {
    globalIframeObserver = new IframeMuteObserver();
  }
  globalIframeObserver.start(muted);
  return globalIframeObserver;
};

/**
 * Get the global YouTube mute observer
 */
export const getIframeMuteObserver = (): IframeMuteObserver | null => {
  return globalIframeObserver;
};
