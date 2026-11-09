/**
 * Database access for sparring; authorization and transaction scopes stay in callers.
 */
import { and, eq, gt, inArray, ne, or } from "drizzle-orm";
import type { UserRequestState, UserRequestType } from "@/drizzle/constants";
import { userRequest } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { secondsFromNow } from "@/utils/time";

/**
 * Fetches user requests based on the specified criteria.
 * @param client - The DrizzleClient instance used for querying the database.
 * @param types - An array of user request types to fetch.
 * @param [secondsBack] - Optional. The number of seconds in the past to consider when fetching requests.
 * @param [id] - Optional. User ID(s) that must be the sender or receiver.
 * @param [relatedId] - Optional. The related entity ID the requests must carry.
 * @returns - A Promise that resolves to an array of user requests matching the specified criteria.
 */
export const fetchRequests = async (
  client: DrizzleClient,
  types: UserRequestType[],
  secondsBack?: number,
  id?: string | string[],
  relatedId?: string,
) => {
  return await client.query.userRequest.findMany({
    where: and(
      ...(id
        ? [
            or(
              inArray(userRequest.senderId, Array.isArray(id) ? id : [id]),
              inArray(userRequest.receiverId, Array.isArray(id) ? id : [id]),
            ),
          ]
        : []),
      ...(relatedId ? [eq(userRequest.relatedId, relatedId)] : []),
      ...(secondsBack ? [gt(userRequest.createdAt, secondsFromNow(-secondsBack))] : []),
      inArray(userRequest.type, types),
    ),
    with: {
      sender: {
        columns: { username: true, level: true, rank: true },
        with: { village: { columns: { name: true } } },
      },
      receiver: {
        columns: { username: true, level: true, rank: true },
        with: { village: { columns: { name: true } } },
      },
    },
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  });
};

import { nanoid } from "nanoid";

/** Build the `userRequest` lookup for `fetchRequest`, using predicates on `id` and `type`. */
export const findUserRequestForFetchRequest = (
  client: Pick<DrizzleClient, "query">,
  id: string,
  type: UserRequestType,
) =>
  client.query.userRequest.findFirst({
    where: and(eq(userRequest.id, id), eq(userRequest.type, type)),
  });

/** Build the `userRequest` update for `updateRequestState`, setting `status`, using predicates on `id`, `type`, `status`. */
export const updateUserRequestForUpdateRequestState = (
  client: Pick<DrizzleClient, "update">,
  status: UserRequestState,
  relatedId: undefined | string,
  challengeId: string,
  type: UserRequestType,
  expectedStatus: UserRequestState | undefined,
) =>
  client
    .update(userRequest)
    .set({
      status,
      ...(relatedId && { relatedId }),
    })
    .where(
      and(
        eq(userRequest.id, challengeId),
        eq(userRequest.type, type),
        ...(expectedStatus ? [eq(userRequest.status, expectedStatus)] : []),
      ),
    );

/**
 * Inserts a new request into the database.
 *
 * @param client - The DrizzleClient instance used to interact with the database.
 * @param senderId - The ID of the sender.
 * @param receiverId - The ID of the receiver.
 * @param type - The type of the user request.
 * @param [value] - Optional. The request's numeric value.
 * @param [relatedId] - Optional. The related entity ID.
 * @param [useRankedRules] - Optional. Whether the challenge uses ranked rules.
 * @param [spectatable] - Optional. Whether the challenge can be spectated.
 * @returns A Promise that resolves when the request is successfully inserted.
 */
export const insertRequest = async (
  client: DrizzleClient,
  senderId: string,
  receiverId: string,
  type: UserRequestType,
  value?: number,
  relatedId?: string,
  useRankedRules?: boolean,
  spectatable?: boolean,
) => {
  await client.insert(userRequest).values({
    id: nanoid(),
    senderId,
    receiverId,
    status: "PENDING",
    type,
    value: value || null,
    relatedId: relatedId || null,
    useRankedRules: useRankedRules || false,
    spectatable: spectatable || false,
  });
};

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
