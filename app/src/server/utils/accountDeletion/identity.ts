import { clerkClient } from "@clerk/nextjs/server";
import { deleteEmailReminderForRemoveAccountIdentity } from "@/queries/accountDeletion";
import { drizzleDB } from "@/server/db";
import { fetchClerkUser, isClerkNotFound } from "@/server/utils/clerk";
import { recordSanctionTombstone } from "@/server/utils/sanctionTombstone";
import {
  appleClientCredentials,
  isAppleProvider,
  revokeClerkAppleTokens,
} from "./apple";

export const removeAccountIdentity = async (
  userId: string,
  appleRevokedSubject: string | null = null,
) => {
  const clerk = await clerkClient();
  // Clerk may have deleted the identity before a response or queue update was lost.
  const user = await fetchClerkUser(userId);
  if (!user) return;
  // The emails and OAuth accounts are only readable while the Clerk user exists, and a
  // returning player gets a new Clerk id, so a running sanction is recorded first.
  await recordSanctionTombstone(drizzleDB, userId, user);
  if (
    user.externalAccounts.some(
      (account) =>
        isAppleProvider(account.provider) &&
        account.providerUserId !== appleRevokedSubject,
    )
  ) {
    const credentials = await appleClientCredentials("web");
    if (!(await revokeClerkAppleTokens(clerk, userId, credentials)))
      throw new Error(
        "Apple authorization changed after confirmation; deletion needs operator attention",
      );
  }
  const emails = user.emailAddresses
    .filter((email) => email.verification?.status === "verified")
    .map((email) => email.emailAddress);
  // Legacy reminder rows can have an email but no userId. Remove them while the
  // verified email addresses are still available, before destroying the identity.
  await deleteEmailReminderForRemoveAccountIdentity(drizzleDB, userId, emails);
  try {
    await clerk.users.deleteUser(userId);
  } catch (error) {
    if (!isClerkNotFound(error)) throw error;
  }
};
