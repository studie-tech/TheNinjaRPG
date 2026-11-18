import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { TUTORIAL_GENIN_EXAM_QUEST_ID } from "@/drizzle/constants";
import { metaConsent, metaTracking, questHistory } from "@/drizzle/schema";
import { CONSENT_REVISION } from "@/libs/consentConfig";
import type { DrizzleClient } from "@/server/db";
import type { MetaTrackingInput } from "@/validators/metaTracking";

/** Persist consent monotonically; a denial wins when two requests carry the same time. */
export const recordMetaConsent = (
  client: DrizzleClient,
  input: {
    consentId: string;
    decidedAt: Date;
    granted: boolean;
    userId?: string;
  },
) =>
  client
    .insert(metaConsent)
    .values({
      id: input.consentId,
      userId: input.userId,
      decidedAt: input.decidedAt,
      granted: input.granted,
      revision: CONSENT_REVISION,
      expiresAt: new Date(input.decidedAt.getTime() + 180 * 86_400_000),
    })
    .onDuplicateKeyUpdate({
      set: {
        // Evaluate the decision before updating its timestamp: MySQL assigns left to right.
        granted: sql`IF(VALUES(decidedAt) > ${metaConsent.decidedAt}, VALUES(granted), IF(VALUES(decidedAt) = ${metaConsent.decidedAt}, ${metaConsent.granted} AND VALUES(granted), ${metaConsent.granted}))`,
        revision: sql`IF(VALUES(decidedAt) >= ${metaConsent.decidedAt}, VALUES(revision), ${metaConsent.revision})`,
        userId: sql`IF(VALUES(decidedAt) >= ${metaConsent.decidedAt}, COALESCE(VALUES(userId), ${metaConsent.userId}), ${metaConsent.userId})`,
        expiresAt: sql`IF(VALUES(decidedAt) >= ${metaConsent.decidedAt}, VALUES(expiresAt), ${metaConsent.expiresAt})`,
        decidedAt: sql`GREATEST(${metaConsent.decidedAt}, VALUES(decidedAt))`,
      },
    });

/** Capture matching data only from a still-current granted decision; event IDs never rotate. */
export const captureMetaTracking = (
  client: DrizzleClient,
  userId: string,
  input: MetaTrackingInput,
  userAgent: string,
  registrationAt?: Date,
) =>
  client
    .insert(metaTracking)
    .select(
      client
        .select({
          userId: sql<string>`${userId}`.as("userId"),
          consentId: metaConsent.id,
          decidedAt: metaConsent.decidedAt,
          expiresAt:
            sql<Date>`LEAST(${metaConsent.expiresAt}, CURRENT_TIMESTAMP(3) + INTERVAL 90 DAY)`.as(
              "expiresAt",
            ),
          fbc: sql<string | null>`${input.fbc ?? null}`.as("fbc"),
          fbp: sql<string | null>`${input.fbp ?? null}`.as("fbp"),
          userAgent: sql<string>`${userAgent.slice(0, 1024)}`.as("userAgent"),
          registrationAt:
            sql<Date | null>`${registrationAt?.toISOString().slice(0, 23).replace("T", " ") ?? null}`.as(
              "registrationAt",
            ),
          registrationEventId: sql<string>`${crypto.randomUUID()}`.as(
            "registrationEventId",
          ),
          tutorialEventId: sql<string>`${crypto.randomUUID()}`.as("tutorialEventId"),
          registrationReportedAt: sql<Date | null>`NULL`.as("registrationReportedAt"),
          tutorialReportedAt: sql<Date | null>`NULL`.as("tutorialReportedAt"),
          tutorialUserAgent: sql<string | null>`NULL`.as("tutorialUserAgent"),
        })
        .from(metaConsent)
        .where(
          and(
            eq(metaConsent.id, input.consentId),
            eq(metaConsent.granted, true),
            eq(metaConsent.revision, CONSENT_REVISION),
            eq(metaConsent.decidedAt, new Date(input.decidedAt)),
            eq(metaConsent.userId, userId),
            gte(metaConsent.expiresAt, sql`CURRENT_TIMESTAMP(3)`),
          ),
        ),
    )
    .onDuplicateKeyUpdate({
      set: {
        consentId: sql`IF(VALUES(decidedAt) >= ${metaTracking.decidedAt}, VALUES(consentId), ${metaTracking.consentId})`,
        expiresAt: sql`IF(VALUES(decidedAt) >= ${metaTracking.decidedAt}, VALUES(expiresAt), ${metaTracking.expiresAt})`,
        fbc: sql`IF(VALUES(decidedAt) >= ${metaTracking.decidedAt}, VALUES(fbc), ${metaTracking.fbc})`,
        fbp: sql`IF(VALUES(decidedAt) >= ${metaTracking.decidedAt}, VALUES(fbp), ${metaTracking.fbp})`,
        userAgent: sql`IF(VALUES(decidedAt) >= ${metaTracking.decidedAt}, VALUES(userAgent), ${metaTracking.userAgent})`,
        registrationAt: sql`COALESCE(${metaTracking.registrationAt}, VALUES(registrationAt))`,
        decidedAt: sql`GREATEST(${metaTracking.decidedAt}, VALUES(decidedAt))`,
      },
    });

/** Withdraw every decision linked to the signed-in account as well as this browser. */
export const withdrawMetaAccountConsent = (
  client: DrizzleClient,
  userId: string,
  decidedAt: Date,
) =>
  client
    .update(metaConsent)
    .set({ granted: false, decidedAt })
    .where(and(eq(metaConsent.userId, userId), lte(metaConsent.decidedAt, decidedAt)));

/** Erase matching data after invalidating consent, retaining only opaque deduplication receipts. */
export const clearWithdrawnMetaTracking = (
  client: DrizzleClient,
  consentId: string,
  userId?: string,
) =>
  client
    .update(metaTracking)
    .set({ fbc: null, fbp: null, userAgent: "", tutorialUserAgent: null })
    .where(
      and(
        or(
          eq(metaTracking.consentId, consentId),
          userId ? eq(metaTracking.userId, userId) : undefined,
        ),
        inArray(
          metaTracking.consentId,
          client
            .select({ id: metaConsent.id })
            .from(metaConsent)
            .where(eq(metaConsent.granted, false)),
        ),
      ),
    );

/** Record a confirmed web completion without inferring the source from an older signup. */
export const captureMetaTutorialCompletion = (
  client: DrizzleClient,
  userId: string,
  userAgent: string,
) =>
  client
    .update(metaTracking)
    .set({ tutorialUserAgent: userAgent.slice(0, 1024) })
    .where(
      and(
        eq(metaTracking.userId, userId),
        isNull(metaTracking.tutorialUserAgent),
        inArray(
          metaTracking.consentId,
          client
            .select({ id: metaConsent.id })
            .from(metaConsent)
            .where(eq(metaConsent.granted, true)),
        ),
      ),
    );

/** Read confirmed, consented conversions within Meta's deduplication window. */
export const selectMetaConversions = (
  client: DrizzleClient,
  action: "register" | "tutorial_complete",
  options: { userId?: string; pendingOnly?: boolean; limit?: number } = {},
) => {
  const isRegistration = action === "register";
  const occurredAt = isRegistration ? metaTracking.registrationAt : questHistory.endAt;
  const query = client
    .select({
      userId: metaTracking.userId,
      consentId: metaTracking.consentId,
      decidedAt: metaTracking.decidedAt,
      fbc: metaTracking.fbc,
      fbp: metaTracking.fbp,
      userAgent: isRegistration
        ? metaTracking.userAgent
        : sql<string>`COALESCE(${metaTracking.tutorialUserAgent}, '')`,
      eventId: isRegistration
        ? metaTracking.registrationEventId
        : metaTracking.tutorialEventId,
      occurredAt: sql<Date>`${occurredAt}`.mapWith(occurredAt),
    })
    .from(metaTracking)
    .innerJoin(
      metaConsent,
      and(
        eq(metaConsent.id, metaTracking.consentId),
        eq(metaConsent.userId, metaTracking.userId),
        eq(metaConsent.decidedAt, metaTracking.decidedAt),
      ),
    )
    .leftJoin(
      questHistory,
      and(
        eq(questHistory.userId, metaTracking.userId),
        eq(questHistory.questId, TUTORIAL_GENIN_EXAM_QUEST_ID),
        eq(questHistory.completed, 1),
      ),
    )
    .where(
      and(
        eq(metaConsent.granted, true),
        eq(metaConsent.revision, CONSENT_REVISION),
        gte(metaTracking.expiresAt, sql`CURRENT_TIMESTAMP(3)`),
        or(isNotNull(metaTracking.fbc), isNotNull(metaTracking.fbp)),
        sql`${metaTracking.userAgent} <> ''`,
        isNotNull(occurredAt),
        isRegistration ? undefined : isNotNull(metaTracking.tutorialUserAgent),
        gte(occurredAt, metaTracking.decidedAt),
        // Both browser and server stop after 47 hours, inside Meta's 48-hour deduplication.
        gte(occurredAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 47 HOUR`),
        options.userId ? eq(metaTracking.userId, options.userId) : undefined,
        options.pendingOnly
          ? isNull(
              isRegistration
                ? metaTracking.registrationReportedAt
                : metaTracking.tutorialReportedAt,
            )
          : undefined,
      ),
    )
    .orderBy(occurredAt)
    .limit(options.limit ?? 100);
  return query;
};

/** Mark an accepted event only while its original consent remains current. */
export const markMetaConversionReported = (
  client: DrizzleClient,
  row: { userId: string; decidedAt: Date },
  action: "register" | "tutorial_complete",
) =>
  client
    .update(metaTracking)
    .set(
      action === "register"
        ? { registrationReportedAt: new Date() }
        : { tutorialReportedAt: new Date() },
    )
    .where(
      and(
        eq(metaTracking.userId, row.userId),
        eq(metaTracking.decidedAt, row.decidedAt),
      ),
    );

/** Purge matching data after 90 inactive days and decisions when their 180-day consent expires. */
export const deleteExpiredMetaTracking = (client: DrizzleClient) =>
  Promise.all([
    client
      .delete(metaTracking)
      .where(lt(metaTracking.expiresAt, sql`CURRENT_TIMESTAMP(3)`)),
    client
      .delete(metaConsent)
      .where(lt(metaConsent.expiresAt, sql`CURRENT_TIMESTAMP(3)`)),
  ]);
