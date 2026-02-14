import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { cookies } from "next/headers";
import { emailReminder } from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import {
  handleEndpointError,
  lockWithDailyTimer,
  updateGameSetting,
} from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";
import { MONTH_S, secondsFromNow } from "@/utils/time";

const ENDPOINT_NAME = "daily-emails-sync";
const CLERK_API_ENDPOINT = "https://api.clerk.com/v1";

// Define types for Clerk API response based on documentation
interface ClerkEmailAddress {
  id: string;
  email_address: string;
  verification: {
    status: string;
    strategy: string;
    external_verification_redirect_url: string | null;
    attempts: number | null;
    expire_at: number | null;
  };
  linked_to: Array<{
    id: string;
    type: string;
  }>;
  reserved: boolean;
}

interface ClerkUser {
  id: string;
  external_id: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  profile_image_url: string;
  image_url: string;
  has_image: boolean;
  primary_email_address_id: string;
  primary_phone_number_id: string | null;
  primary_web3_wallet_id: string | null;
  password_enabled: boolean;
  two_factor_enabled: boolean;
  totp_enabled: boolean;
  backup_code_enabled: boolean;
  email_addresses: ClerkEmailAddress[];
  phone_numbers: any[];
  web3_wallets: any[];
  external_accounts: any[];
  public_metadata: Record<string, any>;
  private_metadata: Record<string, any>;
  unsafe_metadata: Record<string, any>;
  last_sign_in_at: number | null;
  banned: boolean;
  locked: boolean;
  lockout_expires_at: number | null;
  verification_attempts_count: number | null;
  created_at: number;
  updated_at: number;
  last_active_at: number;
  delete_self_enabled: boolean;
}

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewDay && timerCheck.response) return timerCheck.response;

  try {
    // Fetch all the emails currently in the database
    const reminders = await drizzleDB.query.emailReminder.findMany({
      columns: { userId: true },
    });
    const userIds = reminders.map(
      (reminder: (typeof reminders)[number]) => reminder.userId,
    );

    // Fetch all users from Clerk API iteratively
    const allClerkUsers: ClerkUser[] = [];
    let hasMoreUsers = true;
    let offset = 0;
    const limit = 500;
    const lastActiveAtAfter = secondsFromNow(-MONTH_S).getTime();
    while (hasMoreUsers) {
      const response = await fetch(
        `${CLERK_API_ENDPOINT}/users?offset=${offset}&order_by=-created_at&limit=${limit}&last_active_at_after=${lastActiveAtAfter}`,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
          },
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch users from Clerk API: ${response.statusText}`);
      }
      const clerkUsersData = (await response.json()) as ClerkUser[];

      // Add users to our collection
      if (Array.isArray(clerkUsersData)) {
        allClerkUsers.push(
          ...clerkUsersData.filter((user) => !userIds.includes(user.id)),
        );
        if (clerkUsersData.length < limit) {
          hasMoreUsers = false;
        } else {
          offset += limit;
        }
      } else {
        hasMoreUsers = false;
      }
    }

    // Insert the clerk users & their emails into the database
    await drizzleDB.insert(emailReminder).values(
      allClerkUsers
        .map((user) => {
          // Data to fill in
          const mail = user.email_addresses.find(
            (e) => e.id === user.primary_email_address_id,
          );
          const callName = user.username || `${user.first_name} ${user.last_name}`;
          const lastActivity = new Date(user.last_active_at);
          if (mail) {
            return {
              userId: user.id,
              callName: callName,
              email: mail.email_address,
              secret: nanoid(21),
              lastActivity: lastActivity,
            };
          } else {
            return null;
          }
        })
        .filter(
          (
            v,
          ): v is {
            userId: string;
            callName: string;
            email: string;
            secret: string;
            lastActivity: Date;
          } => v !== null,
        ),
    );

    // Update emailReminder's lastActivity with userData's updatedAt for matching userIds
    await drizzleDB.execute(sql`
      UPDATE EmailReminder er
      INNER JOIN UserData ud ON er.userId = ud.userId
      SET er.lastActivity = ud.updatedAt
      WHERE er.userId IS NOT NULL
    `);

    console.log(`Total Clerk users fetched: ${allClerkUsers.length}`);

    return Response.json(`OK - Fetched ${allClerkUsers.length} users`);
  } catch (cause) {
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return await handleEndpointError(cause);
  }
}
