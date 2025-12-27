import OpenAI from "openai";
import { fetchAttributes } from "../server/api/routers/profile";
import sharp from "sharp";
import { UTApi, UTFile } from "uploadthing/server";
import { env } from "@/env/server.mjs";
import { tmpdir } from "os";
import path from "path";
import Replicate from "replicate";
import type { DrizzleClient } from "@/server/db";
import type { UserData, UserRank } from "@/drizzle/schema";
import { nanoid } from "nanoid";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  resample,
  prune,
  dedup,
  textureCompress,
  weld,
  meshopt,
} from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import fs from "fs";
import type { FileOutput } from "replicate";
import type { IMG_ORIENTATION } from "@/drizzle/constants";
import type { GenerateAudioInput } from "@/validators/audio";

/**
 * Compress a gltf file
 * @param url The URL of the gltf file to compress
 * @returns The compressed gltf file
 */
export const compressGltf = async (url: string) => {
  await MeshoptEncoder.ready;

  // 3. Initialize NodeIO (network not needed since binary embedded)
  const io = new NodeIO(fetch)
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder })
    .setAllowNetwork(true);

  // 4. Read, transform with explicit modules, and write
  const document = await io.read(url);
  await document.transform(
    weld(),
    resample(),
    prune(),
    dedup(),
    meshopt({ encoder: MeshoptEncoder, level: "high" }),
    textureCompress({
      encoder: sharp,
      quality: 80,
      targetFormat: "webp",
      resize: [256, 256],
    }),
    // Custom transform: backface culling…
  );
  const localPath = path.join(tmpdir(), `${nanoid()}-compressed.glb`);
  await io.write(localPath, document);
  return { localPath };
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

  const getPhenotype = (rank: UserRank, gender: string) => {
    switch (rank) {
      case "STUDENT":
        switch (gender) {
          case "Male":
            return "teenage boy";
          case "Female":
            return "teenage girl";
          default:
            return "teenage";
        }
      case "GENIN":
        switch (gender) {
          case "Male":
            return "teenage boy";
          case "Female":
            return "teenage girl";
          default:
            return "teenager";
        }
      case "CHUNIN":
        switch (gender) {
          case "Male":
            return "man";
          case "Female":
            return "woman";
          default:
            return "person";
        }
      case "JONIN":
        switch (gender) {
          case "Male":
            return "man";
          case "Female":
            return "woman";
          default:
            return "person";
        }
      case "ELITE JONIN":
        switch (gender) {
          case "Male":
            return "old man";
          case "Female":
            return "old woman";
          default:
            return "old person";
        }
      default:
        switch (gender) {
          case "Male":
            return "old man wrinkles";
          case "Female":
            return "old woman wrinkles";
          default:
            return "old person wrinkles";
        }
    }
  };
  return `${getPhenotype(
    user.rank,
    user.gender,
  )}, ${attributes}, fully clothed, wearing clothes, dressed, anime, rossdraws portrait, stanley artgerm lau, wlop, looking into camera, interesting background, sfw`;
};

/**
 * Upload file from URL to uploadthing
 */
export const uploadToUT = async (url: string) => {
  const utapi = new UTApi();
  const extension = path.extname(url).replace(/^\./, "") || "bin";
  const name = `${nanoid()}.${extension}`;
  if (!url.startsWith("http")) {
    const fileBuffer = await fs.promises.readFile(url);
    const uploadedFile = await utapi.uploadFiles(
      new UTFile([fileBuffer as BlobPart], name),
    );
    return uploadedFile.data?.ufsUrl ?? null;
  } else {
    const uploadedFile = await utapi.uploadFilesFromUrl({ url, name });
    return uploadedFile.data?.ufsUrl ?? null;
  }
};

/**
 * Create a fast image from text using Replicate
 * Uses server-to-server transfer - UploadThing fetches directly from Replicate URL
 * @param prompt - The prompt to create the image from
 * @param disable_safety_checker - Whether to disable the safety checker
 * @returns The URL of the image
 */
export const fastTxt2imgReplicate = async (config: {
  prompt: string;
  aspect_ratio?: "1:1" | "16:9" | "9:16";
  disable_safety_checker?: boolean;
  output_quality?: number;
  mega_pixels?: "0.25" | "1";
}) => {
  const {
    prompt,
    aspect_ratio = "1:1",
    disable_safety_checker = false,
    output_quality = 50,
    mega_pixels = "0.25",
  } = config;
  const replicate = new Replicate({
    auth: env.REPLICATE_API_TOKEN,
  });
  const input = {
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
  const outputs = (await replicate.run("black-forest-labs/flux-schnell", {
    input,
  })) as FileOutput[];
  const output = outputs?.[0];
  if (!output) throw new Error("No output from AI model");
  // Use URL-based upload - UploadThing fetches directly from Replicate
  const replicateUrl = output.url();
  const utapi = new UTApi();
  const name = `preview-${nanoid()}.webp`;
  const uploadedFile = await utapi.uploadFilesFromUrl({ url: replicateUrl, name });
  return uploadedFile;
};

type Txt2ImgConfig = {
  preprompt: string;
  prompt: string;
  previousImg?: string | null;
  removeBg: boolean;
  userId: string;
  width: number;
  height: number;
  size: IMG_ORIENTATION;
};

/**
 * Create an image from text using OpenAI
 * @param config The configuration for the image generation
 * @returns The URL of the image
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
    model: "gpt-image-1",
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
  return uploadedFiles.map((file) => file.data?.ufsUrl).filter(Boolean) as string[];
};

/**
 * Create an image from text using Google's Nano Banana via Replicate
 * Mirrors txt2imgGPT flow and returns uploaded URL(s)
 */
export const txt2imgNanoBanana = async (config: Txt2ImgConfig) => {
  const replicate = new Replicate({ auth: env.REPLICATE_API_TOKEN });

  const composedPrompt = `
      <system prompt>
        ${config.preprompt}
      </system prompt>
      <user prompt>
        ${config.prompt} ${config.removeBg ? "remove background" : "include appropriate background. Full image."}
      </user prompt>
    `;

  const promptToSend = config.previousImg ? config.prompt : composedPrompt;
  const inputs: Record<string, unknown> = { prompt: promptToSend };
  if (config.previousImg) inputs.image_input = [config.previousImg];

  // Get the file from the replicate run
  let file = (await replicate.run("google/nano-banana", {
    input: inputs,
  })) as FileOutput;
  if (!file) throw new Error("No output from AI model");

  // If transparent background requested, post-process with remove-bg
  if (config.removeBg) {
    file = await removeBackgroundReplicate(String(file.url()));
  }

  // Fetch and resize to requested bounds (match OpenAI flow)
  const blob = await file.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const resultBuffer = await sharp(Buffer.from(arrayBuffer))
    .resize({ width: config.width, height: config.height, fit: "inside" })
    .webp({ quality: 70 })
    .toBuffer();

  const resizedBlob = new Blob([resultBuffer as BlobPart]);
  const uploaded = await uploadFileFromReplicate("content", resizedBlob, "webp");
  const url = uploaded.data?.ufsUrl ?? null;
  return url ? [url] : [];
};

/**
 * Remove background from an image using lucataco/remove-bg on Replicate
 */
export const removeBackgroundReplicate = async (imageUrl: string) => {
  const replicate = new Replicate({ auth: env.REPLICATE_API_TOKEN });
  const output = (await replicate.run(
    "lucataco/remove-bg:95fcc2a26d3899cd6c2691c900465aaeff466285a65c14638cc5f36f34befaf1",
    {
      input: { image: imageUrl },
    },
  )) as FileOutput | FileOutput[];
  const file = Array.isArray(output) ? output[0] : output;
  if (!file) throw new Error("No output from remove-bg model");
  return file;
};
/**
 * Create a 3D model from an image
 * @param url The URL of the image to create a 3D model from
 */
export const img2model = async (url: string) => {
  const replicate = new Replicate({
    auth: env.REPLICATE_API_TOKEN,
  });
  const output = await replicate.predictions.create({
    version: "4876f2a8da1c544772dffa32e8889da4a1bab3a1f5c1937bfcfccb99ae347251",
    input: {
      seed: Math.floor(Math.random() * 1000000),
      images: [url],
      texture_size: 2048,
      mesh_simplify: 0.9,
      generate_color: false,
      generate_model: true,
      randomize_seed: true,
      generate_normal: false,
      save_gaussian_ply: false,
      ss_sampling_steps: 50,
      slat_sampling_steps: 50,
      return_no_background: false,
      ss_guidance_strength: 7.5,
      slat_guidance_strength: 3,
    },
  });
  return output;
};

/**
 * Upload an image from OpenAI to UploadThing
 * @param img - The image to upload
 * @param generationId - The generation ID
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
      const blob = Buffer.from(data.b64_json!, "base64");
      const resultBuffer = await sharp(blob)
        .resize({ width, height, fit: "inside" })
        .webp({ quality: 70 })
        .toBuffer();
      return new File([resultBuffer as BlobPart], `${prefix}-${idx}-${i}.webp`);
    }),
  );
  const uploadedFiles = await utapi.uploadFiles(resizedImages);
  return uploadedFiles;
};

interface FileEsque extends Blob {
  name: string;
}

/**
 * Create a thumbnail for the image
 */
export const createThumbnail = async (url?: string | null) => {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const blob = await res.arrayBuffer();
    const resultBuffer = await sharp(blob).resize(64, 64).toBuffer();
    const thumbnail = new Blob([resultBuffer as BlobPart]) as FileEsque;
    thumbnail.name = "thumbnail.png";
    const utapi = new UTApi();
    const response = await utapi.uploadFiles(thumbnail);
    const imageUrl = response.data?.ufsUrl;
    return imageUrl ?? url;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    return url;
  }
};

/**
 * Upload a file from a Replicate run session
 * @param object - The Replicate object
 * @param key - The key of the file to upload
 * @param generationId - The generation ID
 * @returns The uploaded files
 */
export const uploadFileFromReplicate = async (
  prefix: string,
  blob: Blob,
  extension = "webp",
) => {
  const utapi = new UTApi();
  const utFiles = new File([blob], `${prefix}-${nanoid()}.${extension}`);
  const uploadedFile = await utapi.uploadFiles(utFiles);
  return uploadedFile;
};

/**
 * Generate an audio clip using Replicate and return the URL
 */
export const generateSoundEffectReplicate = async (config: {
  prompt: string;
  negativePrompt?: string;
  secondsTotal: number;
}) => {
  const replicate = new Replicate({ auth: env.REPLICATE_API_TOKEN });
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
  const uploadedFile = await utapi.uploadFilesFromUrl({ url, name });
  return uploadedFile.data?.ufsUrl ?? null;
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
  const replicate = new Replicate({ auth: env.REPLICATE_API_TOKEN });

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

/**
 * Check the status of a video generation prediction
 * @param predictionId - The Replicate prediction ID
 * @returns The prediction status and output if completed
 */
export const getVideoGenerationStatus = async (predictionId: string) => {
  const replicate = new Replicate({ auth: env.REPLICATE_API_TOKEN });
  const prediction = await replicate.predictions.get(predictionId);
  return prediction;
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
  const uploadedFile = await utapi.uploadFilesFromUrl({ url: outputUrl, name });
  return uploadedFile.data?.ufsUrl ?? null;
};
