import { clerkClient } from "@clerk/nextjs/server";

/** A Clerk 404 means identity deletion is complete and cleanup can safely continue. */
export const isClerkNotFound = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  error.status === 404;

/** Load the Clerk user, or null when Clerk has already deleted it. */
export const fetchClerkUser = async (userId: string) => {
  try {
    return await (await clerkClient()).users.getUser(userId);
  } catch (error) {
    if (isClerkNotFound(error)) return null;
    throw error;
  }
};

/** Clerk names providers both `oauth_google` and `google`; treat them as one. */
export const normalizeClerkProvider = (provider: string) =>
  provider
    .trim()
    .toLowerCase()
    .replace(/^oauth_/, "");
