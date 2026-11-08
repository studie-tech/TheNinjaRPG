/**
 * Database access for parental controls; authorization and transaction scopes stay in callers.
 */
import { and, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { PARENTAL_PIN_MAX_ATTEMPTS } from "@/drizzle/constants";
import { parentalControl, userData } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Build the `parentalControl` lookup for `get`, using predicates on `userId`. */
export const findParentalControlForGet = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.parentalControl.findFirst({
    where: eq(parentalControl.userId, ctx.userId),
    columns: {
      enabled: true,
      tavernDisabled: true,
      privateMessages: true,
      approvedUserIds: true,
      version: true,
      pinHash: true,
    },
  });

/** Build the `userData` listing for `get`, using predicates on `userId`. */
export const listUserDataForGet = (
  client: Pick<DrizzleClient, "query">,
  settings: { approvedUserIds: string[] },
) =>
  client.query.userData.findMany({
    where: inArray(userData.userId, settings.approvedUserIds),
    columns: {
      userId: true,
      username: true,
      avatar: true,
      federalStatus: true,
      rank: true,
      level: true,
    },
  });

/** Build the `parentalControl` lookup for `save`, using predicates on `userId`. */
export const findParentalControlForSave = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.parentalControl.findFirst({
    where: eq(parentalControl.userId, ctx.userId),
  });

/** Build the `userData` listing for `save`, selecting only `userId`, using predicates on `userId`. */
export const listUserDataForSave = (
  client: Pick<DrizzleClient, "query">,
  input: { approvedUserIds: string[] },
) =>
  client.query.userData.findMany({
    where: inArray(userData.userId, input.approvedUserIds),
    columns: { userId: true },
  });

/**
 * Build the `parentalControl` update for `save`, setting `failedAttempts` and
 * `attemptWindowStart`, including predicates on `userId`, `version`, `failedAttempts`.
 */
export const updateParentalControlForSave = (
  client: Pick<DrizzleClient, "update">,
  cutoff: Date,
  ctx: { userId: string },
  input: { version: number },
) => {
  const windowExpired = lte(parentalControl.attemptWindowStart, cutoff);
  return client
    .update(parentalControl)
    .set({
      failedAttempts: sql`CASE WHEN ${windowExpired} THEN 1 ELSE ${parentalControl.failedAttempts} + 1 END`,
      attemptWindowStart: sql`CASE WHEN ${windowExpired} THEN ${new Date()} ELSE ${parentalControl.attemptWindowStart} END`,
    })
    .where(
      and(
        eq(parentalControl.userId, ctx.userId),
        eq(parentalControl.version, input.version),
        or(
          lt(parentalControl.failedAttempts, PARENTAL_PIN_MAX_ATTEMPTS),
          windowExpired,
        ),
      ),
    );
};

/** Build the `parentalControl` update for `save`, using predicates on `userId` and `version`. */
export const updateParentalControlForSave2 = (
  client: Pick<DrizzleClient, "update">,
  values: Pick<
    import("@/drizzle/schema").ParentalControl,
    | "version"
    | "enabled"
    | "tavernDisabled"
    | "privateMessages"
    | "approvedUserIds"
    | "pinHash"
    | "failedAttempts"
    | "attemptWindowStart"
  >,
  ctx: { userId: string },
  input: { version: number },
) =>
  client
    .update(parentalControl)
    .set(values)
    .where(
      and(
        eq(parentalControl.userId, ctx.userId),
        eq(parentalControl.version, input.version),
      ),
    );

/** Build the `parentalControl` insert for `save`. */
export const insertParentalControlForSave = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  values: Pick<
    import("@/drizzle/schema").ParentalControl,
    | "version"
    | "enabled"
    | "tavernDisabled"
    | "privateMessages"
    | "approvedUserIds"
    | "pinHash"
    | "failedAttempts"
    | "attemptWindowStart"
  >,
) =>
  client
    .insert(parentalControl)
    .ignore()
    .values({ userId: ctx.userId, ...values });

/** Loads only communication rules, keeping credentials out of conversation responses. */
export const fetchCommunicationPolicies = (client: DrizzleClient, ids: string[]) =>
  client.query.parentalControl.findMany({
    where: inArray(parentalControl.userId, [...new Set(ids)]),
    columns: {
      userId: true,
      enabled: true,
      tavernDisabled: true,
      privateMessages: true,
      approvedUserIds: true,
    },
  });

/**
 * Replaces complete JSON string tokens so administrative identity moves retain approvals.
 * Advancing the version prevents an open settings form from restoring the old identity.
 */
export const renameParentalContact = (
  client: DrizzleClient,
  oldId: string,
  newId: string,
) =>
  client
    .update(parentalControl)
    .set({
      approvedUserIds: sql`CAST(REPLACE(CAST(${parentalControl.approvedUserIds} AS CHAR), ${JSON.stringify(oldId)}, ${JSON.stringify(newId)}) AS JSON)`,
      version: sql`${parentalControl.version} + 1`,
    })
    .where(
      sql`JSON_CONTAINS(${parentalControl.approvedUserIds}, ${JSON.stringify(oldId)})`,
    );
