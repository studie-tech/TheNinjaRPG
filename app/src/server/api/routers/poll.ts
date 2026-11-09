import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { poll } from "@/drizzle/schema";
import { getVoteCountsForPolls, processPollWithVotes } from "@/libs/poll";
import {
  deletePollOptionForDeletePollOption,
  deleteUserPollVoteForDeletePollOption,
  deleteUserPollVoteForRetractVote,
  fetchPoll,
  fetchUserVote,
  findPollOptionForAddOption,
  findPollOptionForDeletePollOption,
  findPollOptionForVote,
  insertActionLogForAddOption,
  insertActionLogForClosePoll,
  insertActionLogForCreatePoll,
  insertActionLogForDeletePollOption,
  insertActionLogForUpdatePoll,
  insertPollForCreatePoll,
  insertPollOptions,
  insertUserPollVoteForVote,
  listPollForGetPolls,
  toPollOptionRow,
  updatePollForClosePoll,
  updatePollForUpdatePoll,
  updateUserPollVoteForVote,
} from "@/queries/poll";
import { fetchUser } from "@/queries/profile";

import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
} from "@/server/api/trpc";
import { offsetPage } from "@/server/utils/pagination";
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
  createPollSchema,
  updatePollSchema,
} from "@/validators/poll";

// Schema for voting in a poll
const votePollSchema = z.object({
  pollId: z.string(),
  optionId: z.string(),
});

// Schema for getting polls with pagination
const getPollsSchema = z.object({
  cursor: z.number().nullish(),
  limit: z.number().min(1).max(100).prefault(10),
  includeInactive: z.boolean().prefault(false),
});

// Schema for retracting a vote from a poll
const retractVoteSchema = z.object({
  pollId: z.string(),
});

// Schema for closing a poll
const closePollSchema = z.object({
  id: z.string(),
  isActive: z.boolean(),
});

// Schema for deleting a poll option
const deletePollOptionSchema = z.object({
  pollId: z.string(),
  optionId: z.string(),
});

const POLL_RANK_MESSAGE = "Too low rank to use polls. Must be at least Genin.";

export const pollRouter = createTRPCRouter({
  // Create a new poll
  createPoll: protectedProcedure
    .input(createPollSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canInteractWithPolls(user.rank)) {
        return errorResponse(POLL_RANK_MESSAGE);
      }
      if (!canCreatePolls(user.role)) {
        return errorResponse("You don't have permission to create polls");
      }
      // Create poll
      const pollId = nanoid();

      // Create poll options with proper type casting
      const optionsToInsert = input.options.map((option) =>
        toPollOptionRow(option, pollId, user.userId, false),
      );

      // Run both database operations in parallel
      await Promise.all([
        insertPollForCreatePoll(ctx.drizzle, pollId, input, user),
        insertPollOptions(ctx.drizzle, optionsToInsert),
        insertActionLogForCreatePoll(ctx.drizzle, user, input, pollId),
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
      if (!canInteractWithPolls(user.rank)) {
        return errorResponse(POLL_RANK_MESSAGE);
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
      await updatePollForUpdatePoll(ctx.drizzle, updateData, input);
      await insertActionLogForUpdatePoll(
        ctx.drizzle,
        user,
        existingPoll,
        updateData,
        input,
      );

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
        findPollOptionForVote(ctx.drizzle, input),
      ]);
      // Guard
      if (!canInteractWithPolls(user.rank)) {
        return errorResponse(POLL_RANK_MESSAGE);
      }
      if (!existingPoll) return errorResponse("Poll not found");
      if (!existingPoll.isActive) return errorResponse("Poll is not active");
      if (!option) return errorResponse("Option not found");
      if (hasPollEnded(existingPoll)) {
        return errorResponse("Poll has ended");
      }

      // Update existing vote
      if (existingVote) {
        await updateUserPollVoteForVote(ctx.drizzle, input, existingVote);
        return { success: true, message: "Vote updated successfully" };
      }

      // Create new vote
      await insertUserPollVoteForVote(ctx.drizzle, user, input);
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
        findPollOptionForAddOption(ctx.drizzle, input),
      ]);
      // Guard
      if (!canInteractWithPolls(user.rank)) {
        return errorResponse(POLL_RANK_MESSAGE);
      }
      if (!existingPoll) return errorResponse("Poll not found");
      if (existingOption) return errorResponse("Option already exists");
      if (!existingPoll.isActive) return errorResponse("Poll is not active");
      const isAdmin = canAddNonCustomPollOptions(user.role);
      if (!isAdmin && !existingPoll.allowCustomOptions) {
        return errorResponse("Custom options are not allowed for this poll");
      }
      if (hasPollEnded(existingPoll)) {
        return errorResponse("Poll has ended");
      }

      // Create new option
      // Only mark as custom if not admin
      await insertPollOptions(ctx.drizzle, [
        toPollOptionRow(input, input.pollId, user.userId, !isAdmin),
      ]);
      await insertActionLogForAddOption(ctx.drizzle, user, existingPoll, input);

      return { success: true, message: "Option added successfully" };
    }),

  // Get all polls with pagination
  getPolls: publicProcedure.input(getPollsSchema).query(async ({ ctx, input }) => {
    const limit = input.limit;
    const { skip, cursorAfter } = offsetPage(input);
    const whereClause = input.includeInactive ? undefined : eq(poll.isActive, true);

    // First, get the polls with their options and creators
    const polls = await listPollForGetPolls(ctx.drizzle, whereClause, skip, limit);

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

    const nextCursor = cursorAfter(polls);
    return {
      data: pollsWithVoteCounts,
      nextCursor,
    };
  }),

  // Get user's vote for a specific poll
  getUserVote: protectedProcedure
    .input(z.object({ pollId: z.string() }))
    .query(async ({ ctx, input }) => {
      // fetchUser rejects callers without a character
      await fetchUser(ctx.drizzle, ctx.userId);
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
      if (!canInteractWithPolls(user.rank)) {
        return errorResponse(POLL_RANK_MESSAGE);
      }
      if (!existingPoll) return errorResponse("Poll not found");
      if (!existingPoll.isActive) return errorResponse("Poll is not active");
      if (!existingVote) return errorResponse("You haven't voted in this poll");
      if (hasPollEnded(existingPoll)) {
        return errorResponse("Poll has ended");
      }

      // Delete the vote
      await deleteUserPollVoteForRetractVote(ctx.drizzle, existingVote);
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
      if (!canInteractWithPolls(user.rank)) {
        return errorResponse(POLL_RANK_MESSAGE);
      }
      if (!existingPoll) return errorResponse("Poll not found");
      if (!canClosePolls(user.role)) {
        return errorResponse("You don't have permission to close polls");
      }

      // Update poll status
      await updatePollForClosePoll(ctx.drizzle, input);
      await insertActionLogForClosePoll(ctx.drizzle, user, input, existingPoll);

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
        findPollOptionForDeletePollOption(ctx.drizzle, input),
      ]);

      // Guard
      if (!canInteractWithPolls(user.rank)) {
        return errorResponse(POLL_RANK_MESSAGE);
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
        deleteUserPollVoteForDeletePollOption(ctx.drizzle, input),

        // Delete the option
        deletePollOptionForDeletePollOption(ctx.drizzle, input),
        insertActionLogForDeletePollOption(ctx.drizzle, user, existingPoll, input),
      ]);

      return { success: true, message: "Poll option deleted successfully" };
    }),
});

/** Whether a poll with a closing date has passed it. */
const hasPollEnded = (existingPoll: { endDate: Date | null }) =>
  !!existingPoll.endDate && new Date(existingPoll.endDate) < new Date();
