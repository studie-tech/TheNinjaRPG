import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import { historicalAvatar } from "@/drizzle/schema";
import * as replicate from "@/libs/replicate";
import { generativeAiRouter } from "@/server/api/routers/openai";
import { resetServerModuleStubs, stubProfile } from "../../../setup/serverModules";
import { callerForDatabase } from "../../../setup/testDatabase";

const input = {
  preprompt: "Painted furniture",
  prompt: "Turn the bed ninety degrees while keeping the camera fixed",
  previousImg: "https://example.com/bed.webp",
  removeBg: true,
  relationId: "bed-content",
  size: "portrait" as const,
  maxDim: 1024,
};
const imageUrl = "https://example.com/generated-bed.webp";

/** Isolates our provider routing and history contract from external generation services. */
const makeCaller = (historyCount = 0) => {
  const values = vi.fn().mockResolvedValue({ rowsAffected: 1 });
  const insert = vi.fn().mockReturnValue({ values });
  const database = {
    $count: vi.fn().mockResolvedValue(historyCount),
    insert,
  };
  return {
    caller: callerForDatabase(generativeAiRouter, "content-author", database as never),
    insert,
    values,
  };
};

describe("content image provider routing", () => {
  beforeEach(() => {
    stubProfile("fetchUser", async () => ({ role: "OWNER" }));
    vi.spyOn(replicate, "txt2imgGPT").mockResolvedValue([imageUrl]);
    vi.spyOn(replicate, "txt2imgNanoBanana").mockResolvedValue([imageUrl]);
  });

  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });

  it.each([undefined, "NANO_BANANA", "OPENAI"] as const)(
    "routes %s and retains reference input and content history",
    async (provider) => {
      const { caller, insert, values } = makeCaller();
      expect(await caller.createImg({ ...input, provider })).toEqual({
        success: true,
        message: "Image generated",
        url: imageUrl,
      });
      const selected =
        provider === "OPENAI" ? replicate.txt2imgGPT : replicate.txt2imgNanoBanana;
      const unused =
        provider === "OPENAI" ? replicate.txt2imgNanoBanana : replicate.txt2imgGPT;
      expect(selected).toHaveBeenCalledWith({
        preprompt: input.preprompt,
        prompt: input.prompt,
        previousImg: input.previousImg,
        removeBg: true,
        userId: "content-author",
        width: 1024,
        height: 1024,
        size: "portrait",
      });
      expect(unused).not.toHaveBeenCalled();
      expect(insert).toHaveBeenCalledWith(historicalAvatar);
      expect(values).toHaveBeenCalledWith([
        {
          avatar: imageUrl,
          userId: input.relationId,
          status: "content-success",
          done: true,
        },
      ]);
    },
  );

  it("rejects unsupported providers before generation or history writes", async () => {
    const { caller, insert } = makeCaller();
    await expect(
      caller.createImg({ ...input, provider: "OTHER" as never }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(replicate.txt2imgGPT).not.toHaveBeenCalled();
    expect(replicate.txt2imgNanoBanana).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    { role: "USER", historyCount: 0, message: "You are not allowed to change content" },
    {
      role: "OWNER",
      historyCount: 101,
      message: "Maximum of 100 creations per day reached",
    },
  ] as const)(
    "answers the $message guard for OpenAI",
    async ({ role, historyCount, message }) => {
      stubProfile("fetchUser", async () => ({ role }));
      const { caller, insert } = makeCaller(historyCount);
      expect(await caller.createImg({ ...input, provider: "OPENAI" })).toEqual({
        success: false,
        message,
        url: null,
      });
      expect(replicate.txt2imgGPT).not.toHaveBeenCalled();
      expect(replicate.txt2imgNanoBanana).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    },
  );

  it("allows the hundredth creation of the day", async () => {
    const { caller, insert } = makeCaller(100);
    expect(await caller.createImg({ ...input, provider: "OPENAI" })).toMatchObject({
      success: true,
    });
    expect(insert).toHaveBeenCalledWith(historicalAvatar);
  });

  it("retains recoverable generation failures without publishing content history", async () => {
    const failure = new Error("Failed to generate image");
    vi.spyOn(replicate, "txt2imgGPT").mockRejectedValue(failure);
    const warning = vi
      .spyOn(Sentry, "captureException")
      .mockReturnValue("warning-event");
    const { caller, insert } = makeCaller();
    expect(await caller.createImg({ ...input, provider: "OPENAI" })).toMatchObject({
      success: false,
      url: null,
    });
    expect(warning).toHaveBeenCalledWith(failure, {
      level: "warning",
      tags: { source: "generativeAi.createImg" },
    });
    expect(insert).not.toHaveBeenCalled();
  });
});
