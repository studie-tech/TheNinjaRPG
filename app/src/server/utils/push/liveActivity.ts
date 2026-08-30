/**
 * Server-driven Live Activity updates.
 *
 * The device starts the activity and reports a token that addresses that one activity;
 * updates then ride the same APNs connection as ordinary alerts but with
 * `apns-push-type: liveactivity` and the `.push-type.liveactivity` topic suffix, which
 * `apns.ts` derives from the push type.
 */

import * as Sentry from "@sentry/node";
import { and, eq, inArray } from "drizzle-orm";
import type { LiveActivityKind } from "@/drizzle/constants";
import { userLiveActivity } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import * as apns from "./apns";
import { summarise } from "./types";

export interface ActivityState {
  title: string;
  subtitle?: string;
  endsAt: Date;
  /** 0-1. Omitted for activities that only count down. */
  progress?: number;
}

/**
 * `content-state` must match `TNRActivityAttributes.ContentState` field for field, and
 * `endsAtEpoch` is a number on purpose: ActivityKit decodes with a stock `JSONDecoder`,
 * whose default date strategy would read a Unix timestamp as seconds since 2001.
 */
const contentState = (state: ActivityState): Record<string, unknown> => ({
  title: state.title,
  subtitle: state.subtitle ?? null,
  endsAtEpoch: Math.floor(state.endsAt.getTime() / 1000),
  progress: state.progress ?? null,
});

export const buildActivityPayload = (
  state: ActivityState,
  event: "update" | "end",
): Record<string, unknown> => ({
  aps: {
    timestamp: Math.floor(Date.now() / 1000),
    event,
    "content-state": contentState(state),
    // After this the system dims the activity as out of date rather than showing a
    // countdown that stopped being true.
    "stale-date": Math.floor(state.endsAt.getTime() / 1000),
    ...(event === "end"
      ? // Leave the finished activity up briefly so the player sees it completed.
        { "dismissal-date": Math.floor(Date.now() / 1000) + 60 }
      : {}),
  },
});

/**
 * Push a new state to every one of `userIds`' activities of this kind. Never throws;
 * activities whose token APNs has retired are deleted.
 */
export const pushActivityUpdate = async (
  client: DrizzleClient,
  userIds: string[],
  kind: LiveActivityKind,
  state: ActivityState,
  event: "update" | "end" = "update",
): Promise<void> => {
  const recipients = [...new Set(userIds)].filter(Boolean);
  if (recipients.length === 0 || !apns.isConfigured()) return;

  try {
    const activities = await client
      .select({ token: userLiveActivity.pushToken })
      .from(userLiveActivity)
      .where(
        and(
          inArray(userLiveActivity.userId, recipients),
          eq(userLiveActivity.kind, kind),
        ),
      );
    if (activities.length === 0) return;

    const results = await apns.sendBatch(
      activities.map((activity) => ({
        token: activity.token,
        payload: buildActivityPayload(state, event),
        pushType: "liveactivity" as const,
        priority: 10 as const,
      })),
    );

    const summary = summarise(results);
    // An ended activity's token stops working, so pruning also cleans up after the
    // device ending one locally without telling us.
    const gone =
      event === "end"
        ? activities.map((activity) => activity.token)
        : summary.expiredTokens;
    if (gone.length > 0) {
      await client
        .delete(userLiveActivity)
        .where(inArray(userLiveActivity.pushToken, gone));
    }
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "pushActivityUpdate", kind },
    });
  }
};
