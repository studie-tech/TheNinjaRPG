import { platform } from "@/libs/native";
import { safeLocalStorageGetItem } from "@/utils/storage";

type AudioPreference = "musicOn" | "sfxOn" | "buttonSfxOn";

// Local playback choices last only until a full page reload, keeping each dev visit quiet.
const localPreferences: Partial<Record<AudioPreference, boolean>> = {};

export const isLocalAudioSession = (): boolean =>
  typeof window !== "undefined" &&
  platform() === "web" &&
  ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);

/** Resolve playback without letting account or persisted preferences unmute localhost. */
export const getAudioPreference = (
  key: AudioPreference,
  accountPreference?: boolean,
): boolean => {
  if (isLocalAudioSession()) return localPreferences[key] ?? false;
  return accountPreference ?? safeLocalStorageGetItem(key) !== "false";
};

/** Return whether the preference was handled locally instead of needing persistence. */
export const setLocalAudioPreference = (
  key: AudioPreference,
  enabled: boolean,
): boolean => {
  if (!isLocalAudioSession()) return false;
  localPreferences[key] = enabled;
  return true;
};
