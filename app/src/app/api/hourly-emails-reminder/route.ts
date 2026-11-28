import sgMail from "@sendgrid/mail";
import * as Sentry from "@sentry/nextjs";
import { env } from "@/env/server.mjs";
import { lockWithHourlyTimer, runClaimedCron } from "@/libs/gamesettings";
import { SITE_URL } from "@/libs/seo";
import { buildTutorialReminderEmail } from "@/libs/tutorialReminder";
import { TUTORIAL_CHAPTERS, TUTORIAL_STEPS } from "@/libs/tutorialSteps";
import {
  listEmailReminderForGET,
  listTutorialLapsedReminders,
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

  return runClaimedCron(timerCheck, "/api/hourly-emails-reminder", async () => {
    // Fetch the month-inactive reminders and the players who stopped mid-tutorial
    const [reminders, lapsedReminders] = await Promise.all([
      listEmailReminderForGET(drizzleDB),
      listTutorialLapsedReminders(drizzleDB),
    ]);
    // A reminder in both lists gets only the monthly email this run
    const monthlyIds = new Set(reminders.map((reminder) => reminder.id));
    const tutorialReminders = lapsedReminders.filter(
      (reminder) => !monthlyIds.has(reminder.id),
    );

    // Send email for each reminder
    await Promise.all(
      reminders.map((reminder) =>
        sendReminder(
          reminder,
          {
            to: reminder.email,
            from: "contact@theninja-rpg.com",
            subject: "We miss you at TheNinja-RPG",
            templateId: "d-95b2000ec19f47b1bedc331cf5cd19dd",
            dynamicTemplateData: {
              first_name: reminder.callName,
              unsubscribeUrl: getUnsubscribeUrl(reminder),
            },
          },
          async (userId) => {
            await updateUserDataForGET(drizzleDB, { userId });
          },
        ),
      ),
    );

    // One story email from Lemu per player who stopped partway through the Academy Trials
    await Promise.all(
      tutorialReminders.map(async (reminder) => {
        const step = TUTORIAL_STEPS[reminder.tutorialStep];
        const chapter = TUTORIAL_CHAPTERS.find((entry) => entry.id === step?.chapter);
        const email = buildTutorialReminderEmail({
          callName: reminder.callName,
          chapterTitle: chapter?.title,
          stepPage: step?.page,
          siteUrl: SITE_URL,
          unsubscribeUrl: getUnsubscribeUrl(reminder),
        });
        await sendReminder(reminder, {
          to: reminder.email,
          from: "contact@theninja-rpg.com",
          subject: email.subject,
          text: email.text,
          html: email.html,
        });
      }),
    );

    return Response.json(
      `OK. Send emails to ${reminders.length} users and ${tutorialReminders.length} tutorial reminders`,
    );
  });
}

/** Link to the reminder settings page that turns these emails off. */
const getUnsubscribeUrl = (reminder: { email: string; secret: string }) => {
  const url = new URL("/emailsettings", SITE_URL);
  url.searchParams.set("email", reminder.email);
  url.searchParams.set("secret", reminder.secret);
  return url.toString();
};

/**
 * Send one reminder and record it. A rejected send marks the address invalid; write
 * failures after a send do not. `onClaimed` runs once this send claimed the reminder.
 */
const sendReminder = async (
  reminder: { id: number; userId: string | null; latestRejoinRequest: Date | null },
  msg: Parameters<typeof sgMail.send>[0],
  onClaimed?: (userId: string) => Promise<void>,
) => {
  try {
    await sgMail.send(msg);
  } catch (error) {
    console.error("[hourly-emails-reminder] send failed:", error);
    await updateEmailReminderForGET2(drizzleDB, reminder);
    return;
  }
  try {
    const claimed = await updateEmailReminderForGET(drizzleDB, reminder);
    if (onClaimed && claimed.rowsAffected > 0 && reminder.userId) {
      await onClaimed(reminder.userId);
    }
  } catch (error) {
    Sentry.captureException(error, { tags: { source: ENDPOINT_NAME } });
  }
};
