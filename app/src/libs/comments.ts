import type { UserRole } from "@/drizzle/constants";
import { canPostAsAi } from "@/utils/permissions";

/**
 * Resolve the effective sender for posting content.
 * - If no sender is provided or sender equals current user, use current user
 * - If a different sender is provided, use it only when:
 *   - the current user may post as AI (canPostAsAi)
 *   - and the sender is an AI account
 *
 * @returns the resolved userId to post as; the current user's id when the sender is not allowed
 */
export function resolveSenderId(
  user: { userId: string; role: UserRole },
  sender?: { userId: string; isAi: boolean } | null,
): string {
  // No sender overwrite, or sender is the same as current user
  if (!sender || sender.userId === user.userId) {
    return user.userId;
  }
  // If the current user has permission to post as AI and the sender is an AI, use the sender
  if (canPostAsAi(user.role) && sender.isAi) {
    return sender.userId;
  }
  return user.userId;
}
