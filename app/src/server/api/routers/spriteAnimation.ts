import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { editedReason, outdateProposalsFor } from "@/libs/contentReview/outdate";
import {
  animationActions,
  summarizeAnimationCoverage,
} from "@/libs/spriteAnimationActions";
import { fetchUser } from "@/queries/profile";
import {
  countSpriteAnimations,
  fetchAnimationAi,
  fetchAnimationAiName,
  findSpriteAnimation,
  insertSpriteAnimation,
  insertSpriteAnimationLog,
  listAiAnimationCoverage,
  saveSpriteAnimationBinding,
  searchSpriteAnimations,
  touchAnimationAi,
} from "@/queries/spriteAnimation";
import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import { offsetPage } from "@/server/utils/pagination";
import { prepareSpriteSheetUrls } from "@/server/utils/spriteSheets";
import { canChangeContent } from "@/utils/permissions";
import {
  aiSpriteAnimationInput,
  assignSpriteAnimationSchema,
  spriteAnimationSchema,
} from "@/validators/spriteAnimation";

/** Staff-managed immutable sheets and reversible AI bindings, used by new battles. */
export const spriteAnimationRouter = createTRPCRouter({
  /** Load the AI's available actions with its bindings and the sheets they point at. */
  getAiConfig: protectedProcedure
    .input(aiSpriteAnimationInput)
    .query(async ({ ctx, input }) => {
      const [editor, ai] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchAnimationAi(ctx.drizzle, input.userId),
      ]);
      if (editor.isBanned || !canChangeContent(editor.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Content editor access required",
        });
      }
      if (!ai) throw new TRPCError({ code: "NOT_FOUND", message: "AI not found" });
      return {
        username: ai.username,
        actions: animationActions(ai),
        assignments: ai.spriteAnimationBindings.map(({ actionKey, animationId }) => ({
          actionKey,
          animationId,
        })),
        animations: ai.spriteAnimationBindings.flatMap(({ animation }) =>
          animation ? [animation] : [],
        ),
      };
    }),
  /** Sprite sheet coverage of every AI's actions, for the AI completeness overview. */
  getAiCoverage: protectedProcedure.query(async ({ ctx }) => {
    const [editor, ais] = await Promise.all([
      fetchUser(ctx.drizzle, ctx.userId),
      listAiAnimationCoverage(ctx.drizzle),
    ]);
    if (editor.isBanned || !canChangeContent(editor.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Content editor access required",
      });
    }
    return ais.map((ai) => ({
      userId: ai.userId,
      username: ai.username,
      ...summarizeAnimationCoverage(
        ai,
        ai.spriteAnimationBindings.map((binding) => binding.actionKey),
      ),
    }));
  }),
  /** Page through the library, either one AI's sheets or everything. */
  search: protectedProcedure
    .input(
      aiSpriteAnimationInput.extend({
        scope: z.enum(["ai", "all"]),
        search: z.string().trim().max(100),
        limit: z.number().int().min(1).max(60),
        cursor: z.number().int().min(0).nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [editor, ai] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        input.scope === "ai"
          ? fetchAnimationAiName(ctx.drizzle, input.userId)
          : undefined,
      ]);
      if (editor.isBanned || !canChangeContent(editor.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Content editor access required",
        });
      }
      if (input.scope === "ai" && !ai)
        throw new TRPCError({ code: "NOT_FOUND", message: "AI not found" });
      const filter = { ai, tokens: input.search.split(/\s+/).filter(Boolean) };
      const { skip, cursorAfter } = offsetPage(input);
      const [data, [counted]] = await Promise.all([
        searchSpriteAnimations(ctx.drizzle, {
          ...filter,
          limit: input.limit,
          offset: skip,
        }),
        countSpriteAnimations(ctx.drizzle, filter),
      ]);
      const total = counted?.total ?? 0;
      const hasMore = skip + data.length < total;
      return { data, nextCursor: hasMore ? cursorAfter(data) : null, total };
    }),
  /** Create a shared library entry without assigning it to an AI. */
  create: protectedProcedure
    .input(spriteAnimationSchema)
    .mutation(async ({ ctx, input }) => {
      const editor = await fetchUser(ctx.drizzle, ctx.userId);
      if (editor.isBanned || !canChangeContent(editor.role))
        return errorResponse("Content editor access required");
      const sheet = await prepareSpriteSheetUrls(input);
      if (!sheet.success) return errorResponse(sheet.message);
      const id = nanoid();
      const animation = { ...input, url: sheet.url, smallUrl: sheet.smallUrl, id };
      await Promise.all([
        insertSpriteAnimation(ctx.drizzle, {
          ...animation,
          createdByUserId: ctx.userId,
        }),
        insertSpriteAnimationLog(ctx.drizzle, {
          id: nanoid(),
          userId: ctx.userId,
          tableName: "spriteAnimation",
          relatedId: id,
          relatedMsg: input.name,
          changes: [`Created sprite animation: ${input.name}`],
        }),
      ]);
      return { success: true, message: "Sprite animation created", animation };
    }),
  /** Save or clear one action override, then invalidate suggestions based on old bindings. */
  assign: protectedProcedure
    .input(assignSpriteAnimationSchema)
    .mutation(async ({ ctx, input }) => {
      const [editor, ai, animation] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchAnimationAi(ctx.drizzle, input.userId),
        input.animationId
          ? findSpriteAnimation(ctx.drizzle, input.animationId)
          : undefined,
      ]);
      if (editor.isBanned || !canChangeContent(editor.role))
        return errorResponse("Content editor access required");
      if (!ai) return errorResponse("AI not found");
      if (!animationActions(ai).some((action) => action.key === input.actionKey))
        return errorResponse("This AI does not have that action");
      if (input.animationId && !animation)
        return errorResponse("Sprite animation not found");
      if (animation && !spriteAnimationSchema.safeParse(animation).success)
        return errorResponse(
          "This sheet exceeds the playback limits. Add a compact animation before assigning it.",
        );
      // The binding changes in one atomic statement; concurrent staff edits are
      // last-write-wins and can be reapplied. Review versions hash the bindings,
      // so timestamp/audit writes need no cross-row transaction or locking read.
      await Promise.all([
        saveSpriteAnimationBinding(
          ctx.drizzle,
          ai.userId,
          input.actionKey,
          input.animationId,
        ),
        touchAnimationAi(ctx.drizzle, ai.userId),
        insertSpriteAnimationLog(ctx.drizzle, {
          id: nanoid(),
          userId: ctx.userId,
          tableName: "ai",
          relatedId: ai.userId,
          relatedMsg: `Animation: ${ai.username}`,
          changes: [
            `${input.actionKey}: ${ai.spriteAnimationBindings.find((binding) => binding.actionKey === input.actionKey)?.animationId ?? "default"} → ${input.animationId ?? "default"}`,
          ],
        }),
      ]);
      await outdateProposalsFor(
        ctx.drizzle,
        "AI",
        [ai.userId],
        editedReason("AI", ai.username, editor.username),
      );
      return {
        success: true,
        message: "Animation assignment saved; new battles use the updated selection",
      };
    }),
});
