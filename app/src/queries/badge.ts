/**
 * Database access for badge; authorization and transaction scopes stay in callers.
 */
import { asc, countDistinct, desc, eq, min } from "drizzle-orm";
import { nanoid } from "nanoid";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { actionLog, badge, userBadge, userData } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import type { ZodBadgeType } from "@/validators/badge";

/** Load a badge definition by ID; no match yields undefined. */
export const fetchBadge = async (client: DrizzleClient, id: string) => {
  return await client.query.badge.findFirst({
    where: eq(badge.id, id),
  });
};

/**
 * List public holder fields once per user, using the earliest duplicate award.
 * The profile join excludes orphan assignments; user IDs stabilize timestamp ties.
 */
export const listBadgeAchievers = (
  client: Pick<DrizzleClient, "select">,
  input: { badgeId: string; page: number; limit: number; order: "newest" | "oldest" },
) => {
  const achievedAt = min(userBadge.createdAt);
  const orderByTime = input.order === "newest" ? desc : asc;
  return client
    .select({
      userId: userData.userId,
      username: userData.username,
      avatar: userData.avatar,
      level: userData.level,
      achievedAt,
    })
    .from(userBadge)
    .innerJoin(userData, eq(userData.userId, userBadge.userId))
    .where(eq(userBadge.badgeId, input.badgeId))
    .groupBy(userData.userId, userData.username, userData.avatar, userData.level)
    .orderBy(orderByTime(achievedAt), asc(userData.userId))
    .offset(input.page * input.limit)
    .limit(input.limit);
};

/** Count the same distinct, existing profiles as the paginated holder query. */
export const countBadgeAchievers = (
  client: Pick<DrizzleClient, "select">,
  badgeId: string,
) =>
  client
    .select({ total: countDistinct(userBadge.userId) })
    .from(userBadge)
    .innerJoin(userData, eq(userData.userId, userBadge.userId))
    .where(eq(userBadge.badgeId, badgeId));

/** Build the `badge` listing for `getAllNames`. */
export const listBadgeForGetAllNames = (client: Pick<DrizzleClient, "query">) =>
  client.query.badge.findMany({
    columns: { id: true, name: true, image: true },
    orderBy: (table, { asc }) => [asc(table.name)],
  });

/** Build the `badge` listing for `getAll`. */
export const listBadgeForGetAll = (
  client: Pick<DrizzleClient, "query">,
  skip: number,
  limit: number,
) =>
  client.query.badge.findMany({
    offset: skip,
    limit: limit,
    orderBy: [asc(badge.name), asc(badge.id)],
  });

/** Build the `badge` lookup for `update`, selecting only `name` and `id`, using predicates on `name`. */
export const findBadgeForUpdate = (
  client: Pick<DrizzleClient, "query">,
  input: { data: { name: string } },
) =>
  client.query.badge.findFirst({
    columns: { name: true, id: true },
    where: eq(badge.name, input.data.name),
  });

/** Build the `badge` update for `update`, using predicates on `id`. */
export const updateBadgeForUpdate = (
  client: Pick<DrizzleClient, "update">,
  input: { data: ZodBadgeType },
  entry: { id: string },
) => client.update(badge).set(input.data).where(eq(badge.id, entry.id));

/** Build the `actionLog` insert for `update`. */
export const insertActionLogForUpdate = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  diff: string[],
  entry: { id: string; name: string; image: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "badge",
    changes: diff,
    relatedId: entry.id,
    relatedMsg: `Update: ${entry.name}`,
    relatedImage: entry.image,
  });

/** Build the `badge` insert for `create`. */
export const insertBadgeForCreate = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
) =>
  client.insert(badge).values({
    id: id,
    name: `New Badge - ${id}`,
    image: IMG_AVATAR_DEFAULT,
    description: "",
  });

/** Build the `badge` deletion for `delete`, using predicates on `id`. */
export const deleteBadgeForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(badge).where(eq(badge.id, input.id));

/** Build the `userBadge` deletion for `delete`, using predicates on `badgeId`. */
export const deleteUserBadgeForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(userBadge).where(eq(userBadge.badgeId, input.id));

/** Build the `actionLog` insert for `delete`. */
export const insertActionLogForDelete = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  entry: { name: string; id: string; image: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "badge",
    changes: [`Deleted: ${entry.name}`],
    relatedId: entry.id,
    relatedMsg: `Delete: ${entry.name}`,
    relatedImage: entry.image,
  });
