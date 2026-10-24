import * as clerk from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { ourFileRouter } from "@/app/api/uploadthing/core";
import { historicalAvatar, userData, userUpload } from "@/drizzle/schema";
import { TAVERN_IMAGE_UPLOAD_DAILY_LIMIT } from "@/drizzle/constants";
import * as moderator from "@/libs/moderator";
import * as replicate from "@/libs/replicate";
import { servedUfsUrl } from "@/libs/uploadthing";
import { insertUsers } from "../../setup/factories";
import { resetServerModuleStubs, stubDatabase } from "../../setup/serverModules";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";
import { countUserReads } from "../../setup/userReads";

const userId = "upload-avatar-cache-user";
const file = {
  key: "avatar-file-key",
  ufsUrl: "https://example.com/avatar-file",
  customId: "avatar-file.png",
};
const avatarLight = "https://example.com/avatar-thumbnail.png";
const callback = (endpoint: keyof typeof ourFileRouter, targetUserId = userId) =>
  ourFileRouter[endpoint].onUploadComplete({
    file,
    metadata: { userId: targetUserId },
  });

describeWithDatabase("uploaded avatar cache responses", () => {
  let savedWindow: PropertyDescriptor | undefined;
  let savedUploadthingToken: string | undefined;

  beforeEach(async () => {
    // Bun shares its realm with browser suites; UploadThing checks for window at runtime.
    savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Reflect.deleteProperty(globalThis, "window");
    // The SDK validates configuration before reaching the mocked deletion request.
    savedUploadthingToken = process.env.UPLOADTHING_TOKEN;
    process.env.UPLOADTHING_TOKEN = Buffer.from(
      JSON.stringify({
        apiKey: "sk_test_not_a_real_key",
        appId: "avatar-test",
        regions: ["fra1"],
      }),
    ).toString("base64");
    await resetTables(userUpload, historicalAvatar, userData);
    await insertUsers([{ userId, username: "UploadAvatarCache" }]);
    vi.spyOn(clerk, "currentUser").mockResolvedValue({ id: userId } as never);
    vi.spyOn(moderator, "classifyNsfwImage").mockResolvedValue({
      isNsfw: false,
      reason: "",
    });
    vi.spyOn(replicate, "createThumbnail").mockResolvedValue(avatarLight);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.endsWith("/v6/deleteFiles"))
        throw new Error(`Unexpected external request: ${url}`);
      return Response.json({ success: true, deletedCount: 1 });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetServerModuleStubs();
    if (savedWindow) Object.defineProperty(globalThis, "window", savedWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (savedUploadthingToken === undefined) delete process.env.UPLOADTHING_TOKEN;
    else process.env.UPLOADTHING_TOKEN = savedUploadthingToken;
  });

  it.each([TAVERN_IMAGE_UPLOAD_DAILY_LIMIT - 1, TAVERN_IMAGE_UPLOAD_DAILY_LIMIT])(
    "limits recent tavern uploads for the current user (%s recent files)",
    async (recentCount) => {
      const database = await getTestDatabase();
      stubDatabase(database);
      await database.insert(userUpload).values([
        ...Array.from({ length: recentCount }, (_, index) => ({
          id: `recent-${index}`, userId, imageUrl: "https://example.com/image.png",
        })),
        { id: "old-upload", userId, imageUrl: "https://example.com/old.png", createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
        { id: "other-user-upload", userId: "another-user", imageUrl: "https://example.com/other.png" },
      ]);
      const args = { files: [{ name: "image.png", type: "image/png", size: 100, lastModified: 0 }] } as Parameters<typeof ourFileRouter.tavernUploader.middleware>[0];
      if (recentCount === TAVERN_IMAGE_UPLOAD_DAILY_LIMIT) {
        await expect(ourFileRouter.tavernUploader.middleware(args)).rejects.toThrow("tavern images per day");
        // Posting quotas must not consume an unrelated avatar upload allowance.
        expect(await ourFileRouter.avatarNormalUploader.middleware(args)).toMatchObject({ userId });
      } else {
        expect(await ourFileRouter.tavernUploader.middleware(args)).toMatchObject({ userId });
      }
    },
  );

  it.each([
    "avatarNormalUploader",
    "avatarSilverUploader",
    "avatarGoldUploader",
  ] as const)(
    "%s returns exactly the confirmed pair without reading the user",
    async (endpoint) => {
      const database = await getTestDatabase();
      const counted = countUserReads(database);
      stubDatabase(counted.client);
      const result = await callback(endpoint);
      expect(result).toEqual({
        fileUrl: servedUfsUrl(file),
        userPatch: { avatar: servedUfsUrl(file), avatarLight },
      });
      expect(counted.getReads()).toBe(0);
      expect(counted.getUserWrites()).toBe(1);
      const saved = await database.query.userData.findFirst({
        columns: { avatar: true, avatarLight: true },
        where: eq(userData.userId, userId),
      });
      expect(result.userPatch).toEqual(saved);
      const history = await database.query.historicalAvatar.findMany({
        where: eq(historicalAvatar.userId, userId),
      });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ ...saved, done: true, status: "succeeded" });
      expect(replicate.createThumbnail).toHaveBeenCalledWith(servedUfsUrl(file));
    },
  );

  it("returns the original URL when thumbnail creation uses its existing fallback", async () => {
    vi.spyOn(replicate, "createThumbnail").mockResolvedValue(servedUfsUrl(file));
    const result = await callback("avatarNormalUploader");
    expect(result.userPatch).toEqual({
      avatar: servedUfsUrl(file),
      avatarLight: servedUfsUrl(file),
    });
  });

  it("leaves cache reconciliation to the client when the account disappeared before the write", async () => {
    const database = await getTestDatabase();
    await database.delete(userData).where(eq(userData.userId, userId));
    const counted = countUserReads(database);
    stubDatabase(counted.client);
    const result = await callback("avatarNormalUploader");
    expect(result.fileUrl).toBe(servedUfsUrl(file));
    expect(result.userPatch).toBeUndefined();
    expect(counted.getReads()).toBe(0);
    expect(await database.query.historicalAvatar.findMany()).toHaveLength(1);
  });

  it.each(["anbuUploader", "clanUploader", "tournamentUploader"] as const)(
    "%s continues storing content history when its synthetic user ID has no account",
    async (endpoint) => {
      const database = await getTestDatabase();
      const counted = countUserReads(database);
      stubDatabase(counted.client);
      const result = await callback(endpoint);
      expect(result).toEqual({ fileUrl: servedUfsUrl(file) });
      expect(counted.getReads()).toBe(0);
      expect(await database.query.historicalAvatar.findMany()).toHaveLength(1);
      const saved = await database.query.userData.findFirst({
        columns: { avatar: true },
        where: eq(userData.userId, userId),
      });
      expect(saved?.avatar).not.toBe(servedUfsUrl(file));
    },
  );

  it.each(["unsafe image", "moderation unavailable"])(
    "does not write or return an avatar patch for %s",
    async (reason) => {
      if (reason === "unsafe image")
        vi.spyOn(moderator, "classifyNsfwImage").mockResolvedValue({
          isNsfw: true,
          reason,
        });
      else
        vi.spyOn(moderator, "classifyNsfwImage").mockRejectedValue(new Error(reason));
      const database = await getTestDatabase();
      const counted = countUserReads(database);
      stubDatabase(counted.client);
      const result = await callback("avatarNormalUploader");
      expect(result.fileUrl).toBe("");
      expect(result.error).toBeTruthy();
      expect(result.userPatch).toBeUndefined();
      expect(counted.getReads()).toBe(0);
      expect(counted.getUserWrites()).toBe(0);
      expect(await database.query.historicalAvatar.findMany()).toHaveLength(0);
      expect(replicate.createThumbnail).not.toHaveBeenCalled();
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["insert", "update"] as const)(
    "does not report a cache patch when the %s fails",
    async (operation) => {
      const database = await getTestDatabase();
      stubDatabase(
        new Proxy(database, {
          get(target, property, receiver) {
            if (property === "insert" || property === "update")
              return () => {
                const result = () =>
                  property === operation
                    ? Promise.reject(new Error("Avatar write failed"))
                    : Promise.resolve({ rowsAffected: 1 });
                return { values: result, set: () => ({ where: result }) };
              };
            return Reflect.get(target, property, receiver);
          },
        }),
      );
      await expect(callback("avatarNormalUploader")).rejects.toThrow(
        "Avatar write failed",
      );
    },
  );
});
