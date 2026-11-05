/**
 * Database access for sensei; authorization and transaction scopes stay in callers.
 */
import { and, asc, eq, lte } from "drizzle-orm";
import { SENSEI_MAX_STUDENT_LEVEL } from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";
import { userSummaryColumns } from "@/queries/userColumns";
import type { DrizzleClient } from "@/server/db";

/**
 * Fetches the students associated with a sensei.
 *
 * @param client - The Drizzle client instance.
 * @param userId - The ID of the sensei.
 * @returns - A promise that resolves when the students are fetched.
 */
export const fetchStudents = async (client: DrizzleClient, userId: string) => {
  return await client.query.userData.findMany({
    where: and(
      eq(userData.senseiId, userId),
      lte(userData.level, SENSEI_MAX_STUDENT_LEVEL),
    ),
    columns: userSummaryColumns,
    orderBy: asc(userData.level),
  });
};

import { isNull, ne, or } from "drizzle-orm";
import { userRequest } from "@/drizzle/schema";

/** Build the `userData` update for `acceptRequest`, setting `senseiId`, using predicates on `userId` and `senseiId`. */
export const updateUserDataForAcceptRequest = (
  client: Pick<DrizzleClient, "update">,
  senseiId: string,
  studentId: string,
) =>
  client
    .update(userData)
    .set({ senseiId })
    .where(and(eq(userData.userId, studentId), isNull(userData.senseiId)));

/** Build the `userData` update for `removeStudent`, setting `senseiId`, using predicates on `userId`. */
export const updateUserDataForRemoveStudent = (
  client: Pick<DrizzleClient, "update">,
  student: { userId: string },
) =>
  client
    .update(userData)
    .set({ senseiId: null })
    .where(eq(userData.userId, student.userId));

/**
 * Clears requests affected by village or rank changes while preserving home access.
 *
 * @param client - The DrizzleClient instance used to perform the delete operation.
 * @param userId - The ID of the user whose requests should be deleted.
 * @returns A Promise that resolves to the result of the delete operation.
 */
export const deleteRequests = async (client: DrizzleClient, userId: string) => {
  return await client
    .delete(userRequest)
    .where(
      and(
        or(eq(userRequest.senderId, userId), eq(userRequest.receiverId, userId)),
        ne(userRequest.type, "HOME"),
      ),
    );
};
