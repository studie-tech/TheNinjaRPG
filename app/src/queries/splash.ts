import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { actionLog, notification, splashAnnouncement } from "@/drizzle/schema";
import { SPLASH_ID } from "@/libs/splash";
import type { DrizzleClient } from "@/server/db";
import { calculateContentDiff } from "@/utils/diff";
import type { SplashContent } from "@/validators/splash";

/** Load the single welcome board; callers supply the evergreen edition when absent. */
export const findSplash = (client: DrizzleClient) =>
  client.query.splashAnnouncement.findFirst({
    where: eq(splashAnnouncement.id, SPLASH_ID),
  });

/** Publish a validated board through the same write for staff edits and approved proposals. */
export const saveSplash = (client: DrizzleClient, content: SplashContent) =>
  client
    .insert(splashAnnouncement)
    .values({ id: SPLASH_ID, content })
    .onDuplicateKeyUpdate({ set: { content } });

/** Preserve the content diff alongside other manual content changes. */
export const logSplashUpdate = (
  client: DrizzleClient,
  userId: string,
  before: SplashContent,
  after: SplashContent,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId,
    tableName: "splashAnnouncement",
    relatedId: SPLASH_ID,
    relatedMsg: `Update: ${after.name}`,
    changes: calculateContentDiff(before, after),
  });

/** Bounded recent announcements supply verified release/event context for the daily reviewer. */
export const listSplashAnnouncements = (client: DrizzleClient) =>
  client
    .select({ content: notification.content, createdAt: notification.createdAt })
    .from(notification)
    .orderBy(desc(notification.createdAt))
    .limit(12);
