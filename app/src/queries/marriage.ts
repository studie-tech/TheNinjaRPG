/**
 * Database access for marriage; authorization and transaction scopes stay in callers.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import type { UserAssociation } from "@/drizzle/constants";
import { userAssociation } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/**
 * Load a user's associations of the given types with both participant records present,
 * ordered by creation.
 */
export const fetchAssociations = async (
  client: DrizzleClient,
  userId: string,
  types: UserAssociation[],
) => {
  const results = await client.query.userAssociation.findMany({
    where: and(
      or(eq(userAssociation.userOne, userId), eq(userAssociation.userTwo, userId)),
      inArray(userAssociation.associationType, types),
    ),
    with: {
      userOne: { columns: { username: true, userId: true, avatar: true } },
      userTwo: { columns: { username: true, userId: true, avatar: true } },
    },
    orderBy: (table, { asc }) => [asc(table.createdAt)],
  });
  return results.filter((x) => x.userOne && x.userTwo);
};

import { nanoid } from "nanoid";

/**
 * Inserts a new association into the database
 * @param client - The database client
 * @param userOne - The first user in the association
 * @param userTwo - The second user in the association
 * @param associationType - The type of association
 */
export const insertAssociation = async (
  client: DrizzleClient,
  userOne: string,
  userTwo: string,
  associationType: UserAssociation,
) => {
  await client.insert(userAssociation).values({
    id: nanoid(),
    userOne,
    userTwo,
    associationType,
  });
};

/**
 * Updates an existing association in the database
 * @param client - The database client
 * @param associationId - The ID of the association to update
 * @param currentAssociationType - The current type of association
 * @param associationType - The new type of association
 */
export const updateAssociation = async (
  client: DrizzleClient,
  associationId: string,
  currentAssociationType: UserAssociation,
  associationType: UserAssociation,
) => {
  await client
    .update(userAssociation)
    .set({ associationType: associationType })
    .where(
      and(
        eq(userAssociation.id, associationId),
        eq(userAssociation.associationType, currentAssociationType),
      ),
    );
};

/**
 * Deletes an association from the database
 * @param client - The database client
 * @param associationId - The ID of the association to delete
 */
export const deleteAssociation = async (
  client: DrizzleClient,
  associationId: string,
) => {
  await client.delete(userAssociation).where(eq(userAssociation.id, associationId));
};
