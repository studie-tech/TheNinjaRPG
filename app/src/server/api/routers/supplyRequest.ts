import { z } from "zod";
import {
  getSupplyRequestInventoryUpdate,
  getSupplyRequestUserUpdate,
} from "@/deltas/supplyRequest";
import { OCCUPATIONS, SUPPLY_REQUEST_BUNDLE_SIZE } from "@/drizzle/constants";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { getExperienceTrackerTasks } from "@/libs/quest/rewards";
import {
  getSupplyRequestReward,
  isSupplyStackAvailable,
  matchesSupplyProfession,
  supplyExperienceField,
  supplyRequestBlockMessage,
} from "@/libs/supplyRequest";
import { fetchUser } from "@/queries/profile";
import {
  listSupplyRequestStacks,
  submitSupplyRequestAtomically,
} from "@/queries/supplyRequest";
import { fetchUpdatedUser } from "@/routers/profile";
import { errorResponse, protectedProcedure } from "@/server/api/trpc";
import {
  actionReadinessResponse,
  prepareActionReadiness,
} from "@/server/utils/actionReadiness";
import { handleQuestConsequences } from "@/server/utils/questConsequences";
import { getNextUserSnapshotAt, nextUtcDayAt } from "@/utils/time";
import { inventoryQuantityChangeSchema } from "@/validators/inventory";
import { dateInputSchema } from "@/validators/misc";
import { userDeltaResponseSchema } from "@/validators/userCache";

/** Wake Island's daily profession exchange, hosted by the Administration Building. */
export const supplyRequestProcedures = {
  getSupplyRequest: protectedProcedure.query(async ({ ctx }) => {
    const [user, stacks] = await Promise.all([
      fetchUser(ctx.drizzle, ctx.userId),
      listSupplyRequestStacks(ctx.drizzle, ctx.userId),
    ]);
    const now = new Date();
    return {
      occupation: user.occupation,
      blocked: supplyRequestBlockMessage(user, now),
      nextResetAt: nextUtcDayAt(now),
      stacks: stacks
        .filter(
          (stack) =>
            isSupplyStackAvailable(stack, now) &&
            matchesSupplyProfession(stack.item, user.occupation) &&
            (stack.item.auctionMaxPrice ?? 0) > 0,
        )
        .map((stack) => ({
          id: stack.id,
          itemId: stack.itemId,
          quantity: stack.quantity,
          updatedAt: stack.updatedAt,
          name: stack.item.name,
          image: stack.item.image,
          auctionMaxPrice: stack.item.auctionMaxPrice ?? 0,
        })),
    };
  }),
  submitSupplyRequest: protectedProcedure
    .input(
      z.object({
        userItemId: z.string().min(1).max(191),
        quantity: z.int().positive().multipleOf(SUPPLY_REQUEST_BUNDLE_SIZE),
        expectedQuantity: z.int().positive(),
        expectedUpdatedAt: dateInputSchema,
        occupation: z.enum(OCCUPATIONS),
        auctionMaxPrice: z.int().positive(),
      }),
    )
    .output(
      userDeltaResponseSchema.extend({
        inventoryChanges: z.array(inventoryQuantityChangeSchema).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updatedUser, stacks] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          rejectIsolatedPyramid: true,
        }),
        listSupplyRequestStacks(ctx.drizzle, ctx.userId, input.userItemId),
      ]);
      const initialUser = updatedUser.user;
      if (!initialUser) return errorResponse("Character could not be loaded.");
      const now = new Date();
      const readiness = prepareActionReadiness(initialUser, updatedUser.settings, now);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      const blocked = supplyRequestBlockMessage(user, now);
      if (blocked) return errorResponse(blocked);
      if (!user.occupation || user.occupation !== input.occupation)
        return errorResponse("Your profession changed. Review your supplies again.");
      const occupation = user.occupation;
      const stack = stacks.find((entry) => entry.id === input.userItemId);
      if (
        !stack ||
        !isSupplyStackAvailable(stack, now) ||
        !matchesSupplyProfession(stack.item, user.occupation) ||
        !stack.item.auctionMaxPrice ||
        stack.item.auctionMaxPrice !== input.auctionMaxPrice ||
        stack.quantity !== input.expectedQuantity ||
        stack.updatedAt.getTime() !== input.expectedUpdatedAt.getTime() ||
        input.quantity > stack.quantity
      )
        return errorResponse(
          "These supplies changed or are unavailable. Review your inventory and try again.",
        );
      const reward = getSupplyRequestReward(stack.item.auctionMaxPrice, input.quantity);
      const auctionMaxPrice = stack.item.auctionMaxPrice;
      const field = supplyExperienceField(user.occupation);
      if (
        !Number.isSafeInteger(reward.ryo) ||
        user[field] + reward.experience > 2147483647
      )
        return errorResponse("This submission exceeds the profession reward limit.");
      const updatedAt = getNextUserSnapshotAt(user.updatedAt, now);
      const nextUser = {
        ...user,
        [field]: user[field] + reward.experience,
        supplyRequestAt: now,
      };
      const { trackers, consequences, notifications, questIdsUpdated } = getNewTrackers(
        nextUser,
        getExperienceTrackerTasks({
          reward_medical_experience: 0,
          reward_crafting_experience:
            user.occupation === "CRAFTING" ? reward.experience : 0,
          reward_gathering_experience:
            user.occupation === "GATHERING" ? reward.experience : 0,
          reward_hunting_experience:
            user.occupation === "HUNTER" ? reward.experience : 0,
        }),
      );
      nextUser.questData = filterQuestTrackersForDbPersist(trackers, user, true);
      const result = await handleQuestConsequences(
        ctx.drizzle,
        nextUser,
        consequences,
        notifications,
        {
          readiness,
          alwaysClaimUserState: true,
          partyTrackers: trackers,
          claimUserState: async ({
            userId,
            updatedAt: expectedUpdatedAt,
            set = {},
            where,
            readiness,
          }) => {
            const claim = await submitSupplyRequestAtomically(
              ctx.drizzle,
              { userId, updatedAt: expectedUpdatedAt, occupation },
              stack,
              {
                ...reward,
                quantity: input.quantity,
                auctionMaxPrice,
                claimedAt: now,
                updatedAt,
                questData: nextUser.questData ?? [],
              },
              readiness,
              { set, where },
            );
            return { success: claim.rowsAffected === 2, claimedAt: updatedAt };
          },
        },
      );
      if (!result.claimed)
        return errorResponse(
          "Your supplies or character changed. Refresh the request and try again.",
        );
      return actionReadinessResponse(
        {
          success: true,
          message: [
            `Submitted ${input.quantity}x ${stack.item.name} for ${reward.ryo.toLocaleString()} Ryo and ${reward.experience.toLocaleString()} ${user.occupation.toLowerCase()} EXP.`,
            ...result.notifications,
          ].join("\n"),
          ...getSupplyRequestUserUpdate(
            {
              user: { ...nextUser, questData: trackers },
              updatedUser,
              consequences,
              questIdsUpdated,
              allConsumptions: [{ userItemId: stack.id }],
            },
            reward.ryo,
          ),
          inventoryChanges: getSupplyRequestInventoryUpdate(
            stack,
            input.quantity,
            updatedAt,
            updatedUser,
            consequences,
          ),
        },
        readiness,
        ctx.drizzle,
      );
    }),
};
