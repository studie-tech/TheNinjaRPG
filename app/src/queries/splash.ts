import { desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { actionLog, notification, splashAnnouncement } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { calculateContentDiff } from "@/utils/diff";
import type { SplashInput } from "@/validators/splash";

/** Read live candidates or the complete editorial archive in one round trip. */
export const listSplashEntries = (
  client: DrizzleClient,
  enabledOnly = false,
  ids?: string[],
) =>
  client
    .select()
    .from(splashAnnouncement)
    .where(
      ids
        ? inArray(splashAnnouncement.id, ids)
        : enabledOnly
          ? eq(splashAnnouncement.enabled, true)
          : undefined,
    )
    .orderBy(
      desc(splashAnnouncement.priority),
      desc(splashAnnouncement.createdAt),
      splashAnnouncement.id,
    );

/** Load an individual announcement for authorization and content-review version checks. */
export const findSplashEntry = (client: DrizzleClient, id: string) =>
  client.query.splashAnnouncement.findFirst({ where: eq(splashAnnouncement.id, id) });

/** Find a reserved editorial topic, including topics staff have disabled. */
export const findSplashTopic = (client: DrizzleClient, topicKey: string) =>
  client.query.splashAnnouncement.findFirst({
    where: eq(splashAnnouncement.topicKey, topicKey),
  });

/** Create a complete, validated announcement with an immutable topic identity. */
export const insertSplashEntry = (
  client: DrizzleClient,
  id: string,
  data: SplashInput,
) => client.insert(splashAnnouncement).values({ id, ...columnValues(data) });

/** Remove a newly inserted announcement when its creation or approval fails. */
export const deleteSplashEntryForRollback = (client: DrizzleClient, id: string) =>
  client.delete(splashAnnouncement).where(eq(splashAnnouncement.id, id));

/** Save one entry without replacing neighboring announcements or their enabled states. */
export const updateSplashEntry = (
  client: DrizzleClient,
  id: string,
  data: SplashInput,
) =>
  client
    .update(splashAnnouncement)
    .set({ ...columnValues(data), updatedAt: new Date() })
    .where(eq(splashAnnouncement.id, id));

/** Enable/disable atomically without overwriting a concurrent content edit. */
export const setSplashEntryEnabled = (
  client: DrizzleClient,
  id: string,
  enabled: boolean,
) =>
  client
    .update(splashAnnouncement)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(splashAnnouncement.id, id));

/** Preserve the authored content diff and actor in the manual content audit log. */
export const logSplashUpdate = (
  client: DrizzleClient,
  userId: string,
  id: string,
  before: Partial<SplashInput>,
  after: Partial<SplashInput>,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId,
    tableName: "splashAnnouncement",
    relatedId: id,
    relatedMsg: `Update: ${after.name ?? id}`,
    changes: calculateContentDiff(before, after),
  });

/** Recent announcements give the daily reviewer verified release/event context. */
export const listSplashAnnouncements = (client: DrizzleClient) =>
  client
    .select({ content: notification.content, createdAt: notification.createdAt })
    .from(notification)
    .orderBy(desc(notification.createdAt))
    .limit(12);

/** Match authored names across enabled and disabled entries for proposal duplicate checks. */
export const findSplashNames = (client: DrizzleClient, names: string[]) =>
  client
    .select({ name: splashAnnouncement.name })
    .from(splashAnnouncement)
    .where(inArray(splashAnnouncement.name, names));

const columnValues = (data: SplashInput) => ({
  ...data,
  startsAt: data.startsAt ? new Date(data.startsAt) : null,
  endsAt: data.endsAt ? new Date(data.endsAt) : null,
});
