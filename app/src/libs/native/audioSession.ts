/**
 * Background audio. The `tnr-audio-session` plugin sets `AVAudioSession` to `.playback` on
 * iOS and runs a foreground service with a `MediaSession` on Android, so the soundtrack
 * survives the screen locking.
 *
 * This only configures the session — playback stays with `useAudio`, which already handles
 * the iOS requirement that the first play follow a user gesture.
 */

import { addNativeListener, getPlatform, invoke, invokeSafe, isNative } from "./bridge";

const PLUGIN = "TNRAudioSession";

export interface NowPlaying {
  title: string;
  artist?: string;
  /** Absolute URL of the artwork shown on the Lock Screen. */
  artworkUrl?: string;
}

/** Claim the audio session and report whether the native plugin accepted it. */
export const activate = async (): Promise<boolean> => {
  if (!isNative()) return false;
  try {
    await invoke(PLUGIN, "activate");
    return true;
  } catch {
    return false;
  }
};

/**
 * Release audio focus so other apps can resume. Keep the transport and metadata only
 * for a remote Pause; turning Music off clears them as well.
 */
export const deactivate = async (preserveControls = false): Promise<void> => {
  await invokeSafe(PLUGIN, "deactivate", { preserveControls });
  if (getPlatform() === "ios" && "mediaSession" in navigator) {
    navigator.mediaSession.playbackState = preserveControls ? "paused" : "none";
    if (!preserveControls) navigator.mediaSession.metadata = null;
  }
};

/** Populate the Lock Screen / Control Center transport. */
export const setNowPlaying = async (info: NowPlaying): Promise<void> => {
  await invokeSafe(PLUGIN, "setNowPlaying", { ...info });
  // WKWebView owns the HTML audio session and otherwise replaces the native title
  // with the document title when the screen locks.
  if (
    getPlatform() === "ios" &&
    "mediaSession" in navigator &&
    typeof MediaMetadata !== "undefined"
  ) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: info.title,
      artist: info.artist,
      artwork: info.artworkUrl ? [{ src: info.artworkUrl }] : [],
    });
    navigator.mediaSession.playbackState = "playing";
  }
};

export type RemoteCommand = "play" | "pause" | "toggle";

/**
 * React to the Lock Screen transport controls. Returns an unsubscribe function that is
 * safe to call even when no listener was ever attached.
 */
export const onRemoteCommand = (
  handler: (command: RemoteCommand) => void,
): (() => void) => {
  const removeNativeListener = addNativeListener(PLUGIN, "remoteCommand", (data) => {
    const command = (data as { command?: unknown } | null)?.command;
    if (command === "play" || command === "pause" || command === "toggle") {
      handler(command);
    }
  });
  // WKWebView also owns transport commands for HTML audio. Route them through the
  // same preference guard as the native plugin instead of WebKit's default player.
  const session =
    isNative() && getPlatform() === "ios" && "mediaSession" in navigator
      ? navigator.mediaSession
      : undefined;
  session?.setActionHandler("play", () => handler("play"));
  session?.setActionHandler("pause", () => handler("pause"));
  return () => {
    removeNativeListener();
    session?.setActionHandler("play", null);
    session?.setActionHandler("pause", null);
  };
};
