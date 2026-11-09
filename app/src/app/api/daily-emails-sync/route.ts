import { clerkClient, type User } from "@clerk/nextjs/server";
import { nanoid } from "nanoid";
import { lockWithDailyTimer, runClaimedCron } from "@/libs/gamesettings";
import {
  executeRowsForGET,
  insertEmailReminderForGET,
  listEmailReminderForDailySync as listEmailReminderForGET,
} from "@/queries/emailReminder";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { MONTH_S, secondsFromNow } from "@/utils/time";

const ENDPOINT_NAME = "daily-emails-sync";
export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);

  return runClaimedCron(timerCheck, "/api/daily-emails-sync", async () => {
    // Fetch all the emails currently in the database
    const reminders = await listEmailReminderForGET(drizzleDB);
    const userIds = reminders.map(
      (reminder: (typeof reminders)[number]) => reminder.userId,
    );

    // Fetch recently active Clerk users page by page
    const clerk = await clerkClient();
    const allClerkUsers: User[] = [];
    let hasMoreUsers = true;
    let offset = 0;
    const limit = 500;
    const lastActiveAtAfter = secondsFromNow(-MONTH_S).getTime();
    while (hasMoreUsers) {
      const { data } = await clerk.users.getUserList({
        offset,
        orderBy: "-created_at",
        limit,
        lastActiveAtAfter,
      });
      allClerkUsers.push(...data.filter((user) => !userIds.includes(user.id)));
      if (data.length < limit) {
        hasMoreUsers = false;
      } else {
        offset += limit;
      }
    }

    // Insert the clerk users & their emails into the database
    const newReminders = allClerkUsers.flatMap((user) => {
      const mail = user.primaryEmailAddress;
      if (!mail) return [];
      return [
        {
          userId: user.id,
          callName: user.username || `${user.firstName} ${user.lastName}`,
          email: mail.emailAddress,
          secret: nanoid(21),
          lastActivity: new Date(user.lastActiveAt ?? 0),
        },
      ];
    });

    // Every Clerk user may already be known, or none may have a primary email, in
    // which case there is nothing to insert - drizzle rejects an empty values() list.
    if (newReminders.length > 0) {
      await insertEmailReminderForGET(drizzleDB, newReminders);
    }

    // Update emailReminder's lastActivity with userData's updatedAt for matching userIds.
    // Only rows whose value changed are written. Idempotent, so a deadlock with the other
    // midnight crons writing UserData just reruns it.
    await retryOnDeadlock(() => executeRowsForGET(drizzleDB));

    console.log(`Total Clerk users fetched: ${allClerkUsers.length}`);

    return Response.json(`OK - Fetched ${allClerkUsers.length} users`);
  });
}
