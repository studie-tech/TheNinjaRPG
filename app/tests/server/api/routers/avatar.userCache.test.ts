import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { historicalAvatar, userData } from "@/drizzle/schema";
import * as replicate from "@/libs/replicate";
import { avatarRouter } from "@/server/api/routers/avatar";
import { insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";
import { countUserReads } from "../../../setup/userReads";

const userId = "avatar-cache-user";
const avatar = "https://example.com/cache-avatar.png";
const avatarLight = "https://example.com/cache-avatar-thumb.png";

describeWithDatabase("Avatar cache reconciliation", () => {
  beforeEach(async () => {
    await resetTables(historicalAvatar, userData);
    await insertUsers([{ userId, username: "AvatarCache" } as never]);
  });

  afterEach(() => vi.restoreAllMocks());

  const stubGeneration = () => {
    vi.spyOn(replicate, "getAvatarPrompt").mockResolvedValue("A ninja");
    vi.spyOn(replicate, "fastTxt2imgReplicate").mockResolvedValue({
      data: { ufsUrl: avatar },
      error: null,
    } as Awaited<ReturnType<typeof replicate.fastTxt2imgReplicate>>);
    vi.spyOn(replicate, "createThumbnail").mockResolvedValue(avatarLight);
  };

  it("returns generated URLs and the confirmed debit without rereading the user", async () => {
    const database = await getTestDatabase();
    await database
      .update(userData)
      .set({ reputationPoints: 10 })
      .where(eq(userData.userId, userId));
    stubGeneration();
    const counted = countUserReads(
      beforeStatements(database, userData, [
        () =>
          database
            .update(userData)
            .set({ reputationPoints: sql`${userData.reputationPoints} + 5` })
            .where(eq(userData.userId, userId)),
      ]),
    );
    const result = await callerForDatabase(
      avatarRouter,
      userId,
      counted.client,
    ).createAvatar();
    expect(result.success).toBe(true);
    expect(result.userPatch).toEqual({ avatar, avatarLight });
    expect(result.userDelta).toEqual({ reputationPoints: -1 });
    expect(counted.getReads()).toBe(1);
    expect(
      await database.query.userData.findFirst({
        columns: { avatar: true, avatarLight: true, reputationPoints: true },
        where: eq(userData.userId, userId),
      }),
    ).toEqual({ avatar, avatarLight, reputationPoints: 14 });
    expect(
      await database.query.historicalAvatar.findFirst({
        columns: { avatar: true, avatarLight: true },
        where: eq(historicalAvatar.userId, userId),
      }),
    ).toEqual<typeof result.userPatch>(result.userPatch);
  });

  it("returns the saved null thumbnail when generation has no thumbnail", async () => {
    const database = await getTestDatabase();
    await database
      .update(userData)
      .set({ reputationPoints: 1 })
      .where(eq(userData.userId, userId));
    stubGeneration();
    vi.spyOn(replicate, "createThumbnail").mockResolvedValue(null);
    const result = await callerForDatabase(
      avatarRouter,
      userId,
      database,
    ).createAvatar();
    expect(result.success).toBe(true);
    expect(result.userPatch).toEqual({ avatar, avatarLight: null });
    expect(result.userDelta).toEqual({ reputationPoints: -1 });
  });

  it("confirms no profile change or history write when the generated file upload fails", async () => {
    const database = await getTestDatabase();
    await database
      .update(userData)
      .set({ reputationPoints: 1 })
      .where(eq(userData.userId, userId));
    const before = await database.query.userData.findFirst({
      where: eq(userData.userId, userId),
    });
    stubGeneration();
    vi.spyOn(replicate, "fastTxt2imgReplicate").mockResolvedValue({
      data: null,
      error: { code: "UPLOAD_FAILED", message: "Upload failed" },
    } as Awaited<ReturnType<typeof replicate.fastTxt2imgReplicate>>);
    vi.spyOn(replicate, "createThumbnail").mockResolvedValue(null);
    const writeHistory = vi.fn(async () => undefined);
    const counted = countUserReads(
      beforeStatements(database, historicalAvatar, [writeHistory]),
    );
    const result = await callerForDatabase(
      avatarRouter,
      userId,
      counted.client,
    ).createAvatar();
    expect(result).toEqual({
      success: false,
      message: "Failed to create avatar",
      userDelta: {},
    });
    expect(counted.getReads()).toBe(1);
    expect(counted.getUserWrites()).toBe(0);
    expect(writeHistory).not.toHaveBeenCalled();
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, userId),
      }),
    ).toEqual(before);
    expect(
      await database.query.historicalAvatar.findMany({
        where: eq(historicalAvatar.userId, userId),
      }),
    ).toEqual([]);
  });

  it("does not return a patch or debit when the guarded payment loses its balance", async () => {
    const database = await getTestDatabase();
    await database
      .update(userData)
      .set({ reputationPoints: 1 })
      .where(eq(userData.userId, userId));
    stubGeneration();
    const counted = countUserReads(
      beforeStatements(database, userData, [
        () =>
          database
            .update(userData)
            .set({ reputationPoints: 0 })
            .where(eq(userData.userId, userId)),
      ]),
    );
    const result = await callerForDatabase(
      avatarRouter,
      userId,
      counted.client,
    ).createAvatar();
    expect(result.success).toBe(false);
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
    expect(counted.getReads()).toBe(1);
  });

  it("returns the saved avatar and thumbnail together without generating either", async () => {
    const database = await getTestDatabase();
    await database.insert(historicalAvatar).values({
      id: 11,
      userId,
      avatar,
      avatarLight,
      done: true,
      status: "success",
    });
    const counted = countUserReads(database);
    const caller = callerForDatabase(avatarRouter, userId, counted.client);
    const result = await caller.updateAvatar({ avatar: 11, type: "user" });
    expect(counted.getReads()).toBe(1);
    expect(result.success).toBe(true);
    expect(result.userPatch).toEqual({ avatar, avatarLight });
    const saved = await database.query.userData.findFirst({
      columns: { avatar: true, avatarLight: true },
      where: eq(userData.userId, userId),
    });
    expect(result.userPatch).toEqual(saved);
    expect(counted.getUserWrites()).toBe(1);
    // Selecting the active pair succeeds without relying on driver no-op row counts.
    const repeated = await caller.updateAvatar({ avatar: 11, type: "user" });
    expect(repeated.success).toBe(true);
    expect(repeated.userPatch).toEqual({ avatar, avatarLight });
    expect(counted.getReads()).toBe(2);
    expect(counted.getUserWrites()).toBe(1);
  });

  it("does not supply a user patch when history is missing", async () => {
    const caller = await callerFor(avatarRouter, userId);
    const result = await caller.updateAvatar({ avatar: 99, type: "user" });
    expect(result.success).toBe(false);
    expect(result.userPatch).toBeUndefined();
  });

  it("does not supply a user patch when the avatar belongs to another player", async () => {
    const database = await getTestDatabase();
    await database.insert(historicalAvatar).values({
      id: 11,
      userId: "other-avatar-user",
      avatar,
      avatarLight,
      done: true,
      status: "success",
    });
    const caller = await callerFor(avatarRouter, userId);
    const result = await caller.updateAvatar({ avatar: 11, type: "user" });
    expect(result.success).toBe(false);
    expect(result.userPatch).toBeUndefined();
  });
});
