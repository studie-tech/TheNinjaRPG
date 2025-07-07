import { currentUser } from "@clerk/nextjs/server";
import { createUploadthing } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { eq, sql, gt, and, isNotNull } from "drizzle-orm";
import { historicalAvatar, userData, userUpload } from "@/drizzle/schema";
import { drizzleDB } from "@/server/db";
import { getUserFederalStatus } from "@/utils/paypal";
import { createThumbnail } from "@/libs/replicate";
import type { FileRouter } from "uploadthing/next";
import type { FederalStatuses } from "@/drizzle/constants";
import { canChangeContent } from "@/utils/permissions";
import { nanoid } from "nanoid";

const f = createUploadthing({
  errorFormatter: (err) => {
    console.log("error", err);
    console.log("cause", err.cause);
    return {
      message: err.message,
    };
  },
});

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
    .onUploadComplete(({ file }) => {
      return { fileUrl: file.ufsUrl };
    }),
  modelUploader: f({ "model/gltf-binary": { maxFileSize: "256KB" } })
    .middleware(async () => await avatarMiddleware())
    .onUploadComplete(({ file }) => {
      return { fileUrl: file.ufsUrl };
    }),
  tavernUploader: f({ image: { maxFileSize: "64KB" } })
    .middleware(async () => await avatarMiddleware())
    .onUploadComplete(async ({ metadata, file }) => {
      await drizzleDB.insert(userUpload).values({
        id: nanoid(),
        userId: metadata.userId,
        imageUrl: file.ufsUrl,
      });
      return { fileUrl: file.ufsUrl };
    }),
  anbuUploader: f({ image: { maxFileSize: "512KB" } })
    .middleware(async () => await avatarMiddleware())
    .onUploadComplete(async ({ file }) => {
      await uploadHistoricalAvatar(file, "anbu-image", true);
      return { fileUrl: file.ufsUrl };
    }),
  clanUploader: f({ image: { maxFileSize: "512KB" } })
    .middleware(async () => await avatarMiddleware())
    .onUploadComplete(async ({ file }) => {
      await uploadHistoricalAvatar(file, "clan-image", true);
      return { fileUrl: file.ufsUrl };
    }),
  tournamentUploader: f({ image: { maxFileSize: "512KB" } })
    .middleware(async () => await avatarMiddleware())
    .onUploadComplete(async ({ file }) => {
      await uploadHistoricalAvatar(file, "tournament-image", true);
      return { fileUrl: file.ufsUrl };
    }),
  avatarNormalUploader: f({ image: { maxFileSize: "512KB" } })
    .middleware(async () => await avatarMiddleware("NORMAL"))
    .onUploadComplete(async ({ metadata, file }) => {
      await uploadHistoricalAvatar(file, metadata.userId, true);
    }),
  avatarSilverUploader: f({ image: { maxFileSize: "1MB" } })
    .middleware(async () => await avatarMiddleware("SILVER"))
    .onUploadComplete(async ({ metadata, file }) => {
      await uploadHistoricalAvatar(file, metadata.userId, true);
    }),
  avatarGoldUploader: f({ image: { maxFileSize: "2MB" } })
    .middleware(async () => await avatarMiddleware("GOLD"))
    .onUploadComplete(async ({ metadata, file }) => {
      await uploadHistoricalAvatar(file, metadata.userId, true);
    }),
  backgroundImageUploader: f({ image: { maxFileSize: "8MB" } })
    .middleware(adminMiddleware) // Use the adminMiddleware here
    .onUploadComplete(async ({ metadata, file }) => {
      console.log(`Background image uploaded by ${metadata.userId}: ${file.ufsUrl}`);
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
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
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
      done: 1,
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
