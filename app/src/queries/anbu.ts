/**
 * Database access for anbu; authorization and transaction scopes stay in callers.
 */

import type { SQL } from "drizzle-orm";
import { and, count, eq, exists, gt, gte, isNull, lt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  ANBU_ESPIONAGE_POINTS_COST,
  ANBU_ESPIONAGE_PRESTIGE_COST,
  ANBU_MAX_MEMBERS,
  ANBU_REQUEST_EXPIRY_SECS,
  IMG_AVATAR_DEFAULT,
  KAGE_ANBU_DELETE_COST,
  type UserRequestState,
} from "@/drizzle/constants";
import { anbuSquad, clan, userData, userRequest } from "@/drizzle/schema";
import { userSummaryWithLightColumns } from "@/queries/userColumns";
import type { DrizzleClient } from "@/server/db";
import { secondsFromNow } from "@/utils/time";

/**
 * Resolves the user who should be notified when an applicant cancels a join
 * request. Requests use their squad's current leader; leaderless squads fall
 * back to the receiver stored on the request.
 *
 * @param client - The Drizzle client used for the minimal leader lookup.
 * @param request - The request's durable squad link and stored receiver.
 * @returns The user ID that should receive the ANBU update event.
 */
export const fetchAnbuRequestNotificationTarget = async (
  client: DrizzleClient,
  request: { relatedId: string | null; receiverId: string },
) => {
  if (!request.relatedId) return request.receiverId;
  const squad = await client.query.anbuSquad.findFirst({
    columns: { leaderId: true },
    where: eq(anbuSquad.id, request.relatedId),
  });
  return squad?.leaderId ?? request.receiverId;
};

/**
 * Loads only the user and village fields used by ANBU authorization and
 * mutations. This avoids the regeneration, settings, wars, raids, and other
 * unrelated queries performed by the full profile refresh helper.
 *
 * @param client - The Drizzle client used for the focused actor lookup.
 * @param userId - The authenticated user's ID.
 * @returns The focused user and village state, or undefined when not found.
 */
export const fetchAnbuActor = async ({
  client,
  userId,
}: {
  client: DrizzleClient;
  userId: string;
}) => {
  return client.query.userData.findFirst({
    columns: {
      userId: true,
      username: true,
      villageId: true,
      villagePrestige: true,
      anbuId: true,
      rank: true,
      role: true,
      isBanned: true,
      isSilenced: true,
    },
    with: {
      village: {
        columns: { id: true, kageId: true, leaderUpdatedAt: true },
      },
    },
    where: eq(userData.userId, userId),
  });
};

/**
 * Loads only the identity, village, rank, and membership fields used when an
 * ANBU handler validates a leader, member, applicant, or departing user.
 *
 * @param client - The Drizzle client used for the focused member lookup.
 * @param userId - The user whose ANBU eligibility should be checked.
 * @returns The required user fields, or undefined when the user is missing.
 */
export const fetchAnbuMember = async (client: DrizzleClient, userId: string) =>
  client.query.userData.findFirst({
    columns: {
      userId: true,
      villageId: true,
      anbuId: true,
      rank: true,
      isAi: true,
    },
    where: eq(userData.userId, userId),
  });

/**
 * Checks for a recent pending ANBU application using a single-column result
 * instead of loading request participants and their village relations.
 *
 * @param client - The Drizzle client used for the pending-request lookup.
 * @param senderId - The applicant whose pending request should be checked.
 * @returns The matching request ID, or undefined when no recent request exists.
 */
export const fetchRecentPendingAnbuRequest = async (
  client: DrizzleClient,
  senderId: string,
) =>
  client.query.userRequest.findFirst({
    columns: { id: true },
    where: and(
      eq(userRequest.pendingAnbuSenderId, senderId),
      gt(userRequest.createdAt, secondsFromNow(-ANBU_REQUEST_EXPIRY_SECS)),
    ),
  });

/**
 * Fetches a squad's scalar state without hydrating its leader, members, or
 * order relations. Mutation and authorization paths should use this snapshot
 * when they do not return the full squad payload.
 *
 * @param client - The Drizzle client used for the squad lookup.
 * @param squadId - The squad ID to load.
 * @returns The squad's persisted scalar fields, or undefined when not found.
 */
export const fetchSquadSummary = async (client: DrizzleClient, squadId: string) =>
  client.query.anbuSquad.findFirst({
    where: eq(anbuSquad.id, squadId),
  });

/**
 * Loads the minimal squad payload needed to charge and report an espionage
 * mission, including only member IDs for the report recipients.
 *
 * @param client - The Drizzle client used for the espionage squad lookup.
 * @param squadId - The acting squad's ID.
 * @returns Focused squad state and member IDs, or undefined when not found.
 */
export const fetchEspionageSquad = async (client: DrizzleClient, squadId: string) =>
  client.query.anbuSquad.findFirst({
    columns: { id: true, points: true, espionageLevel: true },
    with: { members: { columns: { userId: true } } },
    where: eq(anbuSquad.id, squadId),
  });

/**
 * Counts squads in a village without loading their leaders and members.
 *
 * @param client - The Drizzle client used for the aggregate query.
 * @param villageId - The village whose squads should be counted.
 * @returns The number of ANBU squads assigned to the village.
 */
export const countAnbuSquads = async (client: DrizzleClient, villageId: string) => {
  const rows = await client
    .select({ count: count() })
    .from(anbuSquad)
    .where(eq(anbuSquad.villageId, villageId));
  return rows[0]?.count ?? 0;
};

/**
 * Counts clans in a village without hydrating their leaders, founders,
 * members, or village relation for an espionage report.
 *
 * @param client - The Drizzle client used for the aggregate query.
 * @param villageId - The village whose clans should be counted.
 * @returns The number of clans assigned to the village.
 */
export const countVillageClans = async (client: DrizzleClient, villageId: string) => {
  const rows = await client
    .select({ count: count() })
    .from(clan)
    .where(eq(clan.villageId, villageId));
  return rows[0]?.count ?? 0;
};

/**
 * Fetches squads based on the provided village ID.
 * @param client - The DrizzleClient instance used for querying.
 * @param villageId - The ID of the village to fetch squads for.
 * @returns A promise that resolves to an array of squads.
 */
export const fetchSquads = async (client: DrizzleClient, villageId: string) => {
  return await client.query.anbuSquad.findMany({
    with: {
      leader: {
        columns: userSummaryWithLightColumns,
      },
      members: {
        columns: userSummaryWithLightColumns,
      },
    },
    where: eq(anbuSquad.villageId, villageId),
  });
};

/**
 * Fetches a squad from the database based on the squad ID.
 *
 * @param  client - The Drizzle client used to query the database.
 * @param  squadId - The ID of the squad to fetch.
 * @returns - A promise that resolves to the fetched squad, or undefined if not found.
 */
export const fetchSquad = async (client: DrizzleClient, squadId: string) => {
  return await client.query.anbuSquad.findFirst({
    with: {
      leader: {
        columns: userSummaryWithLightColumns,
      },
      members: {
        columns: { ...userSummaryWithLightColumns, pvpExperience: true },
      },
      kageOrder: true,
      leaderOrder: true,
    },
    where: eq(anbuSquad.id, squadId),
  });
};

/** Build the `anbuSquad` listing for `getAllNames`. */
export const listAnbuSquadForGetAllNames = (client: Pick<DrizzleClient, "query">) =>
  client.query.anbuSquad.findMany({
    columns: { id: true, name: true, image: true },
  });

/** Build an ANBU assignment guarded by the user having no current squad. */
export const assignUserToAnbu = (
  client: Pick<DrizzleClient, "update">,
  anbuId: string,
  userId: string,
) =>
  client
    .update(userData)
    .set({ anbuId })
    .where(and(eq(userData.userId, userId), isNull(userData.anbuId)));

/** Build the `anbuSquad` insert for `createSquad`. */
export const insertAnbuSquadForCreateSquad = (
  client: Pick<DrizzleClient, "insert">,
  anbuId: string,
  village: { id: string },
  input: { name: string },
  leader: { userId: string },
) =>
  client.insert(anbuSquad).values({
    id: anbuId,
    image: IMG_AVATAR_DEFAULT,
    villageId: village.id,
    name: input.name,
    leaderId: leader.userId,
    memberCount: 1,
    kageOrderId: nanoid(),
    leaderOrderId: nanoid(),
  });

/** Build an ANBU membership reset guarded by the expected squad. */
export const clearUserAnbuMembership = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  anbuId: string,
) =>
  client
    .update(userData)
    .set({ anbuId: null })
    .where(and(eq(userData.userId, userId), eq(userData.anbuId, anbuId)));

/** Build the `anbuSquad` deletion for `disbandSquad`, using predicates on `id`. */
export const deleteAnbuSquadForDisbandSquad = (
  client: Pick<DrizzleClient, "delete">,
  squad: { id: string },
) => client.delete(anbuSquad).where(eq(anbuSquad.id, squad.id));

/** Build the `userData` update for `disbandSquad`, setting `anbuId`, using predicates on `anbuId`. */
export const updateUserDataForDisbandSquad = (
  client: Pick<DrizzleClient, "update">,
  squad: { id: string },
) => client.update(userData).set({ anbuId: null }).where(eq(userData.anbuId, squad.id));

/** Build the `userData` update for `disbandSquad`, setting `villagePrestige`, using predicates on `userId`. */
export const updateUserDataForDisbandSquad2 = (
  client: Pick<DrizzleClient, "update">,
  user: { userId: string },
) =>
  client
    .update(userData)
    .set({
      villagePrestige: sql`${userData.villagePrestige} - ${KAGE_ANBU_DELETE_COST}`,
    })
    .where(eq(userData.userId, user.userId));

/** Build the `anbuSquad` lookup for `editSquad`, selecting only `name` and `id`, using predicates on `name`. */
export const findAnbuSquadForEditSquad = (
  client: Pick<DrizzleClient, "query">,
  input: { name: string },
) =>
  client.query.anbuSquad.findFirst({
    columns: { name: true, id: true },
    where: eq(anbuSquad.name, input.name),
  });

/** Build the `anbuSquad` update for `editSquad`, setting `name` and `image`, using predicates on `id` and `name`. */
export const updateAnbuSquadForEditSquad = (
  client: Pick<DrizzleClient, "update">,
  input: { name: string },
  image: { avatar: string },
  squad: { id: string; name: string },
) =>
  client
    .update(anbuSquad)
    .set({ name: input.name, image: image.avatar })
    .where(and(eq(anbuSquad.id, squad.id), eq(anbuSquad.name, squad.name)));

/**
 * Build the `anbuSquad` update for a level upgrade, setting the level and `points`,
 * guarding the balance and the level cap in the write.
 */
export const updateAnbuSquadForPurchaseUpgrade = (
  client: Pick<DrizzleClient, "update">,
  squad: { id: string },
  upgrade: {
    levelColumn: "espionageLevel" | "stealthLevel";
    cost: number;
    maxLevel: number;
  },
) =>
  client
    .update(anbuSquad)
    .set({
      [upgrade.levelColumn]: sql`${anbuSquad[upgrade.levelColumn]} + 1`,
      points: sql`${anbuSquad.points} - ${upgrade.cost}`,
    })
    .where(
      and(
        eq(anbuSquad.id, squad.id),
        gte(anbuSquad.points, upgrade.cost),
        lt(anbuSquad[upgrade.levelColumn], upgrade.maxLevel),
      ),
    );

/**
 * Execute the `performEspionage` charge: the member's village prestige and the squad's points
 * in one statement, only while the user still belongs to the squad and both can afford it.
 */
export const executeChargeForPerformEspionage = (
  client: Pick<DrizzleClient, "execute">,
  user: { userId: string },
  userSquad: { id: string },
) =>
  client.execute(sql`
      UPDATE ${userData}
      INNER JOIN ${anbuSquad} ON ${anbuSquad.id} = ${userData.anbuId}
      SET ${userData.villagePrestige} = ${userData.villagePrestige} - ${ANBU_ESPIONAGE_PRESTIGE_COST},
          ${anbuSquad.points} = ${anbuSquad.points} - ${ANBU_ESPIONAGE_POINTS_COST}
      WHERE ${userData.userId} = ${user.userId}
        AND ${anbuSquad.id} = ${userSquad.id}
        AND ${userData.villagePrestige} >= ${ANBU_ESPIONAGE_PRESTIGE_COST}
        AND ${anbuSquad.points} >= ${ANBU_ESPIONAGE_POINTS_COST}
    `);

/**
 * Build the `userRequest` update for `createAnbuRequest`, setting `status`, including
 * predicates on `senderId`, `type`, `status`.
 */
export const updateUserRequestForCreateAnbuRequest = (
  client: Pick<DrizzleClient, "update">,
  user: { userId: string },
) =>
  client
    .update(userRequest)
    .set({ status: "CANCELLED" })
    .where(
      and(
        eq(userRequest.senderId, user.userId),
        eq(userRequest.type, "ANBU"),
        eq(userRequest.status, "PENDING"),
        lt(userRequest.createdAt, secondsFromNow(-ANBU_REQUEST_EXPIRY_SECS)),
      ),
    );

/**
 * Build the `anbuSquad` update for `acceptAnbuRequest`, setting `memberCount`, using
 * predicates on `id` and `memberCount`.
 */
export const updateAnbuSquadForAcceptAnbuRequest = (
  client: Pick<DrizzleClient, "update">,
  squad: { id: string },
) =>
  client
    .update(anbuSquad)
    .set({ memberCount: sql`${anbuSquad.memberCount} + 1` })
    .where(
      and(eq(anbuSquad.id, squad.id), lt(anbuSquad.memberCount, ANBU_MAX_MEMBERS)),
    );

/** Build the `anbuSquad` update for `acceptAnbuRequest`, setting `leaderId`, using predicates on `id` and `leaderId`. */
export const updateAnbuSquadForAcceptAnbuRequest2 = (
  client: Pick<DrizzleClient, "update">,
  requester: { userId: string },
  squad: { id: string },
) =>
  client
    .update(anbuSquad)
    .set({ leaderId: requester.userId })
    .where(and(eq(anbuSquad.id, squad.id), isNull(anbuSquad.leaderId)));

/** Build the `anbuSquad` update for `removeFromSquad`, setting `memberCount`, using predicates on `id` and `memberCount`. */
export const updateAnbuSquadForRemoveFromSquad = (
  client: Pick<DrizzleClient, "update">,
  squad: { id: string },
) =>
  client
    .update(anbuSquad)
    .set({ memberCount: sql`${anbuSquad.memberCount} - 1` })
    .where(and(eq(anbuSquad.id, squad.id), gt(anbuSquad.memberCount, 1)));

/** Build an atomic increment of an ANBU squad’s member count. */
export const incrementAnbuMemberCount = (
  client: Pick<DrizzleClient, "update">,
  anbuId: string,
) =>
  client
    .update(anbuSquad)
    .set({ memberCount: sql`${anbuSquad.memberCount} + 1` })
    .where(eq(anbuSquad.id, anbuId));

/** Build the `anbuSquad` update for `removeFromSquad`, setting `leaderId`, using predicates on `id` and `leaderId`. */
export const updateAnbuSquadForRemoveFromSquad3 = (
  client: Pick<DrizzleClient, "update">,
  squad: { id: string },
  userId: string,
) =>
  client
    .update(anbuSquad)
    .set({ leaderId: null })
    .where(and(eq(anbuSquad.id, squad.id), eq(anbuSquad.leaderId, userId)));

/** Build the `userData` selection for `promoteAnbuLeader`, using predicates on `userId` and `anbuId`. */
export const selectUserDataForPromoteAnbuLeader = (
  client: Pick<DrizzleClient, "select">,
  memberId: string,
  squadId: string,
) =>
  client
    .select({ userId: userData.userId })
    .from(userData)
    .where(and(eq(userData.userId, memberId), eq(userData.anbuId, squadId)));

/** Build the `anbuSquad` update for `promoteAnbuLeader`, setting `leaderId`, using predicates on `id`. */
export const updateAnbuSquadForPromoteAnbuLeader = (
  client: Pick<DrizzleClient, "update">,
  memberId: string,
  squadId: string,
  expectedLeader: SQL<unknown>,
  liveMembership: ReturnType<typeof selectUserDataForPromoteAnbuLeader>,
) =>
  client
    .update(anbuSquad)
    .set({ leaderId: memberId })
    .where(and(eq(anbuSquad.id, squadId), expectedLeader, exists(liveMembership)));

/** Build the `userData` listing for `electAnbuLeader`, selecting only `userId` and `rank`, using predicates on `anbuId`. */
export const listUserDataForElectAnbuLeader = (
  client: Pick<DrizzleClient, "query">,
  squadId: string,
) =>
  client.query.userData.findMany({
    columns: { userId: true, rank: true },
    where: eq(userData.anbuId, squadId),
  });

/**
 * Build the `userRequest` update for `transitionAnbuRequestState`, setting `status`,
 * using predicates on `id`, `type`, `status`.
 */
export const updateUserRequestForTransitionAnbuRequestState = (
  client: Pick<DrizzleClient, "update">,
  to: UserRequestState,
  requestId: string,
  from: UserRequestState,
) =>
  client
    .update(userRequest)
    .set({ status: to })
    .where(
      and(
        eq(userRequest.id, requestId),
        eq(userRequest.type, "ANBU"),
        eq(userRequest.status, from),
      ),
    );

/**
 * Compensates a previously reserved squad slot without allowing the persisted
 * member count to become negative.
 *
 * @param client - The Drizzle client used for the counter update.
 * @param squadId - The squad whose reserved slot should be released.
 * @returns The result of the member-count update.
 */
export const releaseAnbuCapacity = async (client: DrizzleClient, squadId: string) =>
  client
    .update(anbuSquad)
    .set({ memberCount: sql`GREATEST(${anbuSquad.memberCount} - 1, 0)` })
    .where(eq(anbuSquad.id, squadId));

/**
 * Redirects a squad's pending join requests to its new leader. Leaderless
 * squads keep the old receiver as a notification fallback.
 *
 * @param client - The Drizzle client used to update pending requests.
 * @param squadId - The squad whose pending requests are redirected.
 * @param newLeaderId - The successor who should receive requests, or null when leaderless.
 */
export const reassignPendingAnbuRequestsOnPromotion = async (
  client: DrizzleClient,
  squadId: string,
  newLeaderId: string | null,
) => {
  if (!newLeaderId) return;
  await client
    .update(userRequest)
    .set({ receiverId: newLeaderId })
    .where(
      and(
        eq(userRequest.type, "ANBU"),
        eq(userRequest.status, "PENDING"),
        eq(userRequest.relatedId, squadId),
      ),
    );
};

/** Build the `anbuSquad` update for `decayClansAndAnbu`, setting `pvpActivity`. */
export const updateAnbuSquadForDecayClansAndAnbu = (
  client: Pick<DrizzleClient, "update">,
) =>
  client.update(anbuSquad).set({
    pvpActivity: sql`${anbuSquad.pvpActivity} * 0.95`,
  });

/** Build the `anbuSquad` update for `GET`, setting `pvpActivity`. */
export const updateAnbuSquadForGET = (client: Pick<DrizzleClient, "update">) =>
  client.update(anbuSquad).set({
    pvpActivity: 0,
  });

/** Build an atomic points increment for one ANBU squad. */
export const incrementAnbuPoints = (
  client: Pick<DrizzleClient, "update">,
  points: number,
  anbuId: string,
) =>
  client
    .update(anbuSquad)
    .set({ points: sql`${anbuSquad.points} + ${points}` })
    .where(eq(anbuSquad.id, anbuId));
