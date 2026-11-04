import {
  claimUserAnnouncements,
  fetchViewerRole,
  listNotificationForGetUser,
  listPublicUserRows,
} from "@/queries/profile";
import { serverError } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { offsetPage } from "@/server/utils/pagination";
import { canSeeIps } from "@/utils/permissions";
import type { GetPublicUsersSchema } from "@/validators/user";

/**
 * Read feedback before its guarded counter claim. Competing consumers or new announcements
 * leave the counters untouched for a later read; only the claim owner delivers the messages.
 */
export const consumeUserAnnouncements = async (
  client: DrizzleClient,
  user: { userId: string; unreadNotifications: number; unreadRecruitRewards: number },
) => {
  if (!user.unreadNotifications && !user.unreadRecruitRewards)
    return { announcements: [] };
  const unread = user.unreadNotifications
    ? await listNotificationForGetUser(client, user)
    : [];
  const claimedAt = new Date();
  if ((await claimUserAnnouncements(client, user, claimedAt)).rowsAffected !== 1)
    return;
  return {
    claimedAt,
    announcements: [
      ...(user.unreadRecruitRewards
        ? [
            {
              href: "/profile/recruit",
              name: `Your recruits earned you ${user.unreadRecruitRewards} rank milestone ${user.unreadRecruitRewards === 1 ? "reward" : "rewards"}`,
              color: "toast" as const,
            },
          ]
        : []),
      ...unread.map((entry) => ({
        href: "/news",
        name: entry.content,
        color: "toast" as const,
      })),
    ],
  };
};

/**
 * Load public user rows and the viewer role in parallel, then enforce IP-search
 * permission and redact IP addresses before pagination is returned.
 */
export const fetchPublicUsers = async (info: {
  client: DrizzleClient;
  input: GetPublicUsersSchema;
  userId?: string | null;
  includeEffects?: boolean;
}) => {
  const { client, input, userId, includeEffects } = info;
  const { skip, cursorAfter } = offsetPage(input);
  const [users, viewerRole] = await Promise.all([
    listPublicUserRows(client, input, skip, includeEffects),
    // The online-players sidebar needs only the caller's role to decide IP visibility.
    fetchViewerRole(client, userId),
  ]);

  // IP-based searches require permission even when the result list is empty.
  if (input.ip && !canSeeIps(viewerRole)) {
    throw serverError("FORBIDDEN", "You are not allowed to search IPs");
  }
  // Normalize proxy addresses before hiding all IPs from unauthorized viewers.
  users
    .filter((u) => !u.lastIp)
    .forEach((u) => {
      u.lastIp = "Proxied";
    });
  if (!canSeeIps(viewerRole)) {
    users.forEach((u) => {
      u.lastIp = "hidden";
    });
  }
  // Advance the cursor only when the fetched page fills the requested limit.
  const nextCursor = cursorAfter(users);
  return {
    data: users,
    nextCursor: nextCursor,
  };
};
