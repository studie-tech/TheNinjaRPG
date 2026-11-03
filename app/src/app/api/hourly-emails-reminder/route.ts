import sgMail from "@sendgrid/mail";
import * as Sentry from "@sentry/nextjs";
import { env } from "@/env/server.mjs";
import { handleEndpointError, lockWithHourlyTimer } from "@/libs/gamesettings";
import { SITE_URL } from "@/libs/seo";
import {
  listEmailReminderForGET,
  updateEmailReminderForGET,
  updateEmailReminderForGET2,
  updateUserDataForGET,
} from "@/queries/emailReminder";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";

const ENDPOINT_NAME = "hourly-emails-reminder";

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Connect to SendGrid
  sgMail.setApiKey(env.SENDGRID_API_KEY || "");

  // Check timer
  const timerCheck = await lockWithHourlyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewHour && timerCheck.response) return timerCheck.response;

  try {
    // Fetch all the emails currently in the database
    const reminders = await listEmailReminderForGET(drizzleDB);

    // Send email for each reminder
    await Promise.all(
      reminders.map(async (reminder: (typeof reminders)[number]) => {
        const unsubscribeUrl = new URL("/emailsettings", SITE_URL);
        unsubscribeUrl.searchParams.set("email", reminder.email);
        unsubscribeUrl.searchParams.set("secret", reminder.secret);
        const msg = {
          to: reminder.email,
          from: "contact@theninja-rpg.com",
          subject: "We miss you at TheNinja-RPG",
          templateId: "d-95b2000ec19f47b1bedc331cf5cd19dd",
          dynamicTemplateData: {
            first_name: reminder.callName,
            unsubscribeUrl: unsubscribeUrl.toString(),
          },
        };
        // A rejected send marks the address invalid; write failures after a send do not.
        try {
          await sgMail.send(msg);
        } catch (error) {
          console.error("[hourly-emails-reminder] send failed:", error);
          await updateEmailReminderForGET2(drizzleDB, reminder);
          return;
        }
        try {
          const claimed = await updateEmailReminderForGET(drizzleDB, reminder);
          if (claimed.rowsAffected > 0 && reminder.userId) {
            await updateUserDataForGET(drizzleDB, { userId: reminder.userId });
          }
        } catch (error) {
          Sentry.captureException(error, { tags: { source: ENDPOINT_NAME } });
        }
      }),
    );

    return Response.json(`OK. Send emails to ${reminders.length} users`);
  } catch (cause) {
    await timerCheck.release();
    return await handleEndpointError(cause);
  }
}
