import { auth } from "@clerk/nextjs/server";
import { createUploadthing, type FileRouter } from "uploadthing/next";

import { UploadThingError, UTApi, UTFiles } from "uploadthing/server";
import { z } from "zod";
import {
  AVATAR_UPLOAD_DAILY_LIMIT,
  type FederalStatuses,
  TAVERN_IMAGE_MAX_SIZE_MB,
  TAVERN_IMAGE_UPLOAD_DAILY_LIMIT,
} from "@/drizzle/constants";
import { classifyNsfwImage } from "@/libs/moderator";
import { createThumbnail } from "@/libs/replicate";
import { extensionCustomId, servedUfsUrl } from "@/libs/uploadthing";
import { insertHistoricalSoundEffect } from "@/queries/audio";
import {
  insertHistoricalAvatarForUploadHistoricalAvatar,
  selectHistoricalAvatarForAvatarMiddleware,
  updateUserAvatar,
} from "@/queries/avatar";
import { findUserById, insertUserUploadForTavernUploader } from "@/queries/profile";
import { drizzleDB } from "@/server/db";
import { claimTavernImageUpload } from "@/server/utils/tavernUploads";
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

/** Require a signed-in, unbanned user who may change game content. */
const adminMiddleware = async () => {
  const user = await fetchUploadUser();
  if (!canChangeContent(user.role)) {
    throw new UploadThingError(
      `You do not have permission to upload content files. Your role: ${user.role}`,
    );
  }
  return { userId: user.userId };
};

/** Avatar image for a federal tier, saved to the uploader's profile once moderated. */
const avatarUploader = (
  maxFileSize: "512KB" | "1MB" | "2MB",
  tier: (typeof FederalStatuses)[number],
) =>
  f({ image: { maxFileSize } })
    .middleware(async ({ files }) => ({
      ...(await avatarMiddleware(tier)),
      ...withExtensionIds(files),
    }))
    .onUploadComplete(async ({ metadata, file }) => {
      const moderation = await moderateUploadedImage(file);
      if (moderation.error) return moderation;
      const userPatch = await uploadHistoricalAvatar(file, metadata.userId, true);
      return { ...moderation, userPatch };
    });

/** Moderated group image, filed in the avatar history under a synthetic owner. */
const contentImageUploader = (historyUserId: string) =>
  f({ image: { maxFileSize: "512KB" } })
    .middleware(async ({ files }) => ({
      ...(await avatarMiddleware()),
      ...withExtensionIds(files),
    }))
    .onUploadComplete(async ({ file }) => {
      const moderation = await moderateUploadedImage(file);
      if (moderation.error) return moderation;
      await uploadHistoricalAvatar(file, historyUserId, true);
      return moderation;
    });

/** Staff-only audio recorded as a sound effect of the given relation. */
const audioUploader = (maxFileSize: "64KB" | "4MB") =>
  f({ audio: { maxFileSize } })
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
    });

export const ourFileRouter = {
  lpcSheetUploader: f({ image: { maxFileSize: "8MB" } })
    .middleware(async () => adminMiddleware())
    // Raw keys preserve image pixels and coordinates when the file passes through the CDN.
    .onUploadComplete(({ file }) => ({ fileUrl: file.ufsUrl })),
  /** Full sprite atlases need a larger limit than avatars, with the same staff/moderation guards. */
  spriteAnimationUploader: f({ image: { maxFileSize: "8MB" } })
    .middleware(async ({ files }) => ({
      ...(await adminMiddleware()),
      ...withExtensionIds(files),
    }))
    .onUploadComplete(async ({ file }) => moderateUploadedImage(file)),
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
  tavernUploader: f({ image: { maxFileSize: `${TAVERN_IMAGE_MAX_SIZE_MB}MB` } })
    .middleware(async ({ files }) => {
      const user = await fetchUploadUser();
      if (!(await claimTavernImageUpload(user.userId))) {
        throw new UploadThingError(
          `Can only make ${TAVERN_IMAGE_UPLOAD_DAILY_LIMIT} tavern image upload attempts per day`,
        );
      }
      return { userId: user.userId, ...withExtensionIds(files) };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      const moderation = await moderateUploadedImage(file);
      if (moderation.error) return moderation;
      await insertUserUploadForTavernUploader(drizzleDB, metadata, file);
      return moderation;
    }),
  anbuUploader: contentImageUploader("anbu-image"),
  clanUploader: contentImageUploader("clan-image"),
  tournamentUploader: contentImageUploader("tournament-image"),
  avatarNormalUploader: avatarUploader("512KB", "NORMAL"),
  avatarSilverUploader: avatarUploader("1MB", "SILVER"),
  avatarGoldUploader: avatarUploader("2MB", "GOLD"),
  // SFX audio (small files)
  audioSfxUploader: audioUploader("64KB"),
  // MUSIC audio (larger files)
  audioMusicUploader: audioUploader("4MB"),
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
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;

/** Shared identity and ban checks; each upload route owns its own allowance. */
const fetchUploadUser = async () => {
  // Fetch & Guard
  const { userId } = await auth();
  if (!userId) throw new UploadThingError("Unauthorized");
  const user = await findUserById(drizzleDB, userId);
  if (!user) throw new UploadThingError("User not found");
  if (user.isBanned) throw new UploadThingError("You are banned");
  return user;
};

/** Checks the avatar creation allowance and optional federal requirement. */
const avatarMiddleware = async (fedRequirement?: (typeof FederalStatuses)[number]) => {
  const user = await fetchUploadUser();
  // Limit
  const avatars = await selectHistoricalAvatarForAvatarMiddleware(drizzleDB, user);
  const nRecentAvatars = avatars?.[0]?.count || 0;
  if (nRecentAvatars > AVATAR_UPLOAD_DAILY_LIMIT) {
    throw new UploadThingError(
      `Can only upload ${AVATAR_UPLOAD_DAILY_LIMIT} files per day`,
    );
  }
  // Federal check
  if (fedRequirement) {
    const userstatus = getUserFederalStatus(user);
    if (userstatus !== fedRequirement) {
      throw new UploadThingError(`You must be ${fedRequirement} to upload this avatar`);
    }
  }
  return { userId: user.userId };
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
  const userPatch = { avatar: fileUrl, avatarLight: thumbnailUrl };
  const promises = [
    insertHistoricalAvatarForUploadHistoricalAvatar(
      drizzleDB,
      fileUrl,
      thumbnailUrl,
      userId,
    ),
    ...(updateUser ? [updateUserAvatar(drizzleDB, userPatch, userId)] : []),
  ];
  const [, userUpdate] = await Promise.all(promises);
  return userUpdate?.rowsAffected === 1 ? userPatch : undefined;
};
