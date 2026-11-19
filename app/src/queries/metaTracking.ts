import { createHash } from "node:crypto";
import {
  and,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { alias } from "drizzle-orm/mysql-core";
import { TUTORIAL_GENIN_EXAM_QUEST_ID } from "@/drizzle/constants";
import {
  accountDeletion,
  metaConsent,
  metaTracking,
  questHistory,
  storeUserIdAlias,
  userData,
} from "@/drizzle/schema";
import { CONSENT_REVISION } from "@/libs/consentConfig";
import type { DrizzleClient } from "@/server/db";
import type { MetaTrackingInput } from "@/validators/metaTracking";

type MetaTrackingClient = Pick<
  DrizzleClient,
  "select" | "insert" | "update" | "delete" | "query"
>;
const accountWithdrawal = alias(metaConsent, "metaAccountWithdrawal");

const liveIdentity = (client: MetaTrackingClient, userId: string | AnyMySqlColumn) =>
  and(
    notExists(
      client
        .select({ id: storeUserIdAlias.oldUserId })
        .from(storeUserIdAlias)
        .where(eq(storeUserIdAlias.oldUserId, userId)),
    ),
    notExists(
      client
        .select({ id: accountDeletion.userId })
        .from(accountDeletion)
        .where(eq(accountDeletion.userId, userId)),
    ),
  );
const liveAccount = (client: MetaTrackingClient, userId: string | AnyMySqlColumn) =>
  exists(
    client
      .select({ id: userData.userId })
      .from(userData)
      .where(and(eq(userData.userId, userId), liveIdentity(client, userId))),
  );
const noLaterWithdrawal = (
  client: MetaTrackingClient,
  userId: string | AnyMySqlColumn,
  decidedAt: Date | AnyMySqlColumn,
) =>
  notExists(
    client
      .select({ id: accountWithdrawal.id })
      .from(accountWithdrawal)
      .where(
        and(
          eq(accountWithdrawal.userId, userId),
          gte(accountWithdrawal.withdrawnAt, decidedAt),
        ),
      ),
  );
const currentTrackingConsent = (client: MetaTrackingClient) =>
  and(
    eq(metaConsent.id, metaTracking.consentId),
    eq(metaConsent.userId, metaTracking.userId),
    eq(metaConsent.decidedAt, metaTracking.decidedAt),
    eq(metaConsent.granted, true),
    eq(metaConsent.revision, CONSENT_REVISION),
    gte(metaConsent.expiresAt, sql`CURRENT_TIMESTAMP(3)`),
    gte(metaTracking.expiresAt, sql`CURRENT_TIMESTAMP(3)`),
    liveAccount(client, metaTracking.userId),
    noLaterWithdrawal(client, metaTracking.userId, metaTracking.decidedAt),
  );

/** Serialize Meta's multi-row save with identity retirement, without locking absent alias rows. */
export const lockMetaTrackingAccount = (client: MetaTrackingClient, userId: string) =>
  client
    .select({ userId: userData.userId })
    .from(userData)
    .where(eq(userData.userId, userId))
    .for("update");

/** Check retirement after acquiring the account row lock, using a fresh consistent read. */
export const findLiveMetaTrackingAccount = (
  client: MetaTrackingClient,
  userId: string,
) =>
  client
    .select({ userId: userData.userId })
    .from(userData)
    .where(and(eq(userData.userId, userId), liveIdentity(client, userId)))
    .limit(1);

/** Keep an account's withdrawal barrier even when its browser later grants consent again. */
export const findLatestMetaWithdrawal = (client: MetaTrackingClient, userId: string) =>
  client.query.metaConsent.findFirst({
    columns: { withdrawnAt: true },
    where: and(eq(metaConsent.userId, userId), isNotNull(metaConsent.withdrawnAt)),
    orderBy: desc(metaConsent.withdrawnAt),
  });

/** Wait for earlier Meta saves after publishing retirement, before removing their rows. */
export const waitForMetaSavesBeforeDeletion = (
  client: MetaTrackingClient,
  userId: string,
) =>
  client
    .update(userData)
    .set({ userId: sql`${userData.userId}` })
    .where(eq(userData.userId, userId));

/** Persist consent monotonically; a denial wins when two requests carry the same time. */
export const recordMetaConsent = (
  client: MetaTrackingClient,
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
      withdrawnAt: !input.granted && input.userId ? input.decidedAt : null,
      granted: input.granted,
      revision: CONSENT_REVISION,
      expiresAt: new Date(input.decidedAt.getTime() + 180 * 86_400_000),
    })
    .onDuplicateKeyUpdate({
      set: {
        // Evaluate the decision before updating its timestamp: MySQL assigns left to right.
        granted: sql`IF(VALUES(decidedAt) > ${metaConsent.decidedAt}, VALUES(granted), IF(VALUES(decidedAt) = ${metaConsent.decidedAt}, ${metaConsent.granted} AND VALUES(granted), ${metaConsent.granted}))`,
        revision: sql`IF(VALUES(decidedAt) >= ${metaConsent.decidedAt}, VALUES(revision), ${metaConsent.revision})`,
        withdrawnAt: sql`IF(VALUES(granted) = FALSE AND (VALUES(userId) IS NOT NULL OR ${metaConsent.userId} IS NOT NULL), GREATEST(COALESCE(${metaConsent.withdrawnAt}, VALUES(decidedAt)), VALUES(decidedAt)), ${metaConsent.withdrawnAt})`,
        userId: sql`IF(VALUES(decidedAt) >= ${metaConsent.decidedAt}, COALESCE(VALUES(userId), ${metaConsent.userId}), ${metaConsent.userId})`,
        expiresAt: sql`IF(VALUES(decidedAt) >= ${metaConsent.decidedAt}, VALUES(expiresAt), ${metaConsent.expiresAt})`,
        decidedAt: sql`GREATEST(${metaConsent.decidedAt}, VALUES(decidedAt))`,
      },
    });

/** Persist account withdrawal under a server-owned key that browser UUID inputs cannot replace. */
export const recordMetaAccountWithdrawal = (
  client: MetaTrackingClient,
  userId: string,
  decidedAt: Date,
) =>
  recordMetaConsent(client, {
    // The 144-bit digest fits the existing key and is deliberately not a browser UUID.
    // Its account association survives browser transfers and follows staff ID renames.
    consentId: createHash("sha256")
      .update(`meta-account-withdrawal:${userId}`)
      .digest("hex")
      .slice(0, 36),
    userId,
    decidedAt,
    granted: false,
  });

/** Capture matching data only from a still-current granted decision; event IDs never rotate. */
export const captureMetaTracking = (
  client: MetaTrackingClient,
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
            liveAccount(client, userId),
            noLaterWithdrawal(client, userId, new Date(input.decidedAt)),
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
  client: MetaTrackingClient,
  userId: string,
  decidedAt: Date,
) =>
  client
    .update(metaConsent)
    .set({
      granted: false,
      decidedAt,
      withdrawnAt: sql`GREATEST(COALESCE(${metaConsent.withdrawnAt}, ${decidedAt.toISOString().slice(0, 23).replace("T", " ")}), ${decidedAt.toISOString().slice(0, 23).replace("T", " ")})`,
    })
    .where(and(eq(metaConsent.userId, userId), lte(metaConsent.decidedAt, decidedAt)));

/** Erase matching data after invalidating consent, retaining only opaque deduplication receipts. */
export const clearWithdrawnMetaTracking = (
  client: MetaTrackingClient,
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
  client: MetaTrackingClient,
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
            .where(currentTrackingConsent(client)),
        ),
      ),
    );

/** Read confirmed, consented conversions within Meta's deduplication window. */
export const selectMetaConversions = (
  client: MetaTrackingClient,
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
        currentTrackingConsent(client),
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
  client: MetaTrackingClient,
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
export const deleteExpiredMetaTracking = (client: MetaTrackingClient) =>
  Promise.all([
    client
      .delete(metaTracking)
      .where(lt(metaTracking.expiresAt, sql`CURRENT_TIMESTAMP(3)`)),
    client
      .delete(metaConsent)
      .where(lt(metaConsent.expiresAt, sql`CURRENT_TIMESTAMP(3)`)),
  ]);

/** Revalidate the exact decisions selected for dispatch after both conversion reads finish. */
export const selectMetaConsentForDispatch = (
  client: MetaTrackingClient,
  candidates: { userId: string; consentId: string; decidedAt: Date }[],
) =>
  client
    .select({
      userId: metaTracking.userId,
      consentId: metaTracking.consentId,
      decidedAt: metaTracking.decidedAt,
    })
    .from(metaTracking)
    .innerJoin(metaConsent, eq(metaConsent.id, metaTracking.consentId))
    .where(
      and(
        currentTrackingConsent(client),
        or(
          ...candidates.map((row) =>
            and(
              eq(metaTracking.userId, row.userId),
              eq(metaTracking.consentId, row.consentId),
              eq(metaTracking.decidedAt, row.decidedAt),
            ),
          ),
        ),
      ),
    );
