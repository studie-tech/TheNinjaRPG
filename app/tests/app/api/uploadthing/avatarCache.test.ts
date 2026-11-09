import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { extractRouterConfig, UploadThingError } from "uploadthing/server";
import { ourFileRouter } from "@/app/api/uploadthing/core";
import { AVATAR_UPLOAD_DAILY_LIMIT } from "@/drizzle/constants";
import { historicalAvatar, historicalSoundEffect, userData } from "@/drizzle/schema";
import * as moderator from "@/libs/moderator";
import * as replicate from "@/libs/replicate";
import { servedUfsUrl } from "@/libs/uploadthing";
import * as tavernUploads from "@/server/utils/tavernUploads";
import { restoreEnvAfterEach } from "../../../setup/env";
import { insertUsers } from "../../../setup/factories";
import { resetServerModuleStubs, stubDatabase } from "../../../setup/serverModules";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";
import { countUserReads } from "../../../setup/userReads";

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
  restoreEnvAfterEach("UPLOADTHING_TOKEN");

  beforeEach(async () => {
    // Bun shares its realm with browser suites; UploadThing checks for window at runtime.
    savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Reflect.deleteProperty(globalThis, "window");
    // The SDK validates configuration before reaching the mocked deletion request.
    process.env.UPLOADTHING_TOKEN = Buffer.from(
      JSON.stringify({
        apiKey: "sk_test_not_a_real_key",
        appId: "avatar-test",
        regions: ["fra1"],
      }),
    ).toString("base64");
    await resetTables(historicalAvatar, historicalSoundEffect, userData);
    await insertUsers([
      {
        userId,
        username: "UploadAvatarCache",
        staffAccount: false,
        federalStatus: "NORMAL",
      },
    ]);
    vi.spyOn(clerk, "auth").mockResolvedValue({ userId } as never);
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
  });

  it.each([true, false])(
    "enforces the independent tavern upload budget (allowed: %s)",
    async (allowed) => {
      stubDatabase(await getTestDatabase());
      const claim = vi
        .spyOn(tavernUploads, "claimTavernImageUpload")
        .mockResolvedValue(allowed);
      const args = {
        files: [{ name: "image.png", type: "image/png", size: 100, lastModified: 0 }],
      } as Parameters<typeof ourFileRouter.tavernUploader.middleware>[0];
      if (allowed)
        expect(await ourFileRouter.tavernUploader.middleware(args)).toMatchObject({
          userId,
        });
      else
        await expect(ourFileRouter.tavernUploader.middleware(args)).rejects.toThrow(
          "tavern image upload attempts per day",
        );
      expect(claim).toHaveBeenCalledWith(userId);
      claim.mockClear();
      expect(await ourFileRouter.avatarNormalUploader.middleware(args)).toMatchObject({
        userId,
      });
      expect(claim).not.toHaveBeenCalled();
    },
  );

  it("does not charge tavern uploads against the avatar allowance", async () => {
    const database = await getTestDatabase();
    stubDatabase(database);
    await database.insert(historicalAvatar).values(
      Array.from({ length: 51 }, (_, index) => ({
        userId,
        avatar: `https://example.com/avatar-${index}.png`,
        done: true,
        status: "succeeded",
      })),
    );
    const claim = vi
      .spyOn(tavernUploads, "claimTavernImageUpload")
      .mockResolvedValue(true);
    const args = {
      files: [{ name: "image.png", type: "image/png", size: 100, lastModified: 0 }],
    } as Parameters<typeof ourFileRouter.tavernUploader.middleware>[0];
    expect(await ourFileRouter.tavernUploader.middleware(args)).toMatchObject({
      userId,
    });
    expect(claim).toHaveBeenCalledWith(userId);
    const rejection = ourFileRouter.avatarNormalUploader.middleware(args);
    await expect(rejection).rejects.toThrow(
      `Can only upload ${AVATAR_UPLOAD_DAILY_LIMIT} files per day`,
    );
    // UploadThing replaces any other middleware error with a generic message.
    await expect(rejection).rejects.toBeInstanceOf(UploadThingError);
  });

  const repeatedRoutes = [
    ["anbuUploader", "image", "512KB"],
    ["clanUploader", "image", "512KB"],
    ["tournamentUploader", "image", "512KB"],
    ["avatarNormalUploader", "image", "512KB"],
    ["avatarSilverUploader", "image", "1MB"],
    ["avatarGoldUploader", "image", "2MB"],
    ["audioSfxUploader", "audio", "64KB"],
    ["audioMusicUploader", "audio", "4MB"],
  ] as const;

  it.each(repeatedRoutes)(
    "%s accepts %s files up to %s",
    (endpoint, kind, maxFileSize) => {
      const [route] = extractRouterConfig({ [endpoint]: ourFileRouter[endpoint] });
      expect(route?.config).toMatchObject({ [kind]: { maxFileSize } });
    },
  );

  const middlewareArgs = {
    files: [{ name: "image.png", type: "image/png", size: 100, lastModified: 0 }],
    input: { relationId: "relation" },
  } as never;
  const runMiddleware = (endpoint: (typeof repeatedRoutes)[number][0]) =>
    (ourFileRouter[endpoint].middleware as (args: never) => Promise<unknown>)(
      middlewareArgs,
    );

  it.each(repeatedRoutes)(
    "%s rejects signed-out and banned users",
    async (endpoint) => {
      const database = await getTestDatabase();
      stubDatabase(database);
      vi.spyOn(clerk, "auth").mockResolvedValue({ userId: null } as never);
      await expect(runMiddleware(endpoint)).rejects.toThrow("Unauthorized");
      vi.spyOn(clerk, "auth").mockResolvedValue({ userId } as never);
      await database
        .update(userData)
        .set({ isBanned: true })
        .where(eq(userData.userId, userId));
      await expect(runMiddleware(endpoint)).rejects.toThrow("You are banned");
    },
  );

  it("gates each avatar size on its own federal tier", async () => {
    const database = await getTestDatabase();
    stubDatabase(database);
    for (const [federalStatus, allowed] of [
      ["NORMAL", "avatarNormalUploader"],
      ["SILVER", "avatarSilverUploader"],
      ["GOLD", "avatarGoldUploader"],
    ] as const) {
      await database
        .update(userData)
        .set({ federalStatus })
        .where(eq(userData.userId, userId));
      for (const [endpoint, tier] of [
        ["avatarNormalUploader", "NORMAL"],
        ["avatarSilverUploader", "SILVER"],
        ["avatarGoldUploader", "GOLD"],
      ] as const) {
        if (endpoint === allowed)
          expect(await runMiddleware(endpoint)).toMatchObject({ userId });
        else
          await expect(runMiddleware(endpoint)).rejects.toThrow(
            `You must be ${tier} to upload this avatar`,
          );
      }
    }
  });

  it.each(["anbuUploader", "clanUploader", "tournamentUploader"] as const)(
    "%s applies the avatar allowance without a federal requirement",
    async (endpoint) => {
      const database = await getTestDatabase();
      stubDatabase(database);
      await database
        .update(userData)
        .set({ federalStatus: "NONE" })
        .where(eq(userData.userId, userId));
      expect(await runMiddleware(endpoint)).toMatchObject({ userId });
      await database.insert(historicalAvatar).values(
        Array.from({ length: 51 }, (_, index) => ({
          userId,
          avatar: `https://example.com/limit-${index}.png`,
          done: true,
          status: "succeeded",
        })),
      );
      await expect(runMiddleware(endpoint)).rejects.toThrow(
        `Can only upload ${AVATAR_UPLOAD_DAILY_LIMIT} files per day`,
      );
    },
  );

  it.each(["audioSfxUploader", "audioMusicUploader"] as const)(
    "%s is reserved for content staff and records the uploaded sound",
    async (endpoint) => {
      const database = await getTestDatabase();
      stubDatabase(database);
      await expect(runMiddleware(endpoint)).rejects.toThrow(
        "You do not have permission to upload content files",
      );
      await database
        .update(userData)
        .set({ role: "CONTENT-ADMIN" })
        .where(eq(userData.userId, userId));
      expect(await runMiddleware(endpoint)).toMatchObject({
        userId,
        relationId: "relation",
      });
      const complete = ourFileRouter[endpoint].onUploadComplete as (
        args: never,
      ) => Promise<unknown>;
      const result = await complete({
        file,
        metadata: { userId, relationId: "relation" },
      } as never);
      expect(result).toEqual({ fileUrl: servedUfsUrl(file), userId });
      const [sound] = await database.select().from(historicalSoundEffect);
      expect(sound).toMatchObject({
        userId,
        relationId: "relation",
        url: servedUfsUrl(file),
      });
    },
  );

  it.each([
    ["anbuUploader", "anbu-image"],
    ["clanUploader", "clan-image"],
    ["tournamentUploader", "tournament-image"],
  ] as const)("%s files its history under %s", async (endpoint, historyUserId) => {
    const database = await getTestDatabase();
    stubDatabase(database);
    await callback(endpoint);
    const [saved] = await database.query.historicalAvatar.findMany();
    expect(saved?.userId).toBe(historyUserId);
  });

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
