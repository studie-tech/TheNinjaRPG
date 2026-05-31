import { currentUser } from "@clerk/nextjs/server";
import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { FileRouter } from "uploadthing/next";
import { createUploadthing } from "uploadthing/next";
import { UploadThingError, UTApi } from "uploadthing/server";
import { z } from "zod";
import type { FederalStatuses } from "@/drizzle/constants";
import { historicalAvatar, userData, userUpload } from "@/drizzle/schema";
import { classifyNsfwImage } from "@/libs/moderator";
import { createThumbnail } from "@/libs/replicate";
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
type UploadedImage = { key: string; ufsUrl: string };

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
  return { fileUrl: file.ufsUrl };
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
  imageUploader: f({ image: { maxFileSize: "64KB" } })
    .middleware(async () => await avatarMiddleware())
    .onUploadComplete(async ({ file }) => moderateUploadedImage(file)),
  conceptArtFrameUploader: f({ image: { maxFileSize: "256KB" } })
    .middleware(async () => await avatarMiddleware())
    .onUploadComplete(async ({ file }) => moderateUploadedImage(file)),
  modelUploader: f({ "model/gltf-binary": { maxFileSize: "256KB" } })
    .middleware(async () => await avatarMiddleware())
    .onUploadComplete(({ file }) => {
      return { fileUrl: file.ufsUrl };
    }),
  tavernUploader: f({ image: { maxFileSize: "64KB" } })
    .middleware(async () => await avatarMiddleware())
    .onUploadComplete(async ({ metadata, file }) => {
      const moderation = await moderateUploadedImage(file);
      if (moderation.error) return moderation;
      await drizzleDB.insert(userUpload).values({
        id: nanoid(),
        userId: metadata.userId,
        imageUrl: file.ufsUrl,
      });
      return moderation;
    }),
  anbuUploader: f({ image: { maxFileSize: "512KB" } })
    .middleware(async () => await avatarMiddleware())
    .onUploadComplete(async ({ file }) => {
      const moderation = await moderateUploadedImage(file);
      if (moderation.error) return moderation;
      await uploadHistoricalAvatar(file, "anbu-image", true);
      return moderation;
    }),
  clanUploader: f({ image: { maxFileSize: "512KB" } })
    .middleware(async () => await avatarMiddleware())
    .onUploadComplete(async ({ file }) => {
      const moderation = await moderateUploadedImage(file);
      if (moderation.error) return moderation;
      await uploadHistoricalAvatar(file, "clan-image", true);
      return moderation;
    }),
  tournamentUploader: f({ image: { maxFileSize: "512KB" } })
    .middleware(async () => await avatarMiddleware())
    .onUploadComplete(async ({ file }) => {
      const moderation = await moderateUploadedImage(file);
      if (moderation.error) return moderation;
      await uploadHistoricalAvatar(file, "tournament-image", true);
      return moderation;
    }),
  avatarNormalUploader: f({ image: { maxFileSize: "512KB" } })
    .middleware(async () => await avatarMiddleware("NORMAL"))
    .onUploadComplete(async ({ metadata, file }) => {
      const moderation = await moderateUploadedImage(file);
      if (moderation.error) return moderation;
      await uploadHistoricalAvatar(file, metadata.userId, true);
      return moderation;
    }),
  avatarSilverUploader: f({ image: { maxFileSize: "1MB" } })
    .middleware(async () => await avatarMiddleware("SILVER"))
    .onUploadComplete(async ({ metadata, file }) => {
      const moderation = await moderateUploadedImage(file);
      if (moderation.error) return moderation;
      await uploadHistoricalAvatar(file, metadata.userId, true);
      return moderation;
    }),
  avatarGoldUploader: f({ image: { maxFileSize: "2MB" } })
    .middleware(async () => await avatarMiddleware("GOLD"))
    .onUploadComplete(async ({ metadata, file }) => {
      const moderation = await moderateUploadedImage(file);
      if (moderation.error) return moderation;
      await uploadHistoricalAvatar(file, metadata.userId, true);
      return moderation;
    }),
  backgroundImageUploader: f({ image: { maxFileSize: "8MB" } })
    .middleware(adminMiddleware) // Use the adminMiddleware here
    .onUploadComplete(async ({ metadata, file }) => {
      console.log(`Background image uploaded by ${metadata.userId}: ${file.ufsUrl}`);
    }),
  // SFX audio (small files)
  audioSfxUploader: f({ audio: { maxFileSize: "64KB" } })
    .input(z.object({ relationId: z.string() }))
    .middleware(async ({ input }) => {
      const { userId } = await adminMiddleware();
      return { userId, relationId: input.relationId };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      await insertHistoricalSoundEffect(drizzleDB, metadata.userId, file.ufsUrl, {
        relationId: metadata.relationId,
        secondsTotal: 1,
        prompt: "",
        negativePrompt: "",
      });
      return { fileUrl: file.ufsUrl, userId: metadata.userId };
    }),
  // MUSIC audio (larger files)
  audioMusicUploader: f({ audio: { maxFileSize: "4MB" } })
    .input(z.object({ relationId: z.string() }))
    .middleware(async ({ input }) => {
      const { userId } = await adminMiddleware();
      return { userId, relationId: input.relationId };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      await insertHistoricalSoundEffect(drizzleDB, metadata.userId, file.ufsUrl, {
        relationId: metadata.relationId,
        secondsTotal: 1,
        prompt: "",
        negativePrompt: "",
      });
      return { fileUrl: file.ufsUrl, userId: metadata.userId };
    }),
  // Tower Defense character animation zip uploader
  towerDefenseCharacterZip: f({
    "application/zip": { maxFileSize: "32MB" },
  })
    .input(z.object({ characterId: z.string() }))
    .middleware(async ({ input }) => {
      const { userId } = await adminMiddleware();
      return { userId, characterId: input.characterId };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      // The actual processing will be done by a tRPC endpoint
      // This just handles the upload and returns the URL
      return {
        fileUrl: file.ufsUrl,
        userId: metadata.userId,
        characterId: metadata.characterId,
      };
    }),
  // Tower Defense individual frame uploader (for batch uploading extracted frames)
  towerDefenseFrameUploader: f({
    image: { maxFileSize: "256KB", maxFileCount: 100 },
  })
    .middleware(adminMiddleware)
    .onUploadComplete(({ file }) => {
      return { fileUrl: file.ufsUrl };
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
  file: { ufsUrl: string },
  userId: string,
  updateUser?: boolean,
) => {
  const thumbnailUrl = await createThumbnail(file.ufsUrl);
  const promises = [
    drizzleDB.insert(historicalAvatar).values({
      replicateId: null,
      avatar: file.ufsUrl,
      avatarLight: thumbnailUrl,
      status: "succeeded",
      userId: userId,
      done: true,
    }),
    ...(updateUser
      ? [
          drizzleDB
            .update(userData)
            .set({ avatar: file.ufsUrl, avatarLight: thumbnailUrl })
            .where(eq(userData.userId, userId)),
        ]
      : []),
  ];
  await Promise.all(promises);
};
