/**
 * Database access for sensei; authorization and transaction scopes stay in callers.
 */
import { and, asc, eq, isNull, lte } from "drizzle-orm";
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
