import { currentUser } from "@clerk/nextjs/server";
import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { FileRouter } from "uploadthing/next";
import { createUploadthing } from "uploadthing/next";
import { UploadThingError, UTApi, UTFiles } from "uploadthing/server";
import { z } from "zod";
import type { FederalStatuses } from "@/drizzle/constants";
import { historicalAvatar, userData, userUpload } from "@/drizzle/schema";
import { classifyNsfwImage } from "@/libs/moderator";
import { createThumbnail } from "@/libs/replicate";
import { extensionCustomId, servedUfsUrl } from "@/libs/uploadthing";
import { insertHistoricalSoundEffect } from "@/server/api/routers/audio";
import { drizzleDB } from "@/server/db";
import { getUserFederalStatus } from "@/utils/paypal";
import { canChangeContent } from "@/utils/permissions";

const f = createUploadthing({
  errorFormatter: (err) => {
    console.log("error", err);
    console.log("cause", err.cause);
    return {
      message: err.message,
    };
  },
});

type ImageUploadResult = { fileUrl: string; error?: string };
type UploadedImage = { key: string; ufsUrl: string; customId?: string | null };

/**
 * Give every incoming file a customId that carries its extension, so the
 * served URL path has one and the Bunny CDN optimizer can engage on it.
 */
const withExtensionIds = (files: readonly { name: string; type?: string }[]) => ({
  [UTFiles]: files.map((file) => ({
    ...file,
    customId: extensionCustomId(file.name, file.type),
  })),
});

const moderateUploadedImage = async (
  file: UploadedImage,
): Promise<ImageUploadResult> => {
  const utapi = new UTApi();
  try {
    const moderation = await classifyNsfwImage(file.ufsUrl);
    if (moderation.isNsfw) {
      await utapi.deleteFiles(file.key);
      return { fileUrl: "", error: moderation.reason };
    }
  } catch {
    await utapi.deleteFiles(file.key);
    return {
      fileUrl: "",
      error: "Unable to validate uploaded image. Please try another image.",
    };
  }
  return { fileUrl: servedUfsUrl(file) };
};

/**
 * Check if user is admin
 * @param file
 * @param userId
 */
const adminMiddleware = async () => {
  // Fetch & Guard
  const sessionUser = await currentUser();
  if (!sessionUser) throw new UploadThingError("Unauthorized");

  const user = await drizzleDB.query.userData.findFirst({
    where: eq(userData.userId, sessionUser.id),
  });
  if (!user) throw new UploadThingError("User not found");
  if (user.isBanned) throw new UploadThingError("You are banned");

  // Role Check
  if (!canChangeContent(user.role)) {
    throw new UploadThingError(
      `You do not have permission to upload background images. Your role: ${user.role}`,
    );
  }

  return { userId: sessionUser.id };
};

export const ourFileRouter = {
  imageUploader: f({ image: { maxFileSize: "512KB" } })
    .middleware(async ({ files }) => ({
      ...(await avatarMiddleware()),
      ...withExtensionIds(files),
    }))
    .onUploadComplete(async ({ file }) => moderateUploadedImage(file)),
  conceptArtFrameUploader: f({ image: { maxFileSize: "256KB" } })
    .middleware(async ({ files }) => ({
      ...(await avatarMiddleware()),
      ...withExtensionIds(files),
    }))
    .onUploadComplete(async ({ file }) => moderateUploadedImage(file)),
  modelUploader: f({ "model/gltf-binary": { maxFileSize: "256KB" } })
    .middleware(async ({ files }) => ({
      ...(await avatarMiddleware()),
      ...withExtensionIds(files),
    }))
    .onUploadComplete(({ file }) => {
      return { fileUrl: servedUfsUrl(file) };
    }),
  tavernUploader: f({ image: { maxFileSize: "64KB" } })
    .middleware(async ({ files }) => ({
      ...(await avatarMiddleware()),
      ...withExtensionIds(files),
    }))
    .onUploadComplete(async ({ metadata, file }) => {
      const moderation = await moderateUploadedImage(file);
      if (moderation.error) return moderation;
      await drizzleDB.insert(userUpload).values({
        id: nanoid(),
        userId: metadata.userId,
        imageUrl: servedUfsUrl(file),
      });
      return moderation;
    }),
  anbuUploader: f({ image: { maxFileSize: "512KB" } })
    .middleware(async ({ files }) => ({
      ...(await avatarMiddleware()),
      ...withExtensionIds(files),
    }))
    .onUploadComplete(async ({ file }) => {
      const moderation = await moderateUploadedImage(file);
      if (moderation.error) return moderation;
      await uploadHistoricalAvatar(file, "anbu-image", true);
      return moderation;
    }),
  clanUploader: f({ image: { maxFileSize: "512KB" } })
    .middleware(async ({ files }) => ({
      ...(await avatarMiddleware()),
      ...withExtensionIds(files),
    }))
    .onUploadComplete(async ({ file }) => {
      const moderation = await moderateUploadedImage(file);
      if (moderation.error) return moderation;
      await uploadHistoricalAvatar(file, "clan-image", true);
      return moderation;
    }),
  tournamentUploader: f({ image: { maxFileSize: "512KB" } })
    .middleware(async ({ files }) => ({
      ...(await avatarMiddleware()),
      ...withExtensionIds(files),
    }))
    .onUploadComplete(async ({ file }) => {
      const moderation = await moderateUploadedImage(file);
      if (moderation.error) return moderation;
      await uploadHistoricalAvatar(file, "tournament-image", true);
      return moderation;
    }),
  avatarNormalUploader: f({ image: { maxFileSize: "512KB" } })
    .middleware(async ({ files }) => ({
      ...(await avatarMiddleware("NORMAL")),
      ...withExtensionIds(files),
    }))
    .onUploadComplete(async ({ metadata, file }) => {
      const moderation = await moderateUploadedImage(file);
      if (moderation.error) return moderation;
      await uploadHistoricalAvatar(file, metadata.userId, true);
      return moderation;
    }),
  avatarSilverUploader: f({ image: { maxFileSize: "1MB" } })
    .middleware(async ({ files }) => ({
      ...(await avatarMiddleware("SILVER")),
      ...withExtensionIds(files),
    }))
    .onUploadComplete(async ({ metadata, file }) => {
      const moderation = await moderateUploadedImage(file);
      if (moderation.error) return moderation;
      await uploadHistoricalAvatar(file, metadata.userId, true);
      return moderation;
    }),
  avatarGoldUploader: f({ image: { maxFileSize: "2MB" } })
    .middleware(async ({ files }) => ({
      ...(await avatarMiddleware("GOLD")),
      ...withExtensionIds(files),
    }))
    .onUploadComplete(async ({ metadata, file }) => {
      const moderation = await moderateUploadedImage(file);
      if (moderation.error) return moderation;
      await uploadHistoricalAvatar(file, metadata.userId, true);
      return moderation;
    }),
  backgroundImageUploader: f({ image: { maxFileSize: "8MB" } })
    .middleware(async ({ files }) => ({
      ...(await adminMiddleware()),
      ...withExtensionIds(files),
    })) // Use the adminMiddleware here
    .onUploadComplete(async ({ metadata, file }) => {
      console.log(
        `Background image uploaded by ${metadata.userId}: ${servedUfsUrl(file)}`,
      );
    }),
  // SFX audio (small files)
  audioSfxUploader: f({ audio: { maxFileSize: "64KB" } })
    .input(z.object({ relationId: z.string() }))
    .middleware(async ({ input, files }) => {
      const { userId } = await adminMiddleware();
      return { userId, relationId: input.relationId, ...withExtensionIds(files) };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      await insertHistoricalSoundEffect(
        drizzleDB,
        metadata.userId,
        servedUfsUrl(file),
        {
          relationId: metadata.relationId,
          secondsTotal: 1,
          prompt: "",
          negativePrompt: "",
        },
      );
      return { fileUrl: servedUfsUrl(file), userId: metadata.userId };
    }),
  // MUSIC audio (larger files)
  audioMusicUploader: f({ audio: { maxFileSize: "4MB" } })
    .input(z.object({ relationId: z.string() }))
    .middleware(async ({ input, files }) => {
      const { userId } = await adminMiddleware();
      return { userId, relationId: input.relationId, ...withExtensionIds(files) };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      await insertHistoricalSoundEffect(
        drizzleDB,
        metadata.userId,
        servedUfsUrl(file),
        {
          relationId: metadata.relationId,
          secondsTotal: 1,
          prompt: "",
          negativePrompt: "",
        },
      );
      return { fileUrl: servedUfsUrl(file), userId: metadata.userId };
    }),
  // Tower Defense character animation zip uploader
  towerDefenseCharacterZip: f({
    "application/zip": { maxFileSize: "32MB" },
  })
    .input(z.object({ characterId: z.string() }))
    .middleware(async ({ input, files }) => {
      const { userId } = await adminMiddleware();
      return { userId, characterId: input.characterId, ...withExtensionIds(files) };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      // The actual processing will be done by a tRPC endpoint
      // This just handles the upload and returns the URL
      return {
        fileUrl: servedUfsUrl(file),
        userId: metadata.userId,
        characterId: metadata.characterId,
      };
    }),
  // Tower Defense individual frame uploader (for batch uploading extracted frames)
  towerDefenseFrameUploader: f({
    image: { maxFileSize: "256KB", maxFileCount: 100 },
  })
    .middleware(async ({ files }) => ({
      ...(await adminMiddleware()),
      ...withExtensionIds(files),
    }))
    .onUploadComplete(({ file }) => {
      return { fileUrl: servedUfsUrl(file) };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;

/**
 * Limits number of created avatars / day
 * @param req
 * @returns
 */
const avatarMiddleware = async (fedRequirement?: (typeof FederalStatuses)[number]) => {
  // Fetch & Guard
  const sessionUser = await currentUser();
  if (!sessionUser) throw new UploadThingError("Unauthorized");
  const user = await drizzleDB.query.userData.findFirst({
    where: eq(userData.userId, sessionUser.id),
  });
  if (!user) throw new UploadThingError("User not found");
  if (user.isBanned) throw new UploadThingError("You are banned");
  // Limit
  const avatars = await drizzleDB
    .select({ count: sql`count(*)`.mapWith(Number) })
    .from(historicalAvatar)
    .where(
      and(
        eq(historicalAvatar.userId, sessionUser.id),
        isNotNull(historicalAvatar.avatar),
        gt(historicalAvatar.createdAt, sql`NOW() - INTERVAL 1 DAY`),
      ),
    );
  const nRecentAvatars = avatars?.[0]?.count || 0;
  if (nRecentAvatars > 50) throw new Error("Can only upload 50 files per day");
  // Federal check
  if (fedRequirement) {
    const userstatus = getUserFederalStatus(user);
    if (userstatus !== fedRequirement) {
      throw new UploadThingError(`You must be ${fedRequirement} to upload this avatar`);
    }
  }
  return { userId: sessionUser.id };
};

/**
 * Update the historical avatars database
 * @param file
 * @param userId
 */
const uploadHistoricalAvatar = async (
  file: { ufsUrl: string; customId?: string | null },
  userId: string,
  updateUser?: boolean,
) => {
  const fileUrl = servedUfsUrl(file);
  const thumbnailUrl = await createThumbnail(fileUrl);
  const promises = [
    drizzleDB.insert(historicalAvatar).values({
      replicateId: null,
      avatar: fileUrl,
      avatarLight: thumbnailUrl,
      status: "succeeded",
      userId: userId,
      done: true,
    }),
    ...(updateUser
      ? [
          drizzleDB
            .update(userData)
            .set({ avatar: fileUrl, avatarLight: thumbnailUrl })
            .where(eq(userData.userId, userId)),
        ]
      : []),
  ];
  await Promise.all(promises);
};
