import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { COST_CONCEPT_IMAGE, COST_CONCEPT_VIDEO } from "@/drizzle/constants";
import { conceptImage, userData, userQueue } from "@/drizzle/schema";
import * as moderator from "@/libs/moderator";
import * as replicate from "@/libs/replicate";
import { conceptartRouter } from "@/server/api/routers/conceptart";
import { insertUsers } from "../../setup/factories";
import { resetServerModuleStubs, stubProfile } from "../../setup/serverModules";
import { beforeStatements } from "../../setup/statements";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";
import { queueEnergy } from "../../setup/queues";

const userId = "conceptart-delta-player";
const imageInput = { prompt: "A ninja", seed: 1 };
const videoInput = { ...imageInput, negative_prompt: "", start_image: "https://example.com/ninja.webp" };

describeWithDatabase("concept art confirmed debits", () => {
  beforeEach(async () => {
    const db = await getTestDatabase();
    await resetTables(userQueue, conceptImage, userData);
    await insertUsers([{ userId, reputationPoints: 1000 }]);
    stubProfile("fetchUser", async (_client: unknown, id: string) => db.query.userData.findFirst({ where: eq(userData.userId, id) }));
    vi.spyOn(moderator, "classifyNsfwPrompt").mockResolvedValue({ isNsfw: false, reason: "Safe" });
    vi.spyOn(replicate, "fastTxt2imgReplicate").mockResolvedValue({ data: { ufsUrl: "https://example.com/ninja.webp" }, error: null } as Awaited<ReturnType<typeof replicate.fastTxt2imgReplicate>>);
    vi.spyOn(replicate, "startVideoGeneration").mockResolvedValue({ id: "prediction-1" } as Awaited<ReturnType<typeof replicate.startVideoGeneration>>);
  });

  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });

  it("returns only the confirmed image debit without a postwrite profile read", async () => {
    const db = await getTestDatabase();
    const reads = vi.spyOn(db.query.userData, "findFirst");
    const caller = callerForDatabase(conceptartRouter, userId, db);
    const result = await caller.create(imageInput);
    expect(result.success).toBe(true);
    expect(result.userDelta).toEqual({ reputationPoints: -COST_CONCEPT_IMAGE });
    expect(reads).toHaveBeenCalledTimes(1);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))?.reputationPoints).toBe(1000 - COST_CONCEPT_IMAGE);
    expect((await db.query.conceptImage.findFirst({ where: eq(conceptImage.id, result.imageId!) }))?.done).toBe(true);
  });

  it("does not deliver an image when funds change during generation", async () => {
    const db = await getTestDatabase();
    const caller = callerForDatabase(conceptartRouter, userId, beforeStatements(db, userData, [() => db.update(userData).set({ reputationPoints: 0 }).where(eq(userData.userId, userId))]));
    const result = await caller.create(imageInput);
    expect(result.success).toBe(false);
    expect(result.userDelta).toBeUndefined();
    expect(await db.query.conceptImage.findMany()).toEqual([]);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))?.reputationPoints).toBe(0);
  });

  it("returns the video debit after dispatch and restores funds on dispatch failure", async () => {
    const db = await getTestDatabase();
    const caller = callerForDatabase(conceptartRouter, userId, db);
    const success = await caller.createVideo(videoInput);
    expect(success.success).toBe(true);
    expect(success.userDelta).toEqual({ reputationPoints: -COST_CONCEPT_VIDEO });
    vi.spyOn(replicate, "startVideoGeneration").mockRejectedValue(new Error("Dispatch failed"));
    const failure = await caller.createVideo(videoInput);
    expect(failure.success).toBe(false);
    expect(failure.userDelta).toBeUndefined();
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))?.reputationPoints).toBe(1000 - COST_CONCEPT_VIDEO);
  });

  it("retains full reconciliation when an energy training queue is pending", async () => {
    const db = await getTestDatabase();
    await queueEnergy(userId, [{ stat: "offence", energy: 1 }]);
    const caller = callerForDatabase(conceptartRouter, userId, db);
    expect((await caller.create(imageInput)).userDelta).toBeUndefined();
    expect((await caller.createVideo(videoInput)).userDelta).toBeUndefined();
  });
});
