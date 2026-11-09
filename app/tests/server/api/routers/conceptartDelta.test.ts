import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import { DrizzleQueryError, eq } from "drizzle-orm";
import { COST_CONCEPT_IMAGE, COST_CONCEPT_VIDEO } from "@/drizzle/constants";
import { conceptImage, userData, userQueue } from "@/drizzle/schema";
import * as moderator from "@/libs/moderator";
import * as replicate from "@/libs/replicate";
import { CONCEPT_PROMPT, conceptartRouter } from "@/server/api/routers/conceptart";
import { DATABASE_FAILURE_MESSAGE } from "@/server/utils/mysqlErrors";
import { insertUsers } from "../../../setup/factories";
import { queueEnergy } from "../../../setup/queues";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const userId = "conceptart-delta-player";
const imageInput = { prompt: "A ninja", seed: 1 };
const videoInput = {
  ...imageInput,
  negative_prompt: "",
  start_image: "https://example.com/ninja.webp",
};

describeWithDatabase("concept art confirmed debits", () => {
  beforeEach(async () => {
    await resetTables(userQueue, conceptImage, userData);
    await insertUsers([{ userId, reputationPoints: 1000 }]);
    vi.spyOn(moderator, "classifyNsfwPrompt").mockResolvedValue({
      isNsfw: false,
      reason: "Safe",
    });
    vi.spyOn(replicate, "fastTxt2imgReplicate").mockResolvedValue({
      data: { ufsUrl: "https://example.com/ninja.webp" },
      error: null,
    } as Awaited<ReturnType<typeof replicate.fastTxt2imgReplicate>>);
    vi.spyOn(replicate, "startVideoGeneration").mockResolvedValue({
      id: "prediction-1",
    } as Awaited<ReturnType<typeof replicate.startVideoGeneration>>);
  });

  afterEach(() => vi.restoreAllMocks());

  it("returns only the confirmed image debit without a postwrite profile read", async () => {
    const db = await getTestDatabase();
    const reads = vi.spyOn(db.query.userData, "findFirst");
    const caller = callerForDatabase(conceptartRouter, userId, db);
    const result = await caller.create(imageInput);
    expect(result.success).toBe(true);
    expect(result.userDelta).toEqual({ reputationPoints: -COST_CONCEPT_IMAGE });
    expect(reads).toHaveBeenCalledTimes(1);
    expect(replicate.fastTxt2imgReplicate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: `A ninja, ${CONCEPT_PROMPT}` }),
    );
    expect(CONCEPT_PROMPT.startsWith(",")).toBe(false);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))
        ?.reputationPoints,
    ).toBe(1000 - COST_CONCEPT_IMAGE);
    expect(
      (
        await db.query.conceptImage.findFirst({
          where: eq(conceptImage.id, result.imageId!),
        })
      )?.done,
    ).toBe(true);
  });

  it("does not deliver an image when funds change during generation", async () => {
    const db = await getTestDatabase();
    vi.spyOn(replicate, "fastTxt2imgReplicate").mockImplementation(async () => {
      await db
        .update(userData)
        .set({ reputationPoints: 0 })
        .where(eq(userData.userId, userId));
      return {
        data: { ufsUrl: "https://example.com/ninja.webp" },
        error: null,
      } as Awaited<ReturnType<typeof replicate.fastTxt2imgReplicate>>;
    });
    const caller = callerForDatabase(conceptartRouter, userId, db);
    const result = await caller.create(imageInput);
    expect(result.success).toBe(false);
    expect(result.userDelta).toBeUndefined();
    expect(await db.query.conceptImage.findMany()).toEqual([]);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))
        ?.reputationPoints,
    ).toBe(0);
  });

  it("rolls back the image debit when persistence fails", async () => {
    const db = await getTestDatabase();
    await db.insert(conceptImage).values({
      id: "existing-art",
      userId,
      prompt: "Existing art",
      image: "https://example.com/ninja.webp",
    });
    const caller = callerForDatabase(conceptartRouter, userId, db);
    // The image URL is unique, so delivery fails after the guarded debit executes.
    await expect(caller.create(imageInput)).rejects.toThrow();
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))
        ?.reputationPoints,
    ).toBe(1000);
    expect((await db.query.conceptImage.findMany()).map(({ id }) => id)).toEqual([
      "existing-art",
    ]);
    expect(replicate.fastTxt2imgReplicate).toHaveBeenCalledTimes(1);
  });

  it("persists maximum-length prompts and the largest supported seed", async () => {
    const db = await getTestDatabase();
    const caller = callerForDatabase(conceptartRouter, userId, db);
    const prompt = "a".repeat(5000);
    const seed = 2147483647;
    const image = await caller.create({ prompt, seed });
    const video = await caller.createVideo({
      ...videoInput,
      prompt,
      negative_prompt: prompt,
      seed,
      start_image: "https://example.com/video.webp",
    });
    expect(image.success).toBe(true);
    expect(video.success).toBe(true);
    expect(
      await db.query.conceptImage.findFirst({
        where: eq(conceptImage.id, image.imageId!),
      }),
    ).toMatchObject({ prompt, seed });
    expect(
      await db.query.conceptImage.findFirst({
        where: eq(conceptImage.id, video.videoId!),
      }),
    ).toMatchObject({ prompt, negative_prompt: prompt, seed });
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))
        ?.reputationPoints,
    ).toBe(1000 - COST_CONCEPT_IMAGE - COST_CONCEPT_VIDEO);
  });

  it("rejects oversized prompts and seeds before generation or debiting points", async () => {
    const db = await getTestDatabase();
    const caller = callerForDatabase(conceptartRouter, userId, db);
    await expect(
      caller.create({ ...imageInput, prompt: "a".repeat(5001) }),
    ).rejects.toThrow("Prompt cannot exceed 5000 characters");
    await expect(
      caller.createVideo({ ...videoInput, prompt: "a".repeat(5001) }),
    ).rejects.toThrow("Prompt cannot exceed 5000 characters");
    await expect(
      caller.createVideo({ ...videoInput, negative_prompt: "a".repeat(5001) }),
    ).rejects.toThrow("Negative prompt cannot exceed 5000 characters");
    await expect(caller.create({ ...imageInput, seed: 2147483648 })).rejects.toThrow(
      "Seed cannot exceed 2147483647",
    );
    await expect(
      caller.createVideo({ ...videoInput, seed: 2147483648 }),
    ).rejects.toThrow("Seed cannot exceed 2147483647");
    expect(moderator.classifyNsfwPrompt).not.toHaveBeenCalled();
    expect(replicate.fastTxt2imgReplicate).not.toHaveBeenCalled();
    expect(replicate.startVideoGeneration).not.toHaveBeenCalled();
    expect(await db.query.conceptImage.findMany()).toEqual([]);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))
        ?.reputationPoints,
    ).toBe(1000);
  });

  it("returns the video debit after dispatch and restores funds on dispatch failure", async () => {
    const db = await getTestDatabase();
    const caller = callerForDatabase(conceptartRouter, userId, db);
    const success = await caller.createVideo(videoInput);
    expect(success.success).toBe(true);
    expect(success.userDelta).toEqual({ reputationPoints: -COST_CONCEPT_VIDEO });
    vi.spyOn(replicate, "startVideoGeneration").mockRejectedValue(
      new Error("Dispatch failed"),
    );
    const failure = await caller.createVideo(videoInput);
    expect(failure.success).toBe(false);
    expect(failure.userDelta).toBeUndefined();
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))
        ?.reputationPoints,
    ).toBe(1000 - COST_CONCEPT_VIDEO);
  });

  it("reports a failed statement to Sentry and keeps it out of the response", async () => {
    const db = await getTestDatabase();
    const caller = callerForDatabase(conceptartRouter, userId, db);
    const report = vi.spyOn(Sentry, "captureException").mockReturnValue("event");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(replicate, "startVideoGeneration").mockRejectedValueOnce(
      new Error("Dispatch failed"),
    );
    expect((await caller.createVideo(videoInput)).message).toBe("Dispatch failed");
    expect(report).not.toHaveBeenCalled();
    const failure = new DrizzleQueryError(
      "insert into ConceptImage",
      ["secret"],
      new TypeError("fetch failed"),
    );
    vi.spyOn(replicate, "startVideoGeneration").mockRejectedValueOnce(failure);
    expect((await caller.createVideo(videoInput)).message).toBe(
      DATABASE_FAILURE_MESSAGE,
    );
    expect(report).toHaveBeenCalledWith(failure, expect.anything());
  });

  it("retains full reconciliation when an energy training queue is pending", async () => {
    const db = await getTestDatabase();
    await queueEnergy(userId, [{ stat: "offence", energy: 1 }]);
    const caller = callerForDatabase(conceptartRouter, userId, db);
    expect((await caller.create(imageInput)).userDelta).toBeUndefined();
    expect((await caller.createVideo(videoInput)).userDelta).toBeUndefined();
  });
});
