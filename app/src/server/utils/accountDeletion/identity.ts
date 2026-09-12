import { clerkClient } from "@clerk/nextjs/server";
import { eq, inArray, or } from "drizzle-orm";
import { emailReminder } from "@/drizzle/schema";
import { drizzleDB } from "@/server/db";
import { appleClientCredentials, isAppleProvider, revokeAppleToken } from "./apple";

export const removeAccountIdentity = async (
  userId: string,
  appleRevokedSubject: string | null = null,
) => {
  const clerk = await clerkClient();
  let user: Awaited<ReturnType<typeof clerk.users.getUser>>;
  try {
    user = await clerk.users.getUser(userId);
  } catch (error) {
    // Clerk may have deleted the identity before a response or queue update was lost.
    if (isClerkNotFound(error)) return;
    throw error;
  }
  if (
    user.externalAccounts.some(
      (account) =>
        isAppleProvider(account.provider) &&
        account.providerUserId !== appleRevokedSubject,
    )
  ) {
    const credentials = await appleClientCredentials();
    const tokens = await clerk.users.getUserOauthAccessToken(userId, "apple");
    if (!tokens.data.length)
      throw new Error(
        "Apple authorization changed after confirmation; deletion needs operator attention",
      );
    for (const token of tokens.data)
      await revokeAppleToken(token.token, "access_token", credentials);
  }
  const emails = user.emailAddresses
    .filter((email) => email.verification?.status === "verified")
    .map((email) => email.emailAddress);
  // Legacy reminder rows can have an email but no userId. Remove them while the
  // verified email addresses are still available, before destroying the identity.
  await drizzleDB
    .delete(emailReminder)
    .where(
      or(
        eq(emailReminder.userId, userId),
        ...(emails.length ? [inArray(emailReminder.email, emails)] : []),
      ),
    );
  try {
    await clerk.users.deleteUser(userId);
  } catch (error) {
    if (!isClerkNotFound(error)) throw error;
  }
};

const isClerkNotFound = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  error.status === 404;
