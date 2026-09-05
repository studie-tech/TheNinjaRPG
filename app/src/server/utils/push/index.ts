/**
 * The only entry point for sending push notifications.
 *
 * Callers name the users and the message; this resolves devices, honours per-category
 * opt-outs, fans out to APNs and FCM in parallel and prunes tokens the providers reject.
 * It never throws — a failed send is reported to Sentry and reflected in the summary, so a
 * push outage can never take a game action down with it.
 */

import * as Sentry from "@sentry/node";
import { and, eq, gte, inArray } from "drizzle-orm";
import {
  PUSH_TOKEN_STALE_DAYS,
  type PushCategory,
  type PushPlatform,
} from "@/drizzle/constants";
import { userDevice, userPushPreference } from "@/drizzle/schema";
import { secondsFromNow } from "@/utils/time";
import type { DrizzleClient } from "@/server/db";
import * as apns from "./apns";
import * as fcm from "./fcm";
import { emptySummary, type PushMessage, type PushResult, summarise } from "./types";
import type { PushSendSummary } from "./types";

export { announcement, deliveryTest, toPlainText } from "./messages";
export type { PushMessage, PushSendSummary } from "./types";

/** Whether either transport is configured. False in local development by default. */
export const isPushEnabled = (): boolean => apns.isConfigured() || fcm.isConfigured();

/**
 * Deliver `message` to every registered device of `userIds` that has not muted the
 * category. Returns what happened; the caller may ignore it.
 */
export const sendPushToUsers = async (
  client: DrizzleClient,
  userIds: string[],
  message: PushMessage,
): Promise<PushSendSummary> => {
  const recipients = [...new Set(userIds)].filter(Boolean);
  if (recipients.length === 0 || !isPushEnabled()) return emptySummary();

  try {
    // A device that has not checked in for a season is almost certainly uninstalled;
    // skipping it keeps the fan-out small without needing a separate cleanup job.
    const freshSince = secondsFromNow(-PUSH_TOKEN_STALE_DAYS * 24 * 60 * 60);
    const [devices, optOuts] = await Promise.all([
      client
        .select({
          userId: userDevice.userId,
          token: userDevice.token,
          platform: userDevice.platform,
        })
        .from(userDevice)
        .where(
          and(
            inArray(userDevice.userId, recipients),
            gte(userDevice.lastSeenAt, freshSince),
          ),
        ),
      client
        .select({ userId: userPushPreference.userId })
        .from(userPushPreference)
        .where(
          and(
            inArray(userPushPreference.userId, recipients),
            eq(userPushPreference.category, message.category),
            eq(userPushPreference.enabled, false),
          ),
        ),
    ]);

    const muted = new Set(optOuts.map((row) => row.userId));
    const targets = devices.filter((device) => !muted.has(device.userId));
    if (targets.length === 0) return emptySummary();

    const byPlatform = groupTokensByPlatform(targets);
    const [iosResults, androidResults] = await Promise.all([
      apns.sendAlerts(byPlatform.ios, message),
      fcm.sendAlerts(byPlatform.android, message),
    ]);

    const summary = summarise([...iosResults, ...androidResults]);
    await pruneExpiredTokens(client, summary.expiredTokens);
    reportFailures([...iosResults, ...androidResults], message.category);
    return summary;
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "sendPushToUsers", category: message.category },
    });
    return emptySummary();
  }
};

/** Delete tokens a provider reported as gone. */
export const pruneExpiredTokens = async (
  client: DrizzleClient,
  tokens: string[],
): Promise<void> => {
  if (tokens.length === 0) return;
  await client.delete(userDevice).where(inArray(userDevice.token, tokens));
};

const groupTokensByPlatform = (
  devices: { token: string; platform: PushPlatform }[],
): Record<"ios" | "android", string[]> => {
  const grouped: Record<"ios" | "android", string[]> = { ios: [], android: [] };
  for (const device of devices) {
    if (device.platform === "ios" || device.platform === "android") {
      grouped[device.platform].push(device.token);
    }
  }
  return grouped;
};

/**
 * Report one aggregated warning per send rather than one per token, so a provider outage
 * does not flood Sentry with thousands of identical events.
 */
const reportFailures = (results: PushResult[], category: PushCategory): void => {
  const failures = results.filter((result) => result.status === "failed");
  if (failures.length === 0) return;
  const reasons = [...new Set(failures.map((failure) => failure.reason))].slice(0, 5);
  Sentry.captureMessage(`Push delivery failed for ${failures.length} device(s)`, {
    level: "warning",
    tags: { source: "sendPushToUsers", category },
    extra: { reasons, total: results.length },
  });
};
