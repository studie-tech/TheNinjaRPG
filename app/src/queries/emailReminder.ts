/**
 * Database access for email reminder; authorization and transaction scopes stay in callers.
 */

import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { EMAIL_REMINDER_EXPERIENCE_REWARD } from "@/drizzle/constants";
import { emailReminder, userData } from "@/drizzle/schema";
import { petExperienceGainSql } from "@/libs/pets/experience";
import type { DrizzleClient } from "@/server/db";
import { MONTH_S, secondsFromNow } from "@/utils/time";

/** Build the existing reminder-user ID listing for daily Clerk email synchronization; retain its userId-only projection. */
export const listEmailReminderForDailySync = (client: Pick<DrizzleClient, "query">) =>
  client.query.emailReminder.findMany({
    columns: { userId: true },
  });

/** Build the `emailReminder` insert for `GET`. */
export const insertEmailReminderForGET = (
  client: Pick<DrizzleClient, "insert">,
  newReminders: {
    userId: string;
    callName: string;
    email: string;
    secret: string;
    lastActivity: Date;
  }[],
) => client.insert(emailReminder).values(newReminders);

/** Execute the database statement for `GET`. */
export const executeRowsForGET = (client: Pick<DrizzleClient, "execute">) =>
  client.execute(sql`
        UPDATE EmailReminder er
        INNER JOIN UserData ud ON er.userId = ud.userId
        SET er.lastActivity = ud.updatedAt
        WHERE er.userId IS NOT NULL
          AND NOT (er.lastActivity <=> ud.updatedAt)
      `);

/** Build the `emailReminder` listing for `GET`, including predicates on `validated`, `disabled`, `lastActivity`. */
export const listEmailReminderForGET = (client: Pick<DrizzleClient, "query">) =>
  client.query.emailReminder.findMany({
    where: and(
      eq(emailReminder.validated, true),
      eq(emailReminder.disabled, false),
      lte(emailReminder.lastActivity, secondsFromNow(-MONTH_S)),
      or(
        lte(emailReminder.latestRejoinRequest, emailReminder.lastActivity),
        isNull(emailReminder.latestRejoinRequest),
      ),
    ),
    orderBy: [asc(emailReminder.lastActivity)],
    limit: 10,
  });

/**
 * Build the `emailReminder` update for `GET`, setting `latestRejoinRequest`, guarded on
 * `id` and the `latestRejoinRequest` value the reminder was listed with.
 */
export const updateEmailReminderForGET = (
  client: Pick<DrizzleClient, "update">,
  reminder: { id: number; latestRejoinRequest: Date | null },
) =>
  client
    .update(emailReminder)
    .set({ latestRejoinRequest: new Date() })
    .where(
      and(
        eq(emailReminder.id, reminder.id),
        reminder.latestRejoinRequest
          ? eq(emailReminder.latestRejoinRequest, reminder.latestRejoinRequest)
          : isNull(emailReminder.latestRejoinRequest),
      ),
    );

/** Build the `userData` update for `GET`, setting `earnedExperience` and `petExperience`, using predicates on `userId`. */
export const updateUserDataForGET = (
  client: Pick<DrizzleClient, "update">,
  reminder: { userId: string },
) =>
  client
    .update(userData)
    .set({
      earnedExperience: sql`${userData.earnedExperience} + ${EMAIL_REMINDER_EXPERIENCE_REWARD}`,
      petExperience: petExperienceGainSql(EMAIL_REMINDER_EXPERIENCE_REWARD),
    })
    .where(eq(userData.userId, reminder.userId));

/** Build the `emailReminder` update for `GET`, setting `latestRejoinRequest` and `validated`, using predicates on `id`. */
export const updateEmailReminderForGET2 = (
  client: Pick<DrizzleClient, "update">,
  reminder: { id: number },
) =>
  client
    .update(emailReminder)
    .set({
      latestRejoinRequest: new Date(),
      validated: false,
    })
    .where(eq(emailReminder.id, reminder.id));

/**
 * Fetches an email reminder by email and secret
 * @param client - The DrizzleClient instance
 * @param email - The email address
 * @param secret - The secret token
 * @returns The email reminder or undefined if not found
 */
export const fetchEmailReminder = async (
  client: DrizzleClient,
  email: string,
  secret: string,
) => {
  return await client.query.emailReminder.findFirst({
    where: and(eq(emailReminder.email, email), eq(emailReminder.secret, secret)),
  });
};

/** Build the `emailReminder` lookup, using predicates on `userId`. */
export const findUserEmailReminder = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.emailReminder.findFirst({
    where: eq(emailReminder.userId, ctx.userId),
  });

/**
 * Build the `emailReminder` update for `toggleEmailReminder`, setting `disabled`,
 * using predicates on `email` and `secret`.
 */
export const updateEmailReminderForToggleEmailReminder = (
  client: Pick<DrizzleClient, "update">,
  input: { disabled: false | true; email: string; secret: string },
) =>
  client
    .update(emailReminder)
    .set({ disabled: input.disabled })
    .where(
      and(eq(emailReminder.email, input.email), eq(emailReminder.secret, input.secret)),
    );

/** Build the `emailReminder` deletion for `deleteEmailReminder`, using predicates on `email` and `secret`. */
export const deleteEmailReminderForDeleteEmailReminder = (
  client: Pick<DrizzleClient, "delete">,
  input: { email: string; secret: string },
) =>
  client
    .delete(emailReminder)
    .where(
      and(eq(emailReminder.email, input.email), eq(emailReminder.secret, input.secret)),
    );
