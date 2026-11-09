import { nanoid } from "nanoid";
import OpenAI, { toFile } from "openai";
import type { FileOutput } from "replicate";
import Replicate from "replicate";
import sharp from "sharp";
import { UTApi, UTFile } from "uploadthing/server";
import type { IMG_ORIENTATION } from "@/drizzle/constants";
import type { UserData, UserRank } from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import { servedUfsUrl } from "@/libs/uploadthing";
import { fetchAttributes } from "@/queries/profile";
import type { DrizzleClient } from "@/server/db";
import type { GenerateAudioInput } from "@/validators/audio";

// Singleton Replicate instance to avoid connection pool exhaustion
let replicateInstance: Replicate | null = null;
const getReplicateInstance = () => {
  if (!replicateInstance) {
    replicateInstance = new Replicate({ auth: env.REPLICATE_API_TOKEN });
  }
  return replicateInstance;
};

/**
 * Get the prompt for the avatar
 * @param client The database client
 * @param user The user to get the prompt for
 * @returns The prompt for the avatar
 */
export const getAvatarPrompt = async (client: DrizzleClient, user: UserData) => {
  const userAttributes = await fetchAttributes(client, user.userId);
  const attributes = userAttributes
    .sort((a) => (a.attribute.includes("skin") ? -1 : 1))
    .map((attribute) => attribute.attribute)
    .join(", ");

  return `${getPhenotype(user.rank, user.gender)}, ${attributes}, fully clothed, wearing clothes, dressed, anime, rossdraws portrait, stanley artgerm lau, wlop, looking into camera, interesting background, sfw`;
};

/** Avatar subject by rank as [male, female, other]; unlisted ranks use the eldest look. */
const PHENOTYPES: Partial<Record<UserRank, [string, string, string]>> = {
  STUDENT: ["teenage boy", "teenage girl", "teenage"],
  GENIN: ["teenage boy", "teenage girl", "teenager"],
  CHUNIN: ["man", "woman", "person"],
  JONIN: ["man", "woman", "person"],
  "ELITE JONIN": ["old man", "old woman", "old person"],
};
const ELDEST_PHENOTYPE: [string, string, string] = [
  "old man wrinkles",
  "old woman wrinkles",
  "old person wrinkles",
];

/** Select rank- and gender-appropriate avatar prompt wording, using the eldest fallback for unknown ranks. */
const getPhenotype = (rank: UserRank, gender: string) => {
  const [male, female, other] = PHENOTYPES[rank] ?? ELDEST_PHENOTYPE;
  return gender === "Male" ? male : gender === "Female" ? female : other;
};

/**
 * Create a fast image from text using Replicate
 * Uses server-to-server transfer - UploadThing fetches directly from Replicate URL
 * Attempts flux-schnell first, falls back to prunaai/p-image on failure
 * Cancellation covers generation and upload, and must not start a fallback prediction.
 * @param config - Prompt, model options and optional caller deadline
 * @returns UploadThing's upload result; the caller owns review and publication
 */
export const fastTxt2imgReplicate = async (config: {
  prompt: string;
  aspect_ratio?: "1:1" | "16:9" | "9:16";
  disable_safety_checker?: boolean;
  output_quality?: number;
  mega_pixels?: "0.25" | "1";
  signal?: AbortSignal;
}) => {
  const {
    prompt,
    aspect_ratio = "1:1",
    disable_safety_checker = false,
    output_quality = 50,
    mega_pixels = "0.25",
    signal,
  } = config;
  const replicate = getReplicateInstance();

  // Try flux-schnell first
  let output: FileOutput | undefined;
  try {
    const fluxInput = {
      prompt: prompt,
      go_fast: true,
      megapixels: mega_pixels,
      num_outputs: 1,
      aspect_ratio: aspect_ratio,
      output_format: "webp",
      output_quality: output_quality,
      num_inference_steps: 4,
      disable_safety_checker: disable_safety_checker,
    };
    const outputs = (await runAbortable(
      () =>
        replicate.run("black-forest-labs/flux-schnell", {
          input: fluxInput,
          ...(signal ? { signal } : {}),
        }),
      signal,
    )) as FileOutput[];
    output = outputs?.[0];
  } catch (fluxError) {
    signal?.throwIfAborted();
    if (
      fluxError instanceof Error &&
      ["AbortError", "TimeoutError"].includes(fluxError.name)
    )
      throw fluxError;
    console.warn("flux-schnell failed, falling back to prunaai/p-image:", fluxError);
  }

  // Fallback to prunaai/p-image if flux-schnell failed or returned no output
  if (!output) {
    signal?.throwIfAborted();
    const pImageInput = {
      prompt: prompt,
      aspect_ratio: aspect_ratio,
      disable_safety_checker: disable_safety_checker,
    };
    output = (await runAbortable(
      () =>
        replicate.run("prunaai/p-image", {
          input: pImageInput,
          ...(signal ? { signal } : {}),
        }),
      signal,
    )) as FileOutput;
  }

  if (!output) throw new Error("No output from AI model");

  // Use URL-based upload - UploadThing fetches directly from Replicate
  const replicateUrl = output.url();
  const utapi = new UTApi();
  const name = `preview-${nanoid()}.webp`;
  const uploadedFile = await runAbortable(
    () =>
      utapi.uploadFilesFromUrl(
        {
          url: replicateUrl,
          name,
          customId: name,
        },
        signal ? { signal } : undefined,
      ),
    signal,
  );
  return uploadedFile;
};

type BackgroundRemovalModel = "lucataco" | "851-labs";

type Txt2ImgConfig = {
  preprompt: string;
  prompt: string;
  previousImg?: string | null;
  removeBg: boolean;
  /** Nano Banana sprites can opt into hard segmentation; other artwork keeps its existing cutout. */
  backgroundRemovalModel?: BackgroundRemovalModel;
  userId: string;
  width: number;
  height: number;
  size: IMG_ORIENTATION;
  /** Optional deadline for Replicate generation, cutout processing and delivery upload. */
  signal?: AbortSignal;
};

/**
 * Create an image from text using OpenAI
 * @param config The configuration for the image generation
 * @returns The URLs of the uploaded images
 */
export const txt2imgGPT = async (config: Txt2ImgConfig) => {
  const client = new OpenAI();

  // Prepare the input image
  const inputImage = config.previousImg
    ? await fetch(config.previousImg).then(async (response) => {
        const blob = await response.blob();
        return new File([blob], `${config.userId}-${nanoid()}.webp`, {
          type: "image/webp",
        });
      })
    : null;

  // Common config
  const commonConfig = {
    background: config.removeBg ? "transparent" : "auto",
    model: "gpt-image-2.5-flare",
    output_format: "png",
    size:
      config.size === "square"
        ? "1024x1024"
        : config.size === "portrait"
          ? "1024x1536"
          : "1536x1024",
    quality: "high",
    n: 1,
    user: config.userId,
    prompt: inputImage
      ? config.prompt
      : `
      <system prompt>
        ${config.preprompt}
      </system prompt>
      <user prompt>
        ${config.prompt} ${config.removeBg ? "remove background" : "include appropriate background"}
      </user prompt>
    `,
  } as const;

  // Create/Edit the image
  const image = inputImage
    ? await client.images.edit({ image: inputImage, ...commonConfig })
    : await client.images.generate(commonConfig);

  // Upload the image to UploadThing
  const uploadedFiles = await uploadImageFromOpenAI({
    prefix: "content",
    img: image,
    idx: nanoid(),
    width: config.width,
    height: config.height,
  });

  // Return the URLs of the images
  return uploadedFiles
    .map((file) => (file.data ? servedUfsUrl(file.data) : null))
    .filter(Boolean) as string[];
};

/**
 * Create an image from text using Google's Nano Banana via Replicate
 * Mirrors txt2imgGPT flow and returns uploaded URL(s)
 * The optional signal bounds generation, background removal, download and upload.
 */
export const txt2imgNanoBanana = async (config: Txt2ImgConfig) => {
  const image = await generateNanoBananaImage(config);
  // Resize to requested bounds (match OpenAI flow)
  const resultBuffer = await sharp(image)
    .resize({ width: config.width, height: config.height, fit: "inside" })
    .webp({ quality: 70 })
    .toBuffer();

  const resizedBlob = new Blob([resultBuffer as BlobPart]);
  const uploaded = await uploadFileFromReplicate(
    "content",
    resizedBlob,
    "webp",
    config.signal,
  );
  const url = uploaded.data ? servedUfsUrl(uploaded.data) : null;
  return url ? [url] : [];
};

/**
 * Generate (and optionally cut out) a Nano Banana image and return its full-size bytes
 * without uploading, so callers can post-process before storing anything.
 * The optional signal bounds generation, background removal and download.
 */
export const generateNanoBananaImage = async (
  config: Omit<Txt2ImgConfig, "width" | "height">,
) => {
  const replicate = getReplicateInstance();

  // nano-banana (Gemini Flash Image) is an image model with no system-prompt
  // concept. Feeding it the long, role-style preprompt ("You are an assistant…")
  // makes Gemini answer in text and emit no image, which Replicate surfaces as
  // "Failed to generate image". For text-to-image, build a single description-led
  // prompt — subject first, style guidance as trailing context — with no
  // <system>/<user> scaffolding. The edit path (previousImg) already works with
  // the bare user prompt plus an input image, so leave it untouched.
  const backgroundInstruction = config.removeBg
    ? "Isolate the subject on a plain, solid background with no scenery."
    : "Include an appropriate full background.";
  const styleGuidance = config.preprompt.trim();
  const composedPrompt = [
    `Generate a single image. ${config.prompt}.`,
    backgroundInstruction,
    styleGuidance ? `Art style guidance:\n${styleGuidance}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // nano-banana defaults aspect_ratio to "match_input_image"; with no input image
  // it warns and falls back to 1:1. Set it explicitly from the requested
  // orientation for text-to-image, and let the edit path keep the default so the
  // result matches the source image.
  const aspectRatio =
    config.size === "square" ? "1:1" : config.size === "portrait" ? "2:3" : "3:2";

  const promptToSend = config.previousImg ? config.prompt : composedPrompt;
  const inputs: Record<string, unknown> = { prompt: promptToSend };
  if (config.previousImg) {
    inputs.image_input = [config.previousImg];
  } else {
    inputs.aspect_ratio = aspectRatio;
  }

  // Get the file from the replicate run. nano-banana's wrapper collapses every
  // Gemini failure to the opaque "Failed to generate image" prediction error, so
  // log the full context (exact prompt, aspect ratio, error message + stack)
  // server-side before re-throwing — otherwise it surfaces only as "[object Error]"
  // in the client tRPC logger and is impossible to diagnose.
  let file: FileOutput;
  try {
    file = (await runAbortable(
      () =>
        replicate.run("google/nano-banana", {
          input: inputs,
          ...(config.signal ? { signal: config.signal } : {}),
        }),
      config.signal,
    )) as FileOutput;
  } catch (cause) {
    console.error("[txt2imgNanoBanana] Replicate generation failed", {
      model: "google/nano-banana",
      hasImageInput: Boolean(config.previousImg),
      aspectRatio: inputs.aspect_ratio ?? null,
      promptLength: promptToSend.length,
      prompt: promptToSend,
      error:
        cause instanceof Error ? { message: cause.message, stack: cause.stack } : cause,
    });
    throw cause;
  }
  if (!file) throw new Error("No output from AI model");

  // If transparent background requested, post-process with remove-bg
  if (config.removeBg) {
    file = await removeBackgroundReplicate(
      String(file.url()),
      config.signal,
      config.backgroundRemovalModel,
    );
  }

  const blob = await runAbortable(() => file.blob(), config.signal);
  return Buffer.from(await blob.arrayBuffer());
};

/** GPT Image rejects 512px requests, so sprites are drawn at its smallest square size. */
const GPT_SPRITE_SIZE = "1024x1024";

/**
 * Draw a transparent-background sprite with GPT Image and return its PNG bytes without
 * uploading. A reference image turns the request into an edit of that animal; without one
 * the prompt alone draws a new sprite. The signal bounds the provider request.
 */
export const generateSpriteGPT = async (config: {
  prompt: string;
  reference?: Buffer;
  userId: string;
  signal?: AbortSignal;
}) => {
  const client = new OpenAI();
  const common = {
    model: "gpt-image-2.5-flare",
    prompt: config.prompt,
    size: GPT_SPRITE_SIZE,
    quality: "medium",
    background: "transparent",
    output_format: "png",
    n: 1,
    user: config.userId,
  } as const;
  const options = config.signal ? { signal: config.signal } : undefined;
  let response: OpenAI.Images.ImagesResponse;
  try {
    response = config.reference
      ? await client.images.edit(
          {
            ...common,
            image: await toFile(config.reference, "reference.png", {
              type: "image/png",
            }),
          },
          options,
        )
      : await client.images.generate(common, options);
  } catch (cause) {
    console.error("[generateSpriteGPT] OpenAI image generation failed", {
      model: common.model,
      hasImageInput: Boolean(config.reference),
      promptLength: config.prompt.length,
      prompt: config.prompt,
      error:
        cause instanceof Error ? { message: cause.message, stack: cause.stack } : cause,
    });
    throw cause;
  }
  const encoded = response.data?.[0]?.b64_json;
  if (!encoded) throw new Error("No output from AI model");
  return Buffer.from(encoded, "base64");
};

/**
 * Remove the background, retaining the standard model unless crisp sprite edges are requested.
 * Accepts a URL or image bytes (the SDK uploads bytes as a Replicate file input).
 * The caller's signal also bounds waiting on the provider's polling/network work.
 */
export const removeBackgroundReplicate = async (
  image: string | Buffer,
  signal?: AbortSignal,
  model: BackgroundRemovalModel = "lucataco",
) => {
  const replicate = getReplicateInstance();
  const output = (await runAbortable(
    () =>
      replicate.run(
        model === "851-labs"
          ? "851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc"
          : "lucataco/remove-bg:95fcc2a26d3899cd6c2691c900465aaeff466285a65c14638cc5f36f34befaf1",
        {
          input: {
            image,
            ...(model === "851-labs"
              ? { threshold: 0.5, background_type: "rgba", format: "png" }
              : {}),
          },
          ...(signal ? { signal } : {}),
        },
      ),
    signal,
  )) as FileOutput | FileOutput[];
  const file = Array.isArray(output) ? output[0] : output;
  if (!file) throw new Error("No output from remove-bg model");
  return file;
};
/** Cut out image bytes with the crisp 851-labs model and return the PNG result's bytes. */
export const removeBackgroundToBuffer = async (image: Buffer, signal?: AbortSignal) => {
  const file = await removeBackgroundReplicate(image, signal, "851-labs");
  const blob = await runAbortable(() => file.blob(), signal);
  return Buffer.from(await blob.arrayBuffer());
};

/**
 * Resize each image in an OpenAI images response to fit width × height, encode it as
 * WebP and upload it to UploadThing as `<prefix>-<idx>-<i>.webp`.
 * @param config.prefix - Asset namespace included in the filename
 * @param config.img - The OpenAI images response (b64_json data)
 * @param config.idx - Identifier shared by this response's files
 * @param config.width - Maximum width of the stored images
 * @param config.height - Maximum height of the stored images
 * @returns The uploaded files
 */
export const uploadImageFromOpenAI = async (config: {
  prefix: string;
  img: OpenAI.Images.ImagesResponse;
  idx: string;
  width: number;
  height: number;
}) => {
  const { prefix, img, idx, width, height } = config;
  if (!img.data) throw new Error("No data");
  const utapi = new UTApi();
  const resizedImages = await Promise.all(
    img.data.map(async (data, i) => {
      if (!data.b64_json) throw new Error("No b64_json data");
      const blob = Buffer.from(data.b64_json, "base64");
      const resultBuffer = await sharp(blob)
        .resize({ width, height, fit: "inside" })
        .webp({ quality: 70 })
        .toBuffer();
      const fileName = `${prefix}-${idx}-${i}.webp`;
      return new UTFile([resultBuffer as BlobPart], fileName, { customId: fileName });
    }),
  );
  const uploadedFiles = await utapi.uploadFiles(resizedImages);
  return uploadedFiles;
};

/**
 * Creates a 64px PNG thumbnail; contained sprites retain their complete silhouette and pixel sampling.
 */
export const createThumbnail = async (
  url?: string | null,
  fit: "cover" | "contain" = "cover",
) => {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const blob = await res.arrayBuffer();
    const resultBuffer = await sharp(blob)
      .resize(64, 64, {
        fit,
        background: "#00000000",
        ...(fit === "contain" ? { kernel: "nearest" as const } : {}),
      })
      .png()
      .toBuffer();
    const thumbName = `thumbnail-${nanoid()}.png`;
    const thumbnail = new UTFile([resultBuffer as BlobPart], thumbName, {
      customId: thumbName,
      type: "image/png",
    });
    const utapi = new UTApi();
    const response = await utapi.uploadFiles(thumbnail);
    const imageUrl = response.data ? servedUfsUrl(response.data) : null;
    return imageUrl ?? url;
  } catch (_error) {
    return url;
  }
};

/**
 * Upload generated bytes under a unique custom ID used by owned-upload cleanup.
 * @param prefix - Asset namespace included in the custom filename
 * @param blob - Already generated image data
 * @param extension - File extension matching the encoded bytes
 * @param signal - Optional deadline covering the upload
 * @returns UploadThing's upload result
 */
export const uploadFileFromReplicate = async (
  prefix: string,
  blob: Blob,
  extension = "webp",
  signal?: AbortSignal,
) => {
  const utapi = new UTApi();
  const fileName = `${prefix}-${nanoid()}.${extension}`;
  const utFiles = new UTFile([blob], fileName, { customId: fileName });
  const uploadedFile = await runAbortable(
    () => utapi.uploadFiles(utFiles, signal ? { signal } : undefined),
    signal,
  );
  return uploadedFile;
};

/** The SDK cancels predictions between polls; stop waiting when a network request stalls. */
const runAbortable = <T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return run();
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return run();
      })
      .then(
        (value) => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
  });
};

/**
 * Generate an audio clip using Replicate and return the URL
 */
export const generateSoundEffectReplicate = async (config: {
  prompt: string;
  negativePrompt?: string;
  secondsTotal: number;
}) => {
  const replicate = getReplicateInstance();
  const output = (await replicate.run(
    "sepal/audiogen:154b3e5141493cb1b8cec976d9aa90f2b691137e39ad906d2421b74c2a8c52b8",
    {
      input: {
        prompt: config.prompt,
        negative_prompt: config.negativePrompt,
        duration: config.secondsTotal,
        format: "mp3",
      },
    },
  )) as FileOutput;
  const url = output.url();
  if (!url) throw new Error("No output from audio model");
  return { url } as const;
};

/**
 * Generate and upload audio clip to UploadThing; returns URL
 * Uses server-to-server transfer - UploadThing fetches directly from Replicate
 */
export const generateAndUploadAudio = async (config: GenerateAudioInput) => {
  const { url } = await generateSoundEffectReplicate(config);
  const utapi = new UTApi();
  const name = `audio-${nanoid()}.mp3`;
  const uploadedFile = await utapi.uploadFilesFromUrl({ url, name, customId: name });
  return uploadedFile.data ? servedUfsUrl(uploadedFile.data) : null;
};

/**
 * Configuration for video generation using Veo 3.1 Fast
 */
type Txt2VideoConfig = {
  prompt: string;
  negative_prompt?: string;
  seed?: number;
  start_image?: string;
  last_image?: string;
};

/**
 * Start a video generation job using Google's Veo 3.1 Fast model on Replicate
 * This returns immediately with a prediction ID for status polling
 * @param config - The configuration for video generation
 * @returns The prediction object with ID for status tracking
 */
export const startVideoGeneration = async (config: Txt2VideoConfig) => {
  const replicate = getReplicateInstance();

  const input: Record<string, unknown> = {
    prompt: config.prompt,
    aspect_ratio: "9:16",
    duration: 8,
    resolution: "720p",
    generate_audio: true,
  };

  if (config.negative_prompt) {
    input.negative_prompt = config.negative_prompt;
  }

  if (config.seed !== undefined) {
    input.seed = config.seed;
  }

  if (config.start_image) {
    input.image = config.start_image;
  }

  if (config.last_image) {
    input.last_frame = config.last_image;
  }

  // Start prediction without waiting for completion
  const prediction = await replicate.predictions.create({
    model: "google/veo-3.1-fast",
    input,
  });

  return prediction;
};

// In-memory cache for video generation status to avoid excessive API calls
const videoStatusCache = new Map<
  string,
  {
    prediction: Awaited<ReturnType<Replicate["predictions"]["get"]>>;
    timestamp: number;
  }
>();
const CACHE_TTL_MS = 3000; // Cache for 3 seconds
const API_TIMEOUT_MS = 10000; // 10 second timeout for API calls

// Helper to add timeout to a promise
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms),
    ),
  ]);
};

/**
 * Check the status of a video generation prediction
 * Uses a singleton instance and caching to prevent blocking
 * @param predictionId - The Replicate prediction ID
 * @returns The prediction status and output if completed
 */
export const getVideoGenerationStatus = async (predictionId: string) => {
  const now = Date.now();
  const cached = videoStatusCache.get(predictionId);

  // Return cached result if still valid
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.prediction;
  }

  // Use singleton instance with timeout
  const replicate = getReplicateInstance();

  try {
    const prediction = await withTimeout(
      replicate.predictions.get(predictionId),
      API_TIMEOUT_MS,
    );

    // Cache the result
    videoStatusCache.set(predictionId, { prediction, timestamp: now });

    // Clean up old cache entries periodically
    if (videoStatusCache.size > 100) {
      const keysToDelete: string[] = [];
      for (const [key, value] of videoStatusCache) {
        if (now - value.timestamp > CACHE_TTL_MS * 10) {
          keysToDelete.push(key);
        }
      }
      for (const key of keysToDelete) {
        videoStatusCache.delete(key);
      }
    }

    return prediction;
  } catch (error) {
    // If we have a stale cache, return it on timeout/error
    if (cached) {
      console.warn(
        `Replicate API timeout/error, returning cached status for ${predictionId}`,
      );
      return cached.prediction;
    }
    throw error;
  }
};

/**
 * Upload a completed video from Replicate using server-to-server transfer
 * UploadThing fetches directly from the URL - no download to our server needed
 * @param outputUrl - The URL of the video from Replicate
 * @returns The uploaded video URL from UploadThing
 */
export const uploadCompletedVideo = async (outputUrl: string) => {
  const utapi = new UTApi();
  const name = `video-${nanoid()}.mp4`;
  console.log("Uploading video to UploadThing", outputUrl, name);
  const uploadedFile = await utapi.uploadFilesFromUrl({
    url: outputUrl,
    name,
    customId: name,
  });
  console.log("Uploaded video to UploadThing", uploadedFile.data?.ufsUrl);
  return uploadedFile.data ? servedUfsUrl(uploadedFile.data) : null;
};
