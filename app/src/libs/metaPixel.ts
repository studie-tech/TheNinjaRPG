import { hasCookieConsent } from "@/libs/cookieConsent";
import { isNativeUserAgent } from "@/libs/native/userAgent";

type PixelCommand = unknown[];
type PixelQueue = {
  (...command: PixelCommand): void;
  callMethod?: (...command: PixelCommand) => void;
  queue?: PixelCommand[];
  push?: PixelQueue;
  loaded?: boolean;
  version?: string;
  disablePushState?: boolean;
};

declare global {
  interface Window {
    fbq?: PixelQueue;
    _fbq?: PixelQueue;
  }
}

const canTrack = () =>
  typeof window !== "undefined" &&
  hasCookieConsent("marketing") &&
  !isNativeUserAgent(navigator.userAgent);

/** Own one consent-gated pixel, retaining receipts locally rather than sending account IDs. */
export const createMetaPixelTracker = (pixelId: string) => {
  let enabled = false;
  let ready = false;
  let initialized = false;
  let script: HTMLScriptElement | undefined;
  let lastPath: string | undefined;
  const delivered = new Set<string>();
  const pending = new Map<string, { name: string; custom: boolean; id: string }>();

  const command = (...args: PixelCommand) => {
    try {
      window.fbq?.(...args);
      return true;
    } catch {
      enabled = false;
      pending.clear();
      return false;
    }
  };

  const flush = () => {
    if (!enabled || !ready || !canTrack()) return;
    for (const [key, event] of pending) {
      try {
        window.fbq?.(
          event.custom ? "trackSingleCustom" : "trackSingle",
          pixelId,
          event.name,
          {},
          { eventID: event.id },
        );
        delivered.add(key);
        pending.delete(key);
      } catch {
        // Blocked advertising must never interrupt navigation or reward feedback.
      }
    }
  };

  const send = (key: string, name: string, custom = false) => {
    if (!enabled || !canTrack() || delivered.has(key)) return;
    if (!pending.has(key)) pending.set(key, { name, custom, id: crypto.randomUUID() });
    flush();
  };

  return {
    enable: () => {
      if (!/^\d+$/.test(pixelId) || !canTrack()) return;
      enabled = true;
      if (!window.fbq) {
        const queue: PixelQueue = (...command) => {
          if (queue.callMethod) queue.callMethod(...command);
          else queue.queue?.push(command);
        };
        queue.queue = [];
        queue.push = queue;
        queue.loaded = true;
        queue.version = "2.0";
        window.fbq = queue;
        window._fbq = queue;
      }
      if (!initialized) {
        // Disable DOM/form inference and automatic history events; React owns page views.
        window.fbq.disablePushState = true;
        if (
          !command("consent", "revoke") ||
          !command("set", "autoConfig", false, pixelId) ||
          !command("init", pixelId)
        )
          return;
        initialized = true;
      }
      if (!command("consent", "grant")) return;
      if (window.fbq.callMethod) ready = true;
      if (!ready && !script) {
        script = document.createElement("script");
        script.async = true;
        script.src = "https://connect.facebook.net/en_US/fbevents.js";
        script.dataset.tnrMetaPixel = pixelId;
        script.onload = () => {
          ready = true;
          flush();
        };
        script.onerror = () => {
          script?.remove();
          script = undefined;
          pending.clear();
          lastPath = undefined;
        };
        document.head.append(script);
      }
      flush();
    },
    disable: () => {
      enabled = false;
      if (!ready) lastPath = undefined;
      pending.clear();
      if (initialized) command("consent", "revoke");
    },
    pageView: (pathname: string) => {
      if (!enabled || !canTrack() || pathname === lastPath) return;
      lastPath = pathname;
      // Query strings, route parameters and document content are not custom parameters.
      send(`page:${crypto.randomUUID()}`, "PageView");
    },
    confirmedConversion: (
      event: "register" | "tutorial_complete",
      receipt: string | undefined,
    ) => {
      if (!receipt) return;
      send(
        `${event}:${receipt}`,
        event === "register" ? "CompleteRegistration" : "TutorialComplete",
        event === "tutorial_complete",
      );
    },
    existingPlayer: () => send("existing-player", "ExistingPlayer", true),
  };
};

let activePixel: ReturnType<typeof createMetaPixelTracker> | undefined;
let activePixelId: string | undefined;

/** Reuse the browser pixel through route changes and React effect replays. */
export const getMetaPixelTracker = (pixelId: string) => {
  if (!activePixel || activePixelId !== pixelId) {
    activePixel?.disable();
    activePixel = createMetaPixelTracker(pixelId);
    activePixelId = pixelId;
  }
  return activePixel;
};

/** Forward only confirmed receipts; the tracker checks current consent on every event. */
export const trackMetaConversion = (
  event: "register" | "tutorial_complete",
  receipt: string | undefined,
) => {
  try {
    activePixel?.confirmedConversion(event, receipt);
  } catch {
    // Advertising is optional and must never change a successful game action.
  }
};
