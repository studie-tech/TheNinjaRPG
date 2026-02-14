import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { Poll, PollOption } from "@/drizzle/schema";
import { actionLog, poll, pollOption, userPollVote } from "@/drizzle/schema";
import { fetchUser } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import {
  canAddNonCustomPollOptions,
  canClosePolls,
  canCreatePolls,
  canDeletePollOptions,
  canEditPolls,
  canInteractWithPolls,
} from "@/utils/permissions";
import {
  addPollOptionSchema,
  closePollSchema,
  createPollSchema,
  deletePollOptionSchema,
  getPollsSchema,
  retractVoteSchema,
  updatePollSchema,
  votePollSchema,
} from "@/validators/poll";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
} from "../trpc";

export const pollRouter = createTRPCRouter({
  // Create a new poll
  createPoll: protectedProcedure
    .input(createPollSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!user) return errorResponse("User not found");
      if (!canInteractWithPolls(user.rank)) {
        return errorResponse("Too low rank to vote. Must be at least Genin.");
      }
      if (!canCreatePolls(user.role)) {
        return errorResponse("You don't have permission to create polls");
      }
      // Create poll
      const pollId = nanoid();

      // Create poll options with proper type casting
      const optionsToInsert = input.options.map((option) => {
        if (option.type === "text") {
          return {
            id: nanoid(),
            pollId,
            text: option.text,
            optionType: "text" as const,
            createdByUserId: user.userId,
            isCustomOption: false,
          };
        } else if (option.type === "user") {
          return {
            id: nanoid(),
            pollId,
            text: option.username,
            optionType: "user" as const,
            targetUserId: option.userId,
            createdByUserId: user.userId,
            isCustomOption: false,
          };
        }
        // This should never happen due to the discriminated union
        throw new Error("Invalid option type");
      });

      // Run both database operations in parallel
      await Promise.all([
        ctx.drizzle.insert(poll).values({
          id: pollId,
          title: input.title,
          description: input.description,
          allowCustomOptions: input.allowCustomOptions,
          createdByUserId: user.userId,
          endDate: input.endDate,
        }),
        ctx.drizzle.insert(pollOption).values(optionsToInsert),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: user.userId,
          tableName: "poll",
          changes: [
            `Created poll: ${input.title}`,
            ...(input.description ? [input.description] : []),
            `Options: ${input.options.map((o) => (o.type === "text" ? o.text : o.username)).join(", ")}`,
          ],
          relatedId: pollId,
          relatedMsg: `Poll created: ${input.title}`,
        }),
      ]);

      return { success: true, message: "Poll created successfully" };
    }),

  // Update a poll
  updatePoll: protectedProcedure
    .input(updatePollSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Get user and poll in parallel
      const [user, existingPoll] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchPoll(ctx.drizzle, input.id),
      ]);

      // Guard
      if (!user) return errorResponse("User not found");
      if (!canInteractWithPolls(user.rank)) {
        return errorResponse("Too low rank to vote. Must be at least Genin.");
      }
      if (!existingPoll) return errorResponse("Poll not found");
      if (existingPoll.createdByUserId !== user.userId && !canEditPolls(user.role)) {
        return errorResponse("You don't have permission to update this poll");
      }

      // Get the new poll data
      const updateData: Record<string, unknown> = {};
      if (input.title !== undefined) updateData.title = input.title;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.allowCustomOptions !== undefined)
        updateData.allowCustomOptions = input.allowCustomOptions;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;
      if (input.endDate !== undefined) updateData.endDate = input.endDate;

      // Update poll
      await ctx.drizzle.update(poll).set(updateData).where(eq(poll.id, input.id));
      await ctx.drizzle.insert(actionLog).values({
        id: nanoid(),
        userId: user.userId,
        tableName: "poll",
        changes: [
          `Updated poll: ${existingPoll.title}`,
          ...Object.entries(updateData).map(([k, v]) => `${k}: ${JSON.stringify(v)}`),
        ],
        relatedId: input.id,
        relatedMsg: `Poll updated: ${existingPoll.title}`,
      });

      return { success: true, message: "Poll updated successfully" };
    }),

  // Vote in a poll
  vote: protectedProcedure
    .input(votePollSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Get user, poll, option, and existing vote in parallel
      const [user, existingPoll, existingVote, option] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchPoll(ctx.drizzle, input.pollId),
        fetchUserVote(ctx.drizzle, ctx.userId, input.pollId),
        ctx.drizzle.query.pollOption.findFirst({
          where: and(
            eq(pollOption.id, input.optionId),
            eq(pollOption.pollId, input.pollId),
          ),
        }),
      ]);
      // Guard
      if (!user) return errorResponse("User not found");
      if (!canInteractWithPolls(user.rank)) {
        return errorResponse("Too low rank to vote. Must be at least Genin.");
      }
      if (!existingPoll) return errorResponse("Poll not found");
      if (!existingPoll.isActive) return errorResponse("Poll is not active");
      if (!option) return errorResponse("Option not found");
      if (existingPoll.endDate && new Date(existingPoll.endDate) < new Date()) {
        return errorResponse("Poll has ended");
      }

      // Update existing vote
      if (existingVote) {
        await ctx.drizzle
          .update(userPollVote)
          .set({ optionId: input.optionId })
          .where(eq(userPollVote.id, existingVote.id));
        return { success: true, message: "Vote updated successfully" };
      }

      // Create new vote
      await ctx.drizzle.insert(userPollVote).values({
        id: nanoid(),
        userId: user.userId,
        pollId: input.pollId,
        optionId: input.optionId,
      });
      return { success: true, message: "Vote submitted successfully" };
    }),

  // Add a custom option to a poll
  addOption: protectedProcedure
    .input(addPollOptionSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, existingPoll, existingOption] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchPoll(ctx.drizzle, input.pollId),
        ctx.drizzle.query.pollOption.findFirst({
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
        }),
      ]);
      // Guard
      if (!user) return errorResponse("User not found");
      if (!existingPoll) return errorResponse("Poll not found");
      if (existingOption) return errorResponse("Option already exists");
      if (!existingPoll.isActive) return errorResponse("Poll is not active");
      const isAdmin = canAddNonCustomPollOptions(user.role);
      if (!isAdmin && !existingPoll.allowCustomOptions) {
        return errorResponse("Custom options are not allowed for this poll");
      }
      if (existingPoll.endDate && new Date(existingPoll.endDate) < new Date()) {
        return errorResponse("Poll has ended");
      }

      // Create new option
      if (input.type === "text") {
        await ctx.drizzle.insert(pollOption).values({
          id: nanoid(),
          pollId: input.pollId,
          text: input.text,
          optionType: "text" as const,
          createdByUserId: user.userId,
          isCustomOption: !isAdmin, // Only mark as custom if not admin
        });
        await ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: user.userId,
          tableName: "poll",
          changes: [
            `Added option to poll: ${existingPoll.title}`,
            `Option: ${input.text}`,
          ],
          relatedId: input.pollId,
          relatedMsg: `Added option: ${input.text}`,
        });
      } else if (input.type === "user") {
        await ctx.drizzle.insert(pollOption).values({
          id: nanoid(),
          pollId: input.pollId,
          text: input.username,
          optionType: "user" as const,
          targetUserId: input.userId,
          createdByUserId: user.userId,
          isCustomOption: !isAdmin, // Only mark as custom if not admin
        });
        await ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: user.userId,
          tableName: "poll",
          changes: [
            `Added user option to poll: ${existingPoll.title}`,
            `User: ${input.username}`,
          ],
          relatedId: input.pollId,
          relatedMsg: `Added user option: ${input.username}`,
        });
      } else {
        return errorResponse("Invalid option type");
      }

      return { success: true, message: "Option added successfully" };
    }),

  // Get all polls with pagination
  getPolls: publicProcedure.input(getPollsSchema).query(async ({ ctx, input }) => {
    const currentCursor = input?.cursor ? input.cursor : 0;
    const limit = input?.limit ? input.limit : 10;
    const skip = currentCursor * limit;
    const whereClause = input.includeInactive ? undefined : eq(poll.isActive, true);

    // First, get the polls with their options and creators
    const polls = await ctx.drizzle.query.poll.findMany({
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

    if (polls.length === 0) {
      return {
        data: [],
        nextCursor: null,
      };
    }

    // Get all poll IDs
    const pollIds = polls.map((p) => p.id);

    // Get vote counts for all polls
    const { optionVoteMap, totalVoteMap } = await getVoteCountsForPolls(
      ctx.drizzle,
      pollIds,
    );

    // Process each poll with the vote data
    const pollsWithVoteCounts = polls.map((pollData) => {
      const totalVotes = totalVoteMap.get(pollData.id) || 0;
      const optionVotes = optionVoteMap.get(pollData.id);

      return processPollWithVotes(pollData, optionVotes, totalVotes);
    });

    const nextCursor = polls.length < limit ? null : currentCursor + 1;
    return {
      data: pollsWithVoteCounts,
      nextCursor,
    };
  }),

  // Get user's vote for a specific poll
  getUserVote: protectedProcedure
    .input(z.object({ pollId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!user) throw new Error("User not found");
      return await fetchUserVote(ctx.drizzle, ctx.userId, input.pollId);
    }),

  // Retract a vote from a poll
  retractVote: protectedProcedure
    .input(retractVoteSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Get user, poll, and existing vote in parallel
      const [user, existingPoll, existingVote] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchPoll(ctx.drizzle, input.pollId),
        fetchUserVote(ctx.drizzle, ctx.userId, input.pollId),
      ]);

      // Guard
      if (!user) return errorResponse("User not found");
      if (!canInteractWithPolls(user.rank)) {
        return errorResponse("Too low rank to vote. Must be at least Genin.");
      }
      if (!existingPoll) return errorResponse("Poll not found");
      if (!existingPoll.isActive) return errorResponse("Poll is not active");
      if (!existingVote) return errorResponse("You haven't voted in this poll");
      if (existingPoll.endDate && new Date(existingPoll.endDate) < new Date()) {
        return errorResponse("Poll has ended");
      }

      // Delete the vote
      await ctx.drizzle
        .delete(userPollVote)
        .where(eq(userPollVote.id, existingVote.id));
      return { success: true, message: "Vote retracted successfully" };
    }),

  // Close or reopen a poll
  closePoll: protectedProcedure
    .input(closePollSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Get user and poll in parallel
      const [user, existingPoll] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchPoll(ctx.drizzle, input.id),
      ]);

      // Guard
      if (!user) return errorResponse("User not found");
      if (!canInteractWithPolls(user.rank)) {
        return errorResponse("Too low rank to vote. Must be at least Genin.");
      }
      if (!existingPoll) return errorResponse("Poll not found");
      if (!canClosePolls(user.role)) {
        return errorResponse("You don't have permission to close polls");
      }

      // Update poll status
      await ctx.drizzle
        .update(poll)
        .set({ isActive: input.isActive })
        .where(eq(poll.id, input.id));
      await ctx.drizzle.insert(actionLog).values({
        id: nanoid(),
        userId: user.userId,
        tableName: "poll",
        changes: [
          `${input.isActive ? "Reopened" : "Closed"} poll: ${existingPoll.title}`,
        ],
        relatedId: input.id,
        relatedMsg: `${input.isActive ? "Reopened" : "Closed"} poll: ${existingPoll.title}`,
      });

      return {
        success: true,
        message: input.isActive
          ? "Poll reopened successfully"
          : "Poll closed successfully",
      };
    }),

  // Delete a poll option
  deletePollOption: protectedProcedure
    .input(deletePollOptionSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Get user, poll, and option in parallel
      const [user, existingPoll, existingOption] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchPoll(ctx.drizzle, input.pollId),
        ctx.drizzle.query.pollOption.findFirst({
          where: and(
            eq(pollOption.id, input.optionId),
            eq(pollOption.pollId, input.pollId),
          ),
          with: {
            votes: true,
          },
        }),
      ]);

      // Guard
      if (!user) return errorResponse("User not found");
      if (!canInteractWithPolls(user.rank)) {
        return errorResponse("Too low rank to vote. Must be at least Genin.");
      }
      if (!existingPoll) return errorResponse("Poll not found");
      if (!existingOption) return errorResponse("Option not found");

      // Check if user has permission to delete this option
      // Allow if user is admin OR if user created the option
      const isAdmin = canDeletePollOptions(user.role);
      const isCreator = existingOption.createdByUserId === user.userId;

      if (!isAdmin && !isCreator) {
        return errorResponse("You don't have permission to delete this poll option");
      }

      // Delete both the votes and the option in parallel
      await Promise.all([
        // Delete any votes for this option
        ctx.drizzle
          .delete(userPollVote)
          .where(eq(userPollVote.optionId, input.optionId)),

        // Delete the option
        ctx.drizzle
          .delete(pollOption)
          .where(
            and(eq(pollOption.id, input.optionId), eq(pollOption.pollId, input.pollId)),
          ),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: user.userId,
          tableName: "poll",
          changes: [
            `Deleted poll option in poll: ${existingPoll.title}`,
            `OptionId: ${input.optionId}`,
          ],
          relatedId: input.pollId,
          relatedMsg: `Deleted poll option: ${input.optionId}`,
        }),
      ]);

      return { success: true, message: "Poll option deleted successfully" };
    }),
});

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

// Define types for the poll data with relations
interface PollWithOptions extends Poll {
  createdBy: {
    userId: string;
    username: string;
    avatar: string | null;
  };
  options: (PollOption & {
    createdBy: {
      userId: string;
      username: string;
      avatar: string | null;
    };
    targetUser?: {
      userId: string;
      username: string;
      avatar: string | null;
    } | null;
  })[];
}

/**
 * Helper function to get vote counts for polls
 * @param client - The database client
 * @param pollIds - Array of poll IDs to get vote counts for
 * @returns Object containing vote maps and processed polls
 */
async function getVoteCountsForPolls(client: DrizzleClient, pollIds: string[]) {
  // Run both queries in parallel for better performance
  const [optionVoteCounts, totalVoteCounts] = await Promise.all([
    // Get vote counts for all options in all polls
    client
      .select({
        pollId: userPollVote.pollId,
        optionId: userPollVote.optionId,
        count: sql<number>`count(*)`,
      })
      .from(userPollVote)
      .where(inArray(userPollVote.pollId, pollIds))
      .groupBy(userPollVote.pollId, userPollVote.optionId),

    // Get total votes for all polls
    client
      .select({
        pollId: userPollVote.pollId,
        count: sql<number>`count(*)`,
      })
      .from(userPollVote)
      .where(inArray(userPollVote.pollId, pollIds))
      .groupBy(userPollVote.pollId),
  ]);

  // Create maps for quick lookup
  const optionVoteMap = new Map<string, Map<string, number>>();
  optionVoteCounts.forEach(({ pollId, optionId, count }) => {
    if (!optionVoteMap.has(pollId)) {
      optionVoteMap.set(pollId, new Map<string, number>());
    }
    optionVoteMap.get(pollId)?.set(optionId, count);
  });

  const totalVoteMap = new Map<string, number>();
  totalVoteCounts.forEach(({ pollId, count }) => {
    totalVoteMap.set(pollId, count);
  });

  return { optionVoteMap, totalVoteMap };
}

/**
 * Helper function to process poll data with vote counts
 * @param pollData - The poll data to process
 * @param optionVotes - Map of option votes
 * @param totalVotes - Total votes for the poll
 * @returns Processed poll with vote counts
 */
function processPollWithVotes(
  pollData: PollWithOptions,
  optionVotes: Map<string, number> | undefined,
  totalVotes: number,
) {
  const voteMap = optionVotes || new Map<string, number>();

  // Add vote counts to each option
  const optionsWithVotes = pollData.options.map((option) => ({
    ...option,
    voteCount: voteMap.get(option.id) || 0,
    percentage:
      totalVotes > 0
        ? Math.round(((voteMap.get(option.id) || 0) / totalVotes) * 100)
        : 0,
  }));

  // Sort options by vote count (descending)
  optionsWithVotes.sort((a, b) => b.voteCount - a.voteCount);

  return {
    ...pollData,
    options: optionsWithVotes,
    totalVotes,
  };
}
