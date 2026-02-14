import sgMail from "@sendgrid/mail";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { emailReminder, userData } from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import {
  handleEndpointError,
  lockWithHourlyTimer,
  updateGameSetting,
} from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";
import { MONTH_S, secondsFromNow } from "@/utils/time";

const ENDPOINT_NAME = "hourly-emails-reminder";

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Connect to SendGrid
  sgMail.setApiKey(env.SENDGRID_API_KEY || "");

  // Check timer
  const timerCheck = await lockWithHourlyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewHour && timerCheck.response) return timerCheck.response;

  try {
    // Fetch all the emails currently in the database
    const reminders = await drizzleDB.query.emailReminder.findMany({
      where: and(
        eq(emailReminder.validated, true),
        lte(emailReminder.lastActivity, secondsFromNow(-MONTH_S)),
        or(
          lte(emailReminder.latestRejoinRequest, emailReminder.lastActivity),
          isNull(emailReminder.latestRejoinRequest),
        ),
      ),
      orderBy: [asc(emailReminder.lastActivity)],
      limit: 10,
    });

    // Send email for each reminder
    await Promise.all(
      reminders.map(async (reminder: (typeof reminders)[number]) => {
        const msg = {
          to: reminder.email,
          from: "contact@theninja-rpg.com",
          subject: "We miss you at TheNinja-RPG",
          templateId: "d-95b2000ec19f47b1bedc331cf5cd19dd",
          dynamicTemplateData: {
            first_name: reminder.callName,
            unsubscribeUrl: `https://www.theninja-rpg.com/emailsettings?email=${reminder.email}&secret=${reminder.secret}`,
          },
        };
        sgMail
          .send(msg)
          .then(async (response: any) => {
            console.log("RESPONSE: ", response);
            await Promise.all([
              drizzleDB
                .update(emailReminder)
                .set({ latestRejoinRequest: new Date() })
                .where(eq(emailReminder.id, reminder.id)),
              ...(reminder.userId
                ? [
                    drizzleDB
                      .update(userData)
                      .set({
                        earnedExperience: sql`${userData.earnedExperience} + 10000`,
                      })
                      .where(eq(userData.userId, reminder.userId)),
                  ]
                : []),
            ]);
          })
          .catch((error: any) => {
            console.log("ERROR: ", error);
            drizzleDB
              .update(emailReminder)
              .set({
                latestRejoinRequest: new Date(),
                validated: false,
              })
              .where(eq(emailReminder.id, reminder.id));
          });
      }),
    );

    return Response.json(`OK. Send emails to ${reminders.length} users`);
  } catch (cause) {
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return await handleEndpointError(cause);
  }
}
