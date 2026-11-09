import { afterEach, describe, expect, it, vi } from "bun:test";
import * as ai from "ai";
import sharp from "sharp";
import { OPENAI_REVIEW_MODEL } from "@/drizzle/constants";
import {
  classifyPetAppearanceImage,
  validatePetAppearanceQuality,
} from "@/libs/pets/quality";
import { petAppearanceQualitySchema } from "@/validators/pets";

const accepted = {
  singleAnimal: true,
  anatomyCorrect: true,
  speciesMatches: true,
  completeBody: true,
  noGroundOrScene: true,
  identityPreserved: true,
  evolutionStronger: true,
  avatarFacing: "left" as const,
  reason: "A complete, clean sprite",
};

afterEach(() => vi.restoreAllMocks());

describe("pet visual quality", () => {
  it("rejects visual defects, lost identity and evolutions without a clear strength gain", () => {
    for (const field of [
      "singleAnimal",
      "anatomyCorrect",
      "noGroundOrScene",
      "speciesMatches",
      "identityPreserved",
      "completeBody",
      "evolutionStronger",
    ] as const)
      expect(() =>
        validatePetAppearanceQuality({
          ...accepted,
          [field]: false,
          reason: `Invalid ${field}`,
        }),
      ).toThrow(field);
    for (const avatarFacing of ["left", "right"] as const)
      expect(() =>
        validatePetAppearanceQuality({ ...accepted, avatarFacing }),
      ).not.toThrow();
  });

  it("can waive only the subjective evolution strength check", () => {
    const options = { requireStrongerEvolution: false };
    expect(() =>
      validatePetAppearanceQuality({ ...accepted, evolutionStronger: false }, options),
    ).not.toThrow();
    for (const field of [
      "singleAnimal",
      "anatomyCorrect",
      "noGroundOrScene",
      "speciesMatches",
      "identityPreserved",
      "completeBody",
    ] as const)
      expect(() =>
        validatePetAppearanceQuality(
          {
            ...accepted,
            [field]: false,
            evolutionStronger: false,
            reason: `Invalid ${field}`,
          },
          options,
        ),
      ).toThrow(field);
  });

  it.each([
    { previousRank: 1, hasPrevious: true, required: true },
    { previousRank: 2, hasPrevious: true, required: false },
    { previousRank: 1, hasPrevious: false, required: false },
  ])(
    "requires visible progression only for a known lower-rank reference: %j",
    async ({ previousRank, hasPrevious, required }) => {
      const model = vi
        .spyOn(ai, "generateText")
        .mockResolvedValue({ output: accepted } as never);
      const candidate = await input();
      await classifyPetAppearanceImage(
        {
          ...candidate,
          previousRank,
          previousImage: hasPrevious ? await fixture() : undefined,
        },
        new AbortController().signal,
      );
      expect(model).toHaveBeenCalledTimes(1);
      const content = model.mock.calls[0]![0].messages?.[0]?.content;
      if (!Array.isArray(content) || content[0]?.type !== "text")
        throw new Error("Expected review context");
      expect(JSON.parse(content[0].text)).toMatchObject({
        rank: candidate.rank,
        previousRank,
        evolutionRequired: required,
        images: hasPrevious ? ["PREVIOUS", "CANDIDATE"] : ["CANDIDATE"],
      });
    },
  );

  it("passes the requested sex to review only when the companion has one", async () => {
    const model = vi
      .spyOn(ai, "generateText")
      .mockResolvedValue({ output: accepted } as never);
    await classifyPetAppearanceImage(
      { ...(await input()), sex: "MALE" },
      new AbortController().signal,
    );
    await classifyPetAppearanceImage(await input(), new AbortController().signal);
    const context = (call: number) => {
      const content = model.mock.calls[call]![0].messages?.[0]?.content;
      if (!Array.isArray(content) || content[0]?.type !== "text")
        throw new Error("Expected review context");
      return JSON.parse(content[0].text);
    };
    expect(context(0)).toMatchObject({ sex: "MALE" });
    expect(context(1)).not.toHaveProperty("sex");
    expect(String(model.mock.calls[0]![0].instructions)).toContain(
      "a maneless lioness",
    );
  });

  it("judges evolutions by impressiveness and rejects non-native limbs, clutter, framing and shrinking", async () => {
    const model = vi
      .spyOn(ai, "generateText")
      .mockResolvedValue({ output: accepted } as never);
    await classifyPetAppearanceImage(await input(), new AbortController().signal);
    const instructions = String(model.mock.calls[0]![0].instructions);
    expect(instructions).toContain(
      "does not naturally have, such as wings on a wolf or panda",
    );
    expect(instructions).toContain("cluttered mass of spikes");
    expect(instructions).toContain("multiple tails merged into the body");
    expect(instructions).toContain(
      "fills the canvas edge to edge or touches the border",
    );
    expect(instructions).toContain("clearly more impressive and advanced");
    expect(instructions).toContain("A noticeably smaller animal than PREVIOUS FAILS");
    expect(instructions).toMatch(
      /Bulk, extra fur, feather or scale layers, spikes, filling more of the frame.*alone FAIL/,
    );
  });

  it("does not call vision after an abort, and observes a caller abort in flight", async () => {
    const model = vi
      .spyOn(ai, "generateText")
      .mockResolvedValue({ output: accepted } as never);
    await expect(
      classifyPetAppearanceImage(await input(), AbortSignal.abort()),
    ).rejects.toThrow();
    expect(model).not.toHaveBeenCalled();
    const controller = new AbortController();
    model.mockImplementation(async (options) => {
      controller.abort();
      expect(options.abortSignal?.aborted).toBe(true);
      return { output: accepted } as never;
    });
    await expect(
      classifyPetAppearanceImage(await input(), controller.signal),
    ).rejects.toThrow();
  });

  it("does not call vision if cancelled while preparing inspection previews", async () => {
    const model = vi.spyOn(ai, "generateText");
    const controller = new AbortController();
    const review = classifyPetAppearanceImage(await input(), controller.signal);
    controller.abort();
    await expect(review).rejects.toThrow();
    expect(model).not.toHaveBeenCalled();
  });

  it("propagates a failed vision request", async () => {
    const error = new Error("Vision unavailable");
    const model = vi.spyOn(ai, "generateText").mockRejectedValue(error);
    await expect(
      classifyPetAppearanceImage(await input(), new AbortController().signal),
    ).rejects.toBe(error);
    expect(model).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized previous image before spending on vision", async () => {
    const model = vi.spyOn(ai, "generateText");
    const previousImage = await sharp({
      create: { width: 1025, height: 1024, channels: 4, background: "transparent" },
    })
      .png()
      .toBuffer();
    await expect(
      classifyPetAppearanceImage(
        { ...(await input()), previousImage },
        new AbortController().signal,
      ),
    ).rejects.toThrow("pixel limit");
    expect(model).not.toHaveBeenCalled();
  });

  it("supplies ordered opaque checkerboard previews without changing the original sprites", async () => {
    const model = vi
      .spyOn(ai, "generateText")
      .mockResolvedValue({ output: accepted } as never);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const candidate = await input();
    const previous = await fixture([40, 100, 180]);
    const originals = [previous, candidate.image].map((image) => Buffer.from(image));
    const controller = new AbortController();
    expect(
      await classifyPetAppearanceImage(
        { ...candidate, previousImage: previous },
        controller.signal,
      ),
    ).toEqual(accepted);
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(model).toHaveBeenCalledTimes(1);
    expect(model).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({ modelId: OPENAI_REVIEW_MODEL }),
        providerOptions: { openai: { reasoningEffort: "none" } },
        maxRetries: 0,
        maxOutputTokens: 500,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: expect.any(String) },
              ...[previous, candidate.image].map(() => ({
                type: "file",
                data: expect.any(Buffer),
                mediaType: "image/png",
                providerOptions: { openai: { imageDetail: "high" } },
              })),
            ],
          },
        ],
      }),
    );
    const content = model.mock.calls[0]![0].messages?.[0]?.content;
    if (!Array.isArray(content)) throw new Error("Expected inspection images");
    const images = content.filter((part) => part.type === "file");
    for (const [index, image] of images.entries()) {
      if (!Buffer.isBuffer(image.data)) throw new Error("Expected PNG bytes");
      expect(await sharp(image.data).metadata()).toMatchObject({
        format: "png",
        width: 64,
        height: 64,
        hasAlpha: false,
      });
      const { data, info } = await sharp(image.data)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const pixel = (x: number, y: number) => [
        ...data.subarray(
          (y * info.width + x) * info.channels,
          (y * info.width + x) * info.channels + 3,
        ),
      ];
      expect(pixel(8, 8)).toEqual([208, 208, 208]);
      expect(pixel(24, 8)).toEqual([168, 168, 168]);
      expect(pixel(32, 32)).toEqual(index === 0 ? [40, 100, 180] : [32, 180, 96]);
    }
    expect([previous, candidate.image]).toEqual(originals);
    expect((await sharp(candidate.image).metadata()).hasAlpha).toBe(true);
    expect(await model.mock.calls[0]![0].output?.responseFormat).toEqual(
      await ai.Output.object({ schema: petAppearanceQualitySchema }).responseFormat,
    );
    const signal = model.mock.calls[0]![0].abortSignal;
    expect(signal).not.toBe(controller.signal);
    expect(signal?.aborted).toBe(false);
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });
});

const input = async () => ({
  image: await fixture(),
  species: "A nimble fox",
  identity: "Jade green with a star marking",
  rank: 2,
  previousRank: 2,
});

const fixture = async (color = [32, 180, 96]) => {
  const data = Buffer.alloc(64 * 64 * 4);
  for (let y = 16; y < 48; y++)
    for (let x = 24; x < 40; x++) data.set([...color, 255], (y * 64 + x) * 4);
  return sharp(data, { raw: { width: 64, height: 64, channels: 4 } })
    .webp({ lossless: true })
    .toBuffer();
};
