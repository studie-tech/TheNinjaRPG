import { z } from "zod";
import type { AvatarFacing, SpriteGenerationMotion } from "@/drizzle/constants";
import { env } from "@/env/server.mjs";
import { isBunnyCdnUrl, transformImageUrl } from "@/utils/image";

const API_URL = "https://gameasset.dev/api/v1";
const REQUEST_TIMEOUT_MS = 20_000;
/** Generating four candidates waits on the image model inside the request. */
const IMAGE_TIMEOUT_MS = 55_000;
const MAX_SHEET_BYTES = 16 * 1024 * 1024;
/** Finished files live on gameasset.dev's UploadThing app; refuse anything else. */
const FILE_HOST = /^(?:[a-z0-9]+\.ufs\.sh|utfs\.io)$/;

const accountSchema = z.object({
  plan: z.string(),
  credits: z.number(),
  freeAssets: z.number(),
  previewCost: z.number(),
});
const imageSchema = z.object({ id: z.string(), url: z.string() });
const assetSchema = z.object({
  id: z.string(),
  status: z.enum(["queued", "processing", "succeeded", "failed"]),
  stage: z.string().nullable(),
  error: z.string().nullable(),
  credits: z.object({ paid: z.number() }),
  files: z.object({ spriteSheet: z.string() }).nullable(),
  sprite: z
    .object({
      columns: z.number(),
      rows: z.number(),
      frameCount: z.number(),
      fps: z.number(),
    })
    .nullable(),
});

/** A failure whose message is fit to show staff. */
export class GameAssetError extends Error {}

/** The key is server-only, so an absent one disables the studio rather than the build. */
export const gameAssetEnabled = () => !!env.GAMEASSET_API_KEY;

/** Every call shares authentication and turns the API's error shape into one message. */
const request = async <T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
  timeout = REQUEST_TIMEOUT_MS,
) => {
  if (!env.GAMEASSET_API_KEY)
    throw new GameAssetError("gameasset.dev is not configured");
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${env.GAMEASSET_API_KEY}` },
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
  }).catch(() => null);
  if (!response) throw new GameAssetError("gameasset.dev could not be reached");
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = z
      .object({ error: z.object({ message: z.string() }) })
      .safeParse(body);
    throw new GameAssetError(
      failure.success
        ? failure.data.error.message
        : "gameasset.dev refused the request",
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new GameAssetError("gameasset.dev sent an unexpected reply");
  return parsed.data;
};

const postJson = (body: unknown, idempotencyKey: string): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
  headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
});

/** Balance staff see before spending. */
export const getGameAssetAccount = () => request("/account", accountSchema);

/** Four candidate characters from a description, billed per image. */
export const generateCharacterImages = async (
  prompt: string,
  styles: string[],
  idempotencyKey: string,
) => {
  const result = await request(
    "/images",
    z.object({ images: z.array(imageSchema) }),
    postJson({ prompt, type: "2d", styles }, idempotencyKey),
    IMAGE_TIMEOUT_MS,
  );
  return result.images;
};

/** Store our own art as a project image; gameasset.dev does not charge for this. */
export const uploadCharacterImage = (png: Buffer, title: string) =>
  request(`/images/upload?${new URLSearchParams({ type: "2d", title })}`, imageSchema, {
    method: "POST",
    body: new Uint8Array(png),
    headers: { "Content-Type": "image/png" },
  });

/** Queue an animation. Retrying with the same key cannot charge twice. */
export const createSpriteAsset = (
  input: {
    imageId: string;
    prompt: string;
    motion: SpriteGenerationMotion;
    facing: AvatarFacing;
    frames: number;
  },
  idempotencyKey: string,
) =>
  request(
    "/assets",
    assetSchema,
    postJson(
      {
        type: "2d",
        imageId: input.imageId,
        motion: {
          prompt: input.prompt,
          action: input.motion,
          facing: input.facing,
          frames: input.frames,
        },
      },
      idempotencyKey,
    ),
  );

export const getSpriteAsset = (id: string) =>
  request(`/assets/${encodeURIComponent(id)}`, assetSchema);

/** Stop an unfinished asset, which returns its credits. */
export const cancelSpriteAsset = (id: string) =>
  request(`/assets/${encodeURIComponent(id)}/cancel`, assetSchema, { method: "POST" });

/** Fetch from our CDN or gameasset.dev's storage, never a host a client supplied. */
export const downloadSpriteFile = async (source: string) => {
  const url = transformImageUrl(source);
  const host = URL.canParse(url) ? new URL(url).hostname : "";
  if (!isBunnyCdnUrl(url) && !FILE_HOST.test(host))
    throw new GameAssetError("Use art hosted on the game's CDN");
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  if (!response?.ok) throw new GameAssetError("The image could not be downloaded");
  const file = Buffer.from(await response.arrayBuffer());
  if (file.length > MAX_SHEET_BYTES) throw new GameAssetError("The image is too large");
  return file;
};

export type GameAssetSprite = z.infer<typeof assetSchema>;
