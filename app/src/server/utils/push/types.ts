import type { PushCategory, PushPlatform } from "@/drizzle/constants";

/** One rendered notification, ready for either transport. */
export interface PushMessage {
  title: string;
  body: string;
  category: PushCategory;
  /** In-app path opened when the notification is tapped, e.g. `/battlearena`. */
  url?: string;
  /**
   * Collapse key. A second message with the same id replaces the first in the shade
   * instead of stacking — use it for anything that supersedes itself, like a war timer.
   */
  collapseId?: string;
  /** Unread count to show on the app icon. Omitted leaves the badge untouched. */
  badge?: number;
  /** Extra values handed to the app; must be JSON-serialisable and small. */
  data?: Record<string, string>;
}

export interface PushTarget {
  token: string;
  platform: PushPlatform;
}

/** Outcome for a single token. `retryable` failures leave the token in place. */
export type PushResult =
  | { token: string; status: "sent" }
  | { token: string; status: "expired"; reason: string }
  | { token: string; status: "failed"; reason: string; retryable: boolean };

export interface PushSendSummary {
  sent: number;
  failed: number;
  /** Tokens the provider rejected as gone; the caller deletes these rows. */
  expiredTokens: string[];
}

export const emptySummary = (): PushSendSummary => ({
  sent: 0,
  failed: 0,
  expiredTokens: [],
});

export const summarise = (results: PushResult[]): PushSendSummary =>
  results.reduce<PushSendSummary>((summary, result) => {
    if (result.status === "sent") {
      summary.sent += 1;
      return summary;
    }
    summary.failed += 1;
    if (result.status === "expired") summary.expiredTokens.push(result.token);
    return summary;
  }, emptySummary());

/**
 * APNs reasons that mean this specific device token is dead.
 *
 * Deliberately narrow. `BadDeviceToken` can mean the token was sent to the wrong APNs
 * environment, while `DeviceTokenNotForTopic` can mean the bundle id is misconfigured.
 * Either can reject every token at once, so pruning on them could empty the table after
 * one bad deploy.
 */
const DEAD_APNS_REASONS = new Set(["Unregistered", "ExpiredToken"]);

export const isDeadApnsToken = (status: number, reason: string): boolean =>
  status === 410 || DEAD_APNS_REASONS.has(reason);

/**
 * FCM codes that mean the registration token is gone.
 *
 * `UNREGISTERED` is the only one that says so specifically. `INVALID_ARGUMENT` covers a
 * malformed payload as well as a malformed token, and `NOT_FOUND` is the HTTP status
 * behind several unrelated failures including a wrong project id — both would be returned
 * for every device in the batch at once.
 */
const DEAD_FCM_CODES = new Set(["UNREGISTERED"]);

export const isDeadFcmToken = (code: string): boolean => DEAD_FCM_CODES.has(code);
