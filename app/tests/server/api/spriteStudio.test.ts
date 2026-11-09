import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  actionLog,
  aiProfile,
  aiSpriteAnimation,
  contentProposal,
  contentProposalBasis,
  spriteAnimation,
  spriteGeneration,
  userData,
} from "@/drizzle/schema";
import * as finish from "@/libs/spriteSheetFinish";
import { spriteStudioRouter } from "@/server/api/routers/spriteStudio";
import * as gameAsset from "@/server/utils/gameAsset";
import * as spriteSheets from "@/server/utils/spriteSheets";
import { insertDefaultAiProfile, insertUsers } from "../../setup/factories";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const remote = (
  overrides: Partial<gameAsset.GameAssetSprite> = {},
): gameAsset.GameAssetSprite => ({
  id: "asset-1",
  status: "queued",
  stage: "Queued",
  error: null,
  credits: { paid: 0.4 },
  files: null,
  sprite: null,
  ...overrides,
});
const finished = remote({
  status: "succeeded",
  stage: null,
  files: { spriteSheet: "https://me6hopahd7.ufs.sh/f/sheet" },
  sprite: { columns: 8, rows: 2, frameCount: 16, fps: 12.5 },
});
const request = {
  source: { kind: "ai", userId: "ai", actionKey: "idle" },
  name: "Bandit — Idle",
  prompt: "stands ready",
  motion: "idle",
  frames: 49,
} as const;

describeWithDatabase("sprite studio", () => {
  beforeEach(async () => {
    await resetTables(
      spriteGeneration,
      aiSpriteAnimation,
      spriteAnimation,
      contentProposalBasis,
      contentProposal,
      actionLog,
      aiProfile,
      userData,
    );
    await insertUsers([
      {
        userId: "editor",
        username: "Editor",
        role: "CONTENT",
        rank: "JONIN",
        level: 50,
      },
      { userId: "player", username: "Player", rank: "JONIN", level: 50 },
      {
        userId: "ai",
        username: "Bandit",
        isAi: true,
        rank: "JONIN",
        level: 50,
        avatar: "https://uploadthing.b-cdn.net/f/art",
        avatarFacing: "right",
      },
    ]);
    await insertDefaultAiProfile({ userId: "ai" });
    vi.spyOn(gameAsset, "gameAssetEnabled").mockReturnValue(true);
    vi.spyOn(gameAsset, "uploadCharacterImage").mockResolvedValue({
      id: "image-1",
      url: "https://me6hopahd7.ufs.sh/f/image",
    });
    vi.spyOn(gameAsset, "createSpriteAsset").mockResolvedValue(remote());
    vi.spyOn(gameAsset, "downloadSpriteFile").mockResolvedValue(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    vi.spyOn(finish, "finishSpriteSheet").mockResolvedValue({
      large: Buffer.from("l"),
      small: Buffer.from("s"),
    });
    let uploads = 0;
    vi.spyOn(spriteSheets, "uploadToStorage").mockImplementation(
      async () => `https://uploadthing.b-cdn.net/f/out-${++uploads}`,
    );
    vi.spyOn(spriteSheets, "removeFromStorage").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const caller = async (id = "editor") =>
    callerForDatabase(spriteStudioRouter, id, await getTestDatabase());
  const queued = async () => {
    const result = await (await caller()).generate(request);
    if (!("id" in result)) throw new Error(result.message);
    return result.id;
  };
  const row = async (id: string) =>
    (await getTestDatabase()).query.spriteGeneration.findFirst({
      where: eq(spriteGeneration.id, id),
    });
  const ready = async () => {
    const id = await queued();
    vi.spyOn(gameAsset, "getSpriteAsset").mockResolvedValue(finished);
    await (await caller()).sync();
    return id;
  };

  it("keeps every action behind content permissions", async () => {
    const player = await caller("player");
    expect((await player.generate(request)).success).toBe(false);
    expect((await player.sync()).success).toBe(false);
    expect((await player.accept({ id: "any", assign: false })).success).toBe(false);
    await expect(player.getGenerations()).rejects.toThrow(
      "Content editor access required",
    );
    expect(gameAsset.createSpriteAsset).not.toHaveBeenCalled();
  });

  it("queues an AI's own art with its own facing and rejects actions it lacks", async () => {
    const api = await caller();
    expect(
      (
        await api.generate({
          ...request,
          source: { ...request.source, actionKey: "jutsu:none" },
        })
      ).success,
    ).toBe(false);
    const stored = await row(await queued());
    expect(stored).toMatchObject({
      status: "QUEUED",
      facing: "right",
      remoteImageId: "image-1",
      remoteAssetId: "asset-1",
      aiUserId: "ai",
      actionKey: "idle",
    });
    expect(stored?.sourceUrl).toBe("https://uploadthing.b-cdn.net/f/art");
  });

  it("reports an API refusal without storing anything", async () => {
    vi.spyOn(gameAsset, "createSpriteAsset").mockRejectedValue(
      new gameAsset.GameAssetError("Top up your balance"),
    );
    const result = await (await caller()).generate(request);
    expect(result).toMatchObject({ success: false, message: "Top up your balance" });
    expect(
      await (await getTestDatabase()).query.spriteGeneration.findMany(),
    ).toHaveLength(0);
  });

  it("prepares a finished asset once on our CDN before anyone can review it", async () => {
    const id = await ready();
    expect(await row(id)).toMatchObject({
      status: "READY",
      url: "https://uploadthing.b-cdn.net/f/out-1",
      smallUrl: "https://uploadthing.b-cdn.net/f/out-2",
      columns: 8,
      rows: 2,
      frameCount: 16,
      fps: 12.5,
    });
    await (await caller()).sync();
    expect(finish.finishSpriteSheet).toHaveBeenCalledTimes(1);
    expect(
      await (await getTestDatabase()).query.spriteAnimation.findMany(),
    ).toHaveLength(0);
  });

  it("lets overlapping syncs prepare a sheet only once", async () => {
    await queued();
    vi.spyOn(gameAsset, "getSpriteAsset").mockResolvedValue(finished);
    const api = await caller();
    await Promise.all([api.sync(), api.sync()]);
    expect(finish.finishSpriteSheet).toHaveBeenCalledTimes(1);
  });

  it("records remote and preparation failures for staff to see", async () => {
    const failed = await queued();
    vi.spyOn(gameAsset, "getSpriteAsset").mockResolvedValue(
      remote({ status: "failed", error: "Quality gate" }),
    );
    await (await caller()).sync();
    expect(await row(failed)).toMatchObject({
      status: "FAILED",
      error: "Quality gate",
    });

    vi.spyOn(gameAsset, "createSpriteAsset").mockResolvedValue(
      remote({ id: "asset-2" }),
    );
    const broken = await queued();
    vi.spyOn(gameAsset, "getSpriteAsset").mockResolvedValue(finished);
    vi.spyOn(finish, "finishSpriteSheet").mockRejectedValue(new Error("Bad sheet"));
    await (await caller()).sync();
    expect(await row(broken)).toMatchObject({ status: "FAILED", error: "Bad sheet" });
  });

  it("publishes a reviewed sheet once and can assign it to its action", async () => {
    const id = await ready();
    const api = await caller();
    expect((await api.accept({ id, assign: true })).success).toBe(true);
    expect((await api.accept({ id, assign: true })).success).toBe(false);
    const db = await getTestDatabase();
    const library = await db.query.spriteAnimation.findMany();
    expect(library).toHaveLength(1);
    expect(library[0]).toMatchObject({
      name: "Bandit — Idle",
      columns: 8,
      rows: 2,
      frameCount: 16,
      facing: "right",
      smallUrl: "https://uploadthing.b-cdn.net/f/out-2",
    });
    expect(await db.query.aiSpriteAnimation.findMany()).toEqual([
      { userId: "ai", actionKey: "idle", animationId: library[0]?.id as string },
    ]);
    expect(await row(id)).toMatchObject({
      status: "ACCEPTED",
      animationId: library[0]?.id,
    });
  });

  it("adds to the library alone without touching assignments", async () => {
    const id = await ready();
    expect((await (await caller()).accept({ id, assign: false })).success).toBe(true);
    const db = await getTestDatabase();
    expect(await db.query.spriteAnimation.findMany()).toHaveLength(1);
    expect(await db.query.aiSpriteAnimation.findMany()).toHaveLength(0);
  });

  it("cancels running work and removes discarded sheets from the queue", async () => {
    const cancel = vi
      .spyOn(gameAsset, "cancelSpriteAsset")
      .mockResolvedValue(remote({ status: "failed" }));
    const running = await queued();
    const api = await caller();
    expect((await api.discard({ id: running })).success).toBe(true);
    expect(cancel).toHaveBeenCalledWith("asset-1");
    vi.spyOn(gameAsset, "createSpriteAsset").mockResolvedValue(
      remote({ id: "asset-2" }),
    );
    const id = await ready();
    expect((await api.discard({ id })).success).toBe(true);
    expect(spriteSheets.removeFromStorage).toHaveBeenCalledWith([
      "https://uploadthing.b-cdn.net/f/out-1",
      "https://uploadthing.b-cdn.net/f/out-2",
    ]);
    expect(await api.getGenerations()).toHaveLength(0);
  });

  it("keeps a request whose job may still be running when the cancel call fails", async () => {
    vi.spyOn(gameAsset, "cancelSpriteAsset").mockRejectedValue(
      new gameAsset.GameAssetError("gameasset.dev could not be reached"),
    );
    const lookup = vi
      .spyOn(gameAsset, "getSpriteAsset")
      .mockResolvedValue(remote({ status: "processing" }));
    const id = await queued();
    const api = await caller();
    expect((await api.discard({ id })).success).toBe(false);
    lookup.mockRejectedValue(
      new gameAsset.GameAssetError("gameasset.dev could not be reached"),
    );
    expect((await api.discard({ id })).success).toBe(false);
    expect((await row(id))?.status).toBe("QUEUED");
    lookup.mockResolvedValue(finished);
    expect((await api.discard({ id })).success).toBe(true);
    expect((await row(id))?.status).toBe("DISCARDED");
  });

  it("leaves a sheet in preparation to finish instead of discarding it", async () => {
    const id = await queued();
    await (await getTestDatabase())
      .update(spriteGeneration)
      .set({ status: "PREPARING" })
      .where(eq(spriteGeneration.id, id));
    expect((await (await caller()).discard({ id })).success).toBe(false);
    expect((await row(id))?.status).toBe("PREPARING");
  });

  it("removes stored sheets when the request moved on during preparation", async () => {
    const id = await queued();
    vi.spyOn(gameAsset, "getSpriteAsset").mockResolvedValue(finished);
    vi.spyOn(finish, "finishSpriteSheet").mockImplementation(async () => {
      await (await getTestDatabase())
        .update(spriteGeneration)
        .set({ updatedAt: new Date(0) })
        .where(eq(spriteGeneration.id, id));
      return { large: Buffer.from("l"), small: Buffer.from("s") };
    });
    await (await caller()).sync();
    expect(spriteSheets.removeFromStorage).toHaveBeenCalledWith([
      "https://uploadthing.b-cdn.net/f/out-1",
      "https://uploadthing.b-cdn.net/f/out-2",
    ]);
    expect((await row(id))?.url).toBeNull();
  });

  it("removes the first sheet when the second upload fails", async () => {
    const id = await queued();
    vi.spyOn(gameAsset, "getSpriteAsset").mockResolvedValue(finished);
    vi.spyOn(spriteSheets, "uploadToStorage")
      .mockResolvedValueOnce("https://uploadthing.b-cdn.net/f/large")
      .mockRejectedValueOnce(new Error("Upload failed"));
    await (await caller()).sync();
    expect(spriteSheets.removeFromStorage).toHaveBeenCalledWith([
      "https://uploadthing.b-cdn.net/f/large",
    ]);
    expect(await row(id)).toMatchObject({ status: "FAILED", error: "Upload failed" });
  });

  it("cancels a paid job whose request cannot be saved", async () => {
    await queued();
    const cancel = vi
      .spyOn(gameAsset, "cancelSpriteAsset")
      .mockResolvedValue(remote({ status: "failed" }));
    await expect((await caller()).generate(request)).rejects.toThrow();
    expect(cancel).toHaveBeenCalledWith("asset-1");
  });

  it("polls the oldest requests first when more are running than one sync covers", async () => {
    const create = vi.spyOn(gameAsset, "createSpriteAsset");
    const db = await getTestDatabase();
    for (let index = 0; index < 13; index++) {
      create.mockResolvedValue(remote({ id: `asset-${index}` }));
      const id = await queued();
      await db
        .update(spriteGeneration)
        .set({ createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)) })
        .where(eq(spriteGeneration.id, id));
    }
    const poll = vi.spyOn(gameAsset, "getSpriteAsset").mockResolvedValue(remote());
    await (await caller()).sync();
    expect(poll).toHaveBeenCalledTimes(12);
    expect(poll).toHaveBeenCalledWith("asset-0");
    expect(poll).not.toHaveBeenCalledWith("asset-12");
  });

  it("takes a new shot from the stored image without uploading again", async () => {
    const id = await ready();
    vi.spyOn(gameAsset, "createSpriteAsset").mockResolvedValue(
      remote({ id: "asset-2" }),
    );
    const result = await (await caller()).regenerate({ id });
    expect(result.success).toBe(true);
    expect(gameAsset.uploadCharacterImage).toHaveBeenCalledTimes(1);
    expect(gameAsset.createSpriteAsset).toHaveBeenLastCalledWith(
      expect.objectContaining({ imageId: "image-1", frames: 49 }),
      expect.any(String),
    );
  });
});
