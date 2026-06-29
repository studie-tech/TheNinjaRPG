import { TRPCError } from "@trpc/server";
import { VIEWER_SESSION_MISMATCH_MESSAGE } from "@/app/_trpc/authHeaders";

/**
 * Defense-in-depth guard for Clerk multi-session.
 *
 * The browser-global `__session` cookie can momentarily reflect a different
 * tab's account, so a request may authenticate as an account the client did not
 * intend to act as. Procedures that accept a client-asserted `viewerId` call
 * this to reject any request where the server-authenticated session
 * (`sessionUserId`) does not match the account the client believes it is.
 *
 * Identity for the actual work is ALWAYS derived from the session, never from
 * `viewerId` — this only rejects mismatches, it never trusts the client id.
 */
export function assertViewerMatchesSession(
  sessionUserId: string,
  viewerId?: string,
): void {
  if (viewerId !== undefined && viewerId !== sessionUserId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: VIEWER_SESSION_MISMATCH_MESSAGE,
    });
  }
}
