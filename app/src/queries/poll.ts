/**
 * Database access for poll; authorization and transaction scopes stay in callers.
 */
import type { SQL } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import { poll, userPollVote } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { clampActionLogText } from "@/utils/actionLog";

/**
 * Fetch a poll by ID
 * @param client - The database client
 * @param pollId - The ID of the poll to fetch
 * @returns The poll
 */
export const fetchPoll = async (client: DrizzleClient, pollId: string) => {
  return await client.query.poll.findFirst({
    where: eq(poll.id, pollId),
  });
};

/**
 * Fetch a user's vote for a specific poll
 * @param client - The database client
 * @param userId - The ID of the user
 * @param pollId - The ID of the poll
 * @returns The user's vote
 */
export const fetchUserVote = async (
  client: DrizzleClient,
  userId: string,
  pollId: string,
) => {
  const vote = await client.query.userPollVote.findFirst({
    where: and(eq(userPollVote.userId, userId), eq(userPollVote.pollId, pollId)),
    with: {
      option: true,
    },
  });
  return vote || null;
};

import { count, desc, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { actionLog, pollOption } from "@/drizzle/schema";
import type { PollOptionSchema } from "@/validators/poll";

/** Build the `poll` insert for `createPoll`. */
export const insertPollForCreatePoll = (
  client: Pick<DrizzleClient, "insert">,
  pollId: string,
  input: {
    title: string;
    description: string;
    allowCustomOptions: false | true;
    endDate?: undefined | Date;
  },
  user: { userId: string },
) =>
  client.insert(poll).values({
    id: pollId,
    title: input.title,
    description: input.description,
    allowCustomOptions: input.allowCustomOptions,
    createdByUserId: user.userId,
    endDate: input.endDate,
  });

/** Build a `pollOption` row for a text option or an option naming a user. */
export const toPollOptionRow = (
  option: PollOptionSchema,
  pollId: string,
  createdByUserId: string,
  isCustomOption: boolean,
) => ({
  id: nanoid(),
  pollId,
  createdByUserId,
  isCustomOption,
  ...(option.type === "text"
    ? { text: option.text, optionType: "text" as const }
    : {
        text: option.username,
        optionType: "user" as const,
        targetUserId: option.userId,
      }),
});

/** Build the `pollOption` insert. */
export const insertPollOptions = (
  client: Pick<DrizzleClient, "insert">,
  options: ReturnType<typeof toPollOptionRow>[],
) => client.insert(pollOption).values(options);

/** Build the `actionLog` insert for `createPoll`. */
export const insertActionLogForCreatePoll = (
  client: Pick<DrizzleClient, "insert">,
  user: { userId: string },
  input: {
    title: string;
    description: string;
    options: import("@/validators/poll").PollOptionSchema[];
  },
  pollId: string,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: user.userId,
    tableName: "poll",
    changes: [
      `Created poll: ${input.title}`,
      ...(input.description ? [input.description] : []),
      `Options: ${input.options.map((o) => (o.type === "text" ? o.text : o.username)).join(", ")}`,
    ],
    relatedId: pollId,
    relatedMsg: clampActionLogText(`Poll created: ${input.title}`),
  });

/** Build the `poll` update for `updatePoll`, using predicates on `id`. */
export const updatePollForUpdatePoll = (
  client: Pick<DrizzleClient, "update">,
  updateData: Record<string, unknown>,
  input: { id: string },
) => client.update(poll).set(updateData).where(eq(poll.id, input.id));

/** Build the `actionLog` insert for `updatePoll`. */
export const insertActionLogForUpdatePoll = (
  client: Pick<DrizzleClient, "insert">,
  user: { userId: string },
  existingPoll: { title: string },
  updateData: Record<string, unknown>,
  input: { id: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: user.userId,
    tableName: "poll",
    changes: [
      `Updated poll: ${existingPoll.title}`,
      ...Object.entries(updateData).map(([k, v]) => `${k}: ${JSON.stringify(v)}`),
    ],
    relatedId: input.id,
    relatedMsg: clampActionLogText(`Poll updated: ${existingPoll.title}`),
  });

/** Build the `pollOption` lookup for `vote`, using predicates on `id` and `pollId`. */
export const findPollOptionForVote = (
  client: Pick<DrizzleClient, "query">,
  input: { optionId: string; pollId: string },
) =>
  client.query.pollOption.findFirst({
    where: and(eq(pollOption.id, input.optionId), eq(pollOption.pollId, input.pollId)),
  });

/** Build the `userPollVote` update for `vote`, setting `optionId`, using predicates on `id`. */
export const updateUserPollVoteForVote = (
  client: Pick<DrizzleClient, "update">,
  input: { optionId: string },
  existingVote: { id: string },
) =>
  client
    .update(userPollVote)
    .set({ optionId: input.optionId })
    .where(eq(userPollVote.id, existingVote.id));

/** Build the `userPollVote` insert for `vote`. */
export const insertUserPollVoteForVote = (
  client: Pick<DrizzleClient, "insert">,
  user: { userId: string },
  input: { pollId: string; optionId: string },
) =>
  client.insert(userPollVote).values({
    id: nanoid(),
    userId: user.userId,
    pollId: input.pollId,
    optionId: input.optionId,
  });

/** Build the `pollOption` lookup for `addOption`, including predicates on `pollId`, `text`, `optionType`. */
export const findPollOptionForAddOption = (
  client: Pick<DrizzleClient, "query">,
  input: import("@/validators/poll").AddPollOptionSchema,
) =>
  client.query.pollOption.findFirst({
    where:
      input.type === "text"
        ? and(
            eq(pollOption.pollId, input.pollId),
            eq(pollOption.text, input.text),
            eq(pollOption.optionType, "text"),
          )
        : and(
            eq(pollOption.pollId, input.pollId),
            eq(pollOption.targetUserId, input.userId),
            eq(pollOption.optionType, "user"),
          ),
  });

/** Build the `actionLog` insert for `addOption`. */
export const insertActionLogForAddOption = (
  client: Pick<DrizzleClient, "insert">,
  user: { userId: string },
  existingPoll: { title: string },
  input: PollOptionSchema & { pollId: string },
) => {
  const isUser = input.type === "user";
  const label = isUser ? input.username : input.text;
  const kind = isUser ? "user option" : "option";
  return client.insert(actionLog).values({
    id: nanoid(),
    userId: user.userId,
    tableName: "poll",
    changes: [
      `Added ${kind} to poll: ${existingPoll.title}`,
      `${isUser ? "User" : "Option"}: ${label}`,
    ],
    relatedId: input.pollId,
    relatedMsg: clampActionLogText(`Added ${kind}: ${label}`),
  });
};

/** Build the `poll` listing for `getPolls`, using the configured predicates. */
export const listPollForGetPolls = (
  client: Pick<DrizzleClient, "query">,
  whereClause: undefined | SQL<unknown>,
  skip: number,
  limit: number,
) =>
  client.query.poll.findMany({
    where: whereClause,
    with: {
      createdBy: {
        columns: {
          userId: true,
          username: true,
          avatar: true,
        },
      },
      options: {
        with: {
          createdBy: {
            columns: {
              userId: true,
              username: true,
              avatar: true,
            },
          },
          targetUser: {
            columns: {
              userId: true,
              username: true,
              avatar: true,
            },
          },
        },
      },
    },
    orderBy: [desc(poll.createdAt)],
    offset: skip,
    limit,
  });

/** Build the `userPollVote` deletion for `retractVote`, using predicates on `id`. */
export const deleteUserPollVoteForRetractVote = (
  client: Pick<DrizzleClient, "delete">,
  existingVote: { id: string },
) => client.delete(userPollVote).where(eq(userPollVote.id, existingVote.id));

/** Build the `poll` update for `closePoll`, setting `isActive`, using predicates on `id`. */
export const updatePollForClosePoll = (
  client: Pick<DrizzleClient, "update">,
  input: { isActive: false | true; id: string },
) => client.update(poll).set({ isActive: input.isActive }).where(eq(poll.id, input.id));

/** Build the `actionLog` insert for `closePoll`. */
export const insertActionLogForClosePoll = (
  client: Pick<DrizzleClient, "insert">,
  user: { userId: string },
  input: { isActive: false | true; id: string },
  existingPoll: { title: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: user.userId,
    tableName: "poll",
    changes: [`${input.isActive ? "Reopened" : "Closed"} poll: ${existingPoll.title}`],
    relatedId: input.id,
    relatedMsg: clampActionLogText(
      `${input.isActive ? "Reopened" : "Closed"} poll: ${existingPoll.title}`,
    ),
  });

/** Build the `pollOption` lookup for `deletePollOption`, using predicates on `id` and `pollId`. */
export const findPollOptionForDeletePollOption = (
  client: Pick<DrizzleClient, "query">,
  input: { optionId: string; pollId: string },
) =>
  client.query.pollOption.findFirst({
    where: and(eq(pollOption.id, input.optionId), eq(pollOption.pollId, input.pollId)),
    with: {
      votes: true,
    },
  });

/** Build the `userPollVote` deletion for `deletePollOption`, using predicates on `optionId`. */
export const deleteUserPollVoteForDeletePollOption = (
  client: Pick<DrizzleClient, "delete">,
  input: { optionId: string },
) => client.delete(userPollVote).where(eq(userPollVote.optionId, input.optionId));

/** Build the `pollOption` deletion for `deletePollOption`, using predicates on `id` and `pollId`. */
export const deletePollOptionForDeletePollOption = (
  client: Pick<DrizzleClient, "delete">,
  input: { optionId: string; pollId: string },
) =>
  client
    .delete(pollOption)
    .where(and(eq(pollOption.id, input.optionId), eq(pollOption.pollId, input.pollId)));

/** Build the `actionLog` insert for `deletePollOption`. */
export const insertActionLogForDeletePollOption = (
  client: Pick<DrizzleClient, "insert">,
  user: { userId: string },
  existingPoll: { title: string },
  input: { optionId: string; pollId: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: user.userId,
    tableName: "poll",
    changes: [
      `Deleted poll option in poll: ${existingPoll.title}`,
      `OptionId: ${input.optionId}`,
    ],
    relatedId: input.pollId,
    relatedMsg: `Deleted poll option: ${input.optionId}`,
  });

/** Count all vote rows by poll and option, retaining missing-option votes in poll totals. */
export const selectUserPollVoteForGetVoteCountsForPolls = (
  client: Pick<DrizzleClient, "select">,
  pollIds: string[],
) =>
  client
    .select({
      pollId: userPollVote.pollId,
      optionId: userPollVote.optionId,
      count: count(),
    })
    .from(userPollVote)
    .where(inArray(userPollVote.pollId, pollIds))
    .groupBy(userPollVote.pollId, userPollVote.optionId);
