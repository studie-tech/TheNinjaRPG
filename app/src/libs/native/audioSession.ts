/**
 * Background audio. The `tnr-audio-session` plugin sets `AVAudioSession` to `.playback` on
 * iOS and runs a foreground service with a `MediaSession` on Android, so the soundtrack
 * survives the screen locking.
 *
 * This only configures the session — playback stays with `useAudio`, which already handles
 * the iOS requirement that the first play follow a user gesture.
 */

import { addNativeListener, getPlatform, invokeSafe } from "./bridge";

const PLUGIN = "TNRAudioSession";

export interface NowPlaying {
  title: string;
  artist?: string;
  /** Absolute URL of the artwork shown on the Lock Screen. */
  artworkUrl?: string;
}

/** Claim the audio session. Call this before the first play, not at launch. */
export const activate = async (): Promise<void> => {
  await invokeSafe(PLUGIN, "activate");
};

/**
 * Release the session so other apps regain audio focus. Call whenever the player turns
 * music off — holding a `.playback` session with nothing playing keeps other apps ducked.
 */
export const deactivate = async (): Promise<void> => {
  await invokeSafe(PLUGIN, "deactivate");
  if (getPlatform() === "ios" && "mediaSession" in navigator) {
    navigator.mediaSession.metadata = null;
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
  }
};

export type RemoteCommand = "play" | "pause" | "toggle";

/**
 * React to the Lock Screen transport controls. Returns an unsubscribe function that is
 * safe to call even when no listener was ever attached.
 */
export const onRemoteCommand = (
  handler: (command: RemoteCommand) => void,
): (() => void) =>
  addNativeListener(PLUGIN, "remoteCommand", (data) => {
    const command = (data as { command?: unknown } | null)?.command;
    if (command === "play" || command === "pause" || command === "toggle") {
      handler(command);
    }
  });
