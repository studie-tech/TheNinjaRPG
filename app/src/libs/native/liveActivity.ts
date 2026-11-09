/**
 * Live Activities, driven by the native `TNRLiveActivity` plugin in `mobile/`: ActivityKit
 * on iOS 16.2+, and an ongoing countdown notification on Android.
 *
 * On iOS the device starts an activity and reports back a per-activity push token; the
 * server then updates and ends it over APNs with `apns-push-type: liveactivity`. Every
 * call resolves to `undefined` on the web and wherever the plugin is not registered.
 */

import type { LiveActivityKind } from "@/drizzle/constants";
import { addNativeListener, hasPlugin, invokeSafe, isNative } from "./bridge";

const PLUGIN = "TNRLiveActivity";

export interface LiveActivityState {
  /**
   * When the countdown ends. Sent to the plugins as epoch milliseconds rather than an
   * ISO string: Android would need `java.time` to parse one, which is unavailable below
   * API 26 without core library desugaring, and ActivityKit's own decoder has its own
   * opinions about dates.
   */
  endsAt: Date;
  /** Headline shown on the Lock Screen, e.g. "Recovering" or "Training Ninjutsu". */
  title: string;
  /** Secondary line — the stat being trained, the village being defended. */
  subtitle?: string;
  /** 0-1. Omitted for activities that only count down. */
  progress?: number;
}

export interface StartedActivity {
  activityId: string;
}

/** Whether this shell can host Live Activities at all. */
export const isSupported = (): boolean => isNative() && hasPlugin(PLUGIN);

const toPayload = (state: LiveActivityState) => ({
  title: state.title,
  subtitle: state.subtitle,
  endsAtEpochMs: state.endsAt.getTime(),
  progress: state.progress,
});

export const start = async (
  kind: LiveActivityKind,
  state: LiveActivityState,
): Promise<StartedActivity | undefined> =>
  invokeSafe<StartedActivity>(PLUGIN, "start", { kind, ...toPayload(state) });

export const end = async (activityId: string): Promise<void> => {
  await invokeSafe(PLUGIN, "end", { activityId });
};

/** End every surviving activity of one kind, including ones from an earlier process. */
export const endKind = async (kind: LiveActivityKind): Promise<void> => {
  await invokeSafe(PLUGIN, "endKind", { kind });
};

/** End every activity this app started — used on sign-out. */
export const endAll = async (): Promise<void> => {
  await invokeSafe(PLUGIN, "endAll");
};

/**
 * The APNs token for a started activity, which is what lets the server push updates.
 *
 * It arrives after `start` resolves and Apple may reissue it at any time, so this is an
 * event rather than a return value: a token captured once and cached would silently stop
 * working.
 */
export const onToken = (
  callback: (activity: { activityId: string; pushToken: string }) => void,
): (() => void) =>
  addNativeListener(PLUGIN, "activityToken", (data) => {
    const payload = data as { activityId?: unknown; pushToken?: unknown } | null;
    if (typeof payload?.activityId !== "string") return;
    if (typeof payload?.pushToken !== "string") return;
    callback({ activityId: payload.activityId, pushToken: payload.pushToken });
  });
