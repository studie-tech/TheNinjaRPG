import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { z } from "zod";
import { SpriteGenerationMotions } from "@/drizzle/constants";
import type { SpriteGeneration, spriteGeneration } from "@/drizzle/schema";
import { editedReason, outdateProposalsFor } from "@/libs/contentReview/outdate";
import { animationActions } from "@/libs/spriteAnimationActions";
import { finishSpriteSheet } from "@/libs/spriteSheetFinish";
import { SpriteCharacterStyles } from "@/libs/spriteStudio";
import { fetchUser } from "@/queries/profile";
import {
  fetchAnimationAi,
  insertSpriteAnimation,
  insertSpriteAnimationLog,
  saveSpriteAnimationBinding,
  touchAnimationAi,
} from "@/queries/spriteAnimation";
import {
  findSpriteGeneration,
  insertSpriteGeneration,
  listGenerationsToSync,
  listSpriteGenerations,
  transitionSpriteGeneration,
} from "@/queries/spriteStudio";
import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import {
  cancelSpriteAsset,
  createSpriteAsset,
  downloadSpriteFile,
  GameAssetError,
  type GameAssetSprite,
  gameAssetEnabled,
  generateCharacterImages,
  getGameAssetAccount,
  getSpriteAsset,
  uploadCharacterImage,
} from "@/server/utils/gameAsset";
import { removeFromStorage, uploadToStorage } from "@/server/utils/spriteSheets";
import { canChangeContent } from "@/utils/permissions";
import { spriteAnimationSchema } from "@/validators/spriteAnimation";
import { spriteSourceSchema } from "@/validators/spriteStudio";

const EDITOR_ONLY = "Content editor access required";
/** Longer than preparing a sheet can take, so a live function is never overtaken. */
const PREPARATION_STALE_MS = 3 * 60 * 1000;
/** Art larger than this only slows the upload; the sheet cells are far smaller. */
const MAX_ART_SIDE = 1024;

const generationInput = z.object({ id: z.string().min(1) });

/** Staff sprite generation through gameasset.dev, reviewed before reaching the library. */
export const spriteStudioRouter = createTRPCRouter({
  /** Whether the studio can run, and the balance staff are about to spend. */
  getAccount: protectedProcedure.query(async ({ ctx }) => {
    await requireEditor(ctx.drizzle, ctx.userId);
    if (!gameAssetEnabled()) return { enabled: false as const, account: null };
    const account = await getGameAssetAccount().catch(() => null);
    return { enabled: true as const, account };
  }),
  /** The shared queue: every editor sees and can finish each other's requests. */
  getGenerations: protectedProcedure.query(async ({ ctx }) => {
    const [, generations] = await Promise.all([
      requireEditor(ctx.drizzle, ctx.userId),
      listSpriteGenerations(ctx.drizzle),
    ]);
    return generations;
  }),
  /** What a sprite for this AI needs: its art, facing and the actions it can take. */
  getAiSource: protectedProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [, ai] = await Promise.all([
        requireEditor(ctx.drizzle, ctx.userId),
        fetchAnimationAi(ctx.drizzle, input.userId),
      ]);
      if (!ai) throw new TRPCError({ code: "NOT_FOUND", message: "AI not found" });
      return {
        userId: ai.userId,
        username: ai.username,
        avatar: ai.avatar,
        facing: ai.avatarFacing ?? "left",
        actions: animationActions(ai),
        assignedKeys: ai.spriteAnimationBindings.map((binding) => binding.actionKey),
      };
    }),
  /** Draw four candidates for a character that has no art yet. */
  drawCharacters: protectedProcedure
    .input(
      z.object({
        prompt: z.string().trim().min(3).max(1000),
        style: z.enum(SpriteCharacterStyles),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const editor = await fetchUser(ctx.drizzle, ctx.userId);
      if (editor.isBanned || !canChangeContent(editor.role))
        return errorResponse(EDITOR_ONLY);
      return staffFailure(async () => ({
        success: true as const,
        message: "Choose a character to animate",
        images: await generateCharacterImages(
          `${input.prompt}. Full body, facing left.`,
          [input.style],
          nanoid(),
        ),
      }));
    }),
  /** Queue an animation; credits are held until gameasset.dev finishes or refunds it. */
  generate: protectedProcedure
    .input(
      z.object({
        source: spriteSourceSchema,
        name: z.string().trim().min(1).max(191),
        prompt: z.string().trim().min(3).max(2000),
        motion: z.enum(SpriteGenerationMotions),
        // gameasset.dev accepts 4n+1 clips; these give 8x2 and 8x3 sheets.
        frames: z.union([z.literal(33), z.literal(49)]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { source } = input;
      const [editor, ai] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        source.kind === "ai" ? fetchAnimationAi(ctx.drizzle, source.userId) : undefined,
      ]);
      if (editor.isBanned || !canChangeContent(editor.role))
        return errorResponse(EDITOR_ONLY);
      if (source.kind === "ai") {
        if (!ai?.avatar) return errorResponse("This AI has no art to animate");
        if (!animationActions(ai).some((action) => action.key === source.actionKey))
          return errorResponse("This AI does not have that action");
      }
      const id = nanoid();
      return staffFailure(async () => {
        const sourceUrl = source.kind === "ai" ? (ai?.avatar as string) : source.url;
        const remoteImageId =
          source.kind === "candidate"
            ? source.imageId
            : (await uploadArt(sourceUrl, input.name)).id;
        const facing =
          source.kind === "ai" ? (ai?.avatarFacing ?? "left") : source.facing;
        const asset = await createSpriteAsset(
          { ...input, imageId: remoteImageId, facing },
          id,
        );
        await recordGeneration(ctx.drizzle, {
          ...input,
          id,
          facing,
          sourceUrl,
          remoteImageId,
          remoteAssetId: asset.id,
          aiUserId: ai?.userId,
          actionKey: source.kind === "ai" ? source.actionKey : undefined,
          stage: asset.stage,
          createdByUserId: ctx.userId,
        });
        return { success: true as const, message: "Sprite queued", id };
      });
    }),
  /** Run the same art and motion again; the model picks a new seed. */
  regenerate: protectedProcedure
    .input(generationInput)
    .mutation(async ({ ctx, input }) => {
      const [editor, row] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findSpriteGeneration(ctx.drizzle, input.id),
      ]);
      if (editor.isBanned || !canChangeContent(editor.role))
        return errorResponse(EDITOR_ONLY);
      if (!row) return errorResponse("Sprite request not found");
      const id = nanoid();
      return staffFailure(async () => {
        const asset = await createSpriteAsset(
          {
            imageId: row.remoteImageId,
            prompt: row.prompt,
            motion: row.motion,
            facing: row.facing,
            frames: row.frames,
          },
          id,
        );
        await recordGeneration(ctx.drizzle, {
          id,
          name: row.name,
          prompt: row.prompt,
          motion: row.motion,
          frames: row.frames,
          facing: row.facing,
          sourceUrl: row.sourceUrl,
          remoteImageId: row.remoteImageId,
          remoteAssetId: asset.id,
          aiUserId: row.aiUserId,
          actionKey: row.actionKey,
          stage: asset.stage,
          createdByUserId: ctx.userId,
        });
        return { success: true as const, message: "Sprite queued", id };
      });
    }),
  /**
   * Bring running requests up to date and prepare finished ones. The browser drives this
   * while the studio is open, and work finished in the meantime is collected on return.
   */
  sync: protectedProcedure.mutation(async ({ ctx }) => {
    const editor = await fetchUser(ctx.drizzle, ctx.userId);
    if (editor.isBanned || !canChangeContent(editor.role))
      return errorResponse(EDITOR_ONLY);
    const staleBefore = new Date(Date.now() - PREPARATION_STALE_MS);
    const rows = await listGenerationsToSync(ctx.drizzle, staleBefore);
    const outcomes = await Promise.all(
      rows.map((row) =>
        getSpriteAsset(row.remoteAssetId)
          .then((asset) => applyRemoteState(ctx.drizzle, row, asset))
          // An unreachable API leaves the row as it is for the next sync.
          .catch(() => false),
      ),
    );
    return {
      success: true as const,
      message: "Synced",
      changed: outcomes.filter(Boolean).length,
    };
  }),
  /** Publish a reviewed sheet to the library, and optionally assign it to its AI action. */
  accept: protectedProcedure
    .input(generationInput.extend({ assign: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [editor, row] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findSpriteGeneration(ctx.drizzle, input.id),
      ]);
      if (editor.isBanned || !canChangeContent(editor.role))
        return errorResponse(EDITOR_ONLY);
      if (row?.status !== "READY") return errorResponse("This sprite is not ready");
      const sheet = spriteAnimationSchema.safeParse({
        name: row.name,
        url: row.url,
        columns: row.columns,
        rows: row.rows,
        frameCount: row.frameCount,
        fps: row.fps,
        facing: row.facing,
      });
      if (!sheet.success || !row.smallUrl)
        return errorResponse("This sheet exceeds the playback limits");
      const ai =
        input.assign && row.aiUserId
          ? await fetchAnimationAi(ctx.drizzle, row.aiUserId)
          : undefined;
      if (input.assign && !ai) return errorResponse("AI not found");
      const animationId = nanoid();
      const accepted = await transitionSpriteGeneration(ctx.drizzle, row, {
        status: "ACCEPTED",
        animationId,
        updatedAt: new Date(),
      });
      if (accepted.rowsAffected === 0)
        return errorResponse("Another editor already handled this sprite");
      await Promise.all([
        insertSpriteAnimation(ctx.drizzle, {
          ...sheet.data,
          smallUrl: row.smallUrl,
          id: animationId,
          createdByUserId: row.createdByUserId,
        }),
        insertSpriteAnimationLog(ctx.drizzle, {
          id: nanoid(),
          userId: ctx.userId,
          tableName: "spriteAnimation",
          relatedId: animationId,
          relatedMsg: row.name,
          changes: [`Created sprite animation: ${row.name}`],
        }),
      ]);
      if (ai && row.actionKey) {
        const previous = ai.spriteAnimationBindings.find(
          (binding) => binding.actionKey === row.actionKey,
        );
        await Promise.all([
          saveSpriteAnimationBinding(
            ctx.drizzle,
            ai.userId,
            row.actionKey,
            animationId,
          ),
          touchAnimationAi(ctx.drizzle, ai.userId),
          insertSpriteAnimationLog(ctx.drizzle, {
            id: nanoid(),
            userId: ctx.userId,
            tableName: "ai",
            relatedId: ai.userId,
            relatedMsg: `Animation: ${ai.username}`,
            changes: [
              `${row.actionKey}: ${previous?.animationId ?? "default"} → ${animationId}`,
            ],
          }),
        ]);
        await outdateProposalsFor(
          ctx.drizzle,
          "AI",
          [ai.userId],
          editedReason("AI", ai.username, editor.username),
        );
      }
      return {
        success: true as const,
        message: ai
          ? "Added to the library and assigned; new battles use it"
          : "Added to the animation library",
      };
    }),
  /** Remove a request from the queue, refunding it if it has not finished. */
  discard: protectedProcedure
    .input(generationInput)
    .mutation(async ({ ctx, input }) => {
      const [editor, row] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findSpriteGeneration(ctx.drizzle, input.id),
      ]);
      if (editor.isBanned || !canChangeContent(editor.role))
        return errorResponse(EDITOR_ONLY);
      if (
        !row ||
        row.status === "ACCEPTED" ||
        row.status === "DISCARDED" ||
        row.status === "PREPARING"
      )
        return errorResponse("This sprite can no longer be discarded");
      const isRemote = row.status === "QUEUED" || row.status === "PROCESSING";
      if (isRemote && !(await stopRemoteJob(row.remoteAssetId)))
        return errorResponse("gameasset.dev could not cancel this sprite. Try again.");
      const discarded = await transitionSpriteGeneration(ctx.drizzle, row, {
        status: "DISCARDED",
        updatedAt: new Date(),
      });
      if (discarded.rowsAffected === 0)
        return errorResponse("Another editor already handled this sprite");
      if (row.url && row.smallUrl) await removeFromStorage([row.url, row.smallUrl]);
      return { success: true as const, message: "Sprite discarded" };
    }),
});

/** Queries fail loudly for non-staff; the page shows the message instead of the studio. */
const requireEditor = async (client: DrizzleClient, userId: string) => {
  const editor = await fetchUser(client, userId);
  if (editor.isBanned || !canChangeContent(editor.role))
    throw new TRPCError({ code: "FORBIDDEN", message: EDITOR_ONLY });
};

/** gameasset.dev's refusals, such as an empty balance, are outcomes staff can act on. */
const staffFailure = async <T>(work: () => Promise<T>) => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof GameAssetError) return errorResponse(error.message);
    throw error;
  }
};

/** gameasset.dev needs a PNG; it removes the background itself when the art has one. */
const uploadArt = async (url: string, title: string) => {
  const png = await sharp(await downloadSpriteFile(url))
    .resize(MAX_ART_SIDE, MAX_ART_SIDE, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer()
    .catch(() => {
      throw new GameAssetError("This art could not be read as an image");
    });
  return uploadCharacterImage(png, title.slice(0, 120));
};

/** Save a paid job's request; one that cannot be saved is untrackable, so cancel it. */
const recordGeneration = async (
  client: DrizzleClient,
  values: typeof spriteGeneration.$inferInsert,
) => {
  try {
    await insertSpriteGeneration(client, values);
  } catch (error) {
    await cancelSpriteAsset(values.remoteAssetId).catch(() => undefined);
    throw error;
  }
};

/**
 * Cancel a running job. One that finished in the meantime refuses and stays charged;
 * one that may still be running keeps its row, so its result is not lost.
 */
const stopRemoteJob = async (id: string) => {
  try {
    await cancelSpriteAsset(id);
    return true;
  } catch {
    const asset = await getSpriteAsset(id).catch(() => null);
    return asset?.status === "succeeded" || asset?.status === "failed";
  }
};

/** Apply one remote status; returns whether the row changed. */
const applyRemoteState = async (
  client: DrizzleClient,
  row: SpriteGeneration,
  asset: GameAssetSprite,
) => {
  const updatedAt = new Date();
  if (asset.status === "succeeded") return prepareSheet(client, row, asset);
  if (asset.status === "failed") {
    const failed = await transitionSpriteGeneration(client, row, {
      status: "FAILED",
      error: (asset.error ?? "Generation failed").slice(0, 500),
      stage: null,
      updatedAt,
    });
    return failed.rowsAffected > 0;
  }
  const status = asset.status === "processing" ? "PROCESSING" : "QUEUED";
  if (status === row.status && asset.stage === row.stage) return false;
  const moved = await transitionSpriteGeneration(client, row, {
    status,
    stage: asset.stage,
    updatedAt,
  });
  return moved.rowsAffected > 0;
};

/** Claim a finished asset once, then store the game-ready sheets on our own CDN. */
const prepareSheet = async (
  client: DrizzleClient,
  row: SpriteGeneration,
  asset: GameAssetSprite,
) => {
  const claimedAt = new Date();
  const claim = await transitionSpriteGeneration(client, row, {
    status: "PREPARING",
    stage: "Preparing the sheet for battle",
    updatedAt: claimedAt,
  });
  if (claim.rowsAffected === 0) return false;
  const claimed = { ...row, status: "PREPARING" as const, updatedAt: claimedAt };
  const stored: string[] = [];
  try {
    if (!asset.files || !asset.sprite)
      throw new Error("The finished asset has no sheet");
    const grid = asset.sprite;
    const [sheet, art] = await Promise.all([
      downloadSpriteFile(asset.files.spriteSheet),
      downloadSpriteFile(row.sourceUrl),
    ]);
    const { large, small } = await finishSpriteSheet(sheet, art, grid);
    const url = await uploadToStorage(large, `sprite-sheet-${nanoid()}-256.webp`);
    stored.push(url);
    const smallUrl = await uploadToStorage(small, `sprite-sheet-${nanoid()}-128.webp`);
    stored.push(smallUrl);
    const finished = await transitionSpriteGeneration(client, claimed, {
      status: "READY",
      stage: null,
      url,
      smallUrl,
      columns: grid.columns,
      rows: grid.rows,
      frameCount: grid.frameCount,
      fps: grid.fps,
      updatedAt: new Date(),
    });
    if (finished.rowsAffected === 0) await removeFromStorage(stored);
  } catch (error) {
    const failed = await transitionSpriteGeneration(client, claimed, {
      status: "FAILED",
      stage: null,
      error: (error instanceof Error ? error.message : "Preparation failed").slice(
        0,
        500,
      ),
      updatedAt: new Date(),
    });
    if (failed.rowsAffected > 0 && stored.length > 0) await removeFromStorage(stored);
  }
  return true;
};
