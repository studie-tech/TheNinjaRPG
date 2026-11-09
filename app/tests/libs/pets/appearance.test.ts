import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import { Moderations } from "openai/resources/moderations";
import sharp from "sharp";
import { PET_RANKS } from "@/drizzle/constants";
import { PIXEL_ART_RENDERING } from "@/libs/imagePrompts";
import * as moderator from "@/libs/moderator";
import {
  downloadPetImage,
  generatePetAppearance,
  getPetAppearancePrompt,
} from "@/libs/pets/appearance";
import {
  PET_AURAS,
  PET_CHARACTERISTICS,
  PET_PALETTES,
  PET_RANK_APPEARANCES,
} from "@/libs/pets/catalogue";
import * as quality from "@/libs/pets/quality";
import * as replicate from "@/libs/replicate";
import { initialPetSpecies } from "./helpers/species";

const sourceUrl = "https://example.com/source-pet.webp";
const avatarUrl = "https://example.com/accepted-pet.webp";
const pet = {
  userId: "pet-owner",
  speciesId: "pet-species-0",
  species: initialPetSpecies[0]!,
  paletteIndex: 0,
  characteristicIndex: 0,
  auraIndex: 0,
  rank: 1,
  artRank: 0,
  avatar: null,
};
const acceptedQuality = {
  singleAnimal: true,
  anatomyCorrect: true,
  speciesMatches: true,
  completeBody: true,
  noGroundOrScene: true,
  identityPreserved: true,
  evolutionStronger: true,
  avatarFacing: "left" as const,
  reason: "A valid pet sprite",
};

let upload: ReturnType<typeof stubUpload>;
let review: ReturnType<typeof stubReview>;
let moderation: ReturnType<typeof stubModeration>;
beforeEach(() => {
  review = stubReview();
  moderation = stubModeration();
  upload = stubUpload();
});
afterEach(() => vi.restoreAllMocks());

describe("companion provider pipeline", () => {
  it("draws a GPT founder with native transparency, frames it and uploads only the accepted sprite", async () => {
    const gpt = vi
      .spyOn(replicate, "generateSpriteGPT")
      .mockResolvedValue(await cutout());
    const nano = vi.spyOn(replicate, "generateNanoBananaImage");
    const fallback = vi.spyOn(replicate, "removeBackgroundToBuffer");
    const owned: string[] = [];
    expect(
      await generatePetAppearance(pet, "GPT", async (url) => {
        owned.push(url);
      }),
    ).toEqual({ avatar: avatarUrl, avatarFacing: "left" });
    expect(gpt).toHaveBeenCalledTimes(1);
    const { prompt, reference, userId } = gpt.mock.calls[0]![0];
    expect(reference).toBeUndefined();
    expect(userId).toBe(pet.userId);
    expect(prompt).toContain("fully transparent background");
    expect(prompt).toContain(PIXEL_ART_RENDERING);
    expect(prompt).not.toContain("#f0f0f0");
    expect(nano).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
    const reviewed = review.mock.calls[0]![0].image;
    expect(await sharp(reviewed).metadata()).toMatchObject({
      format: "webp",
      width: 512,
      height: 512,
      hasAlpha: true,
    });
    expect(moderator.classifyNsfwImage).toHaveBeenCalledWith(
      expect.stringMatching(/^data:image\/webp;base64,/),
      true,
      expect.any(AbortSignal),
    );
    expect(upload).toHaveBeenCalledTimes(1);
    expect(
      Buffer.from(await upload.mock.calls[0]![1].arrayBuffer()).equals(reviewed),
    ).toBe(true);
    expect(owned).toEqual([avatarUrl]);
  });

  it("draws with Nano Banana and its 851-labs cutout when that provider is selected", async () => {
    const nano = vi
      .spyOn(replicate, "generateNanoBananaImage")
      .mockResolvedValue(await cutout());
    const gpt = vi.spyOn(replicate, "generateSpriteGPT");
    const controller = new AbortController();
    await generatePetAppearance(pet, "NANO_BANANA", async () => {}, controller.signal);
    expect(nano).toHaveBeenCalledWith(
      expect.objectContaining({
        previousImg: undefined,
        removeBg: true,
        backgroundRemovalModel: "851-labs",
        size: "square",
        signal: controller.signal,
        preprompt: expect.stringContaining(PIXEL_ART_RENDERING),
      }),
    );
    expect(nano.mock.calls[0]![0].prompt).toContain("#f0f0f0");
    expect(gpt).not.toHaveBeenCalled();
  });

  it.each([
    ["a semi-transparent haze", () => cutout(180, 1024, 30)],
    ["an opaque backdrop", () => opaqueImage(1024, "png")],
  ])(
    "cuts out a GPT sprite with %s using 851-labs on the neutral backdrop",
    async (_label, source) => {
      vi.spyOn(replicate, "generateSpriteGPT").mockResolvedValue(await source());
      const clean = await cutout(180, 1024);
      const fallback = vi
        .spyOn(replicate, "removeBackgroundToBuffer")
        .mockResolvedValue(clean);
      const controller = new AbortController();
      expect(
        await generatePetAppearance(pet, "GPT", async () => {}, controller.signal),
      ).toEqual({ avatar: avatarUrl, avatarFacing: "left" });
      expect(fallback).toHaveBeenCalledTimes(1);
      expect(fallback.mock.calls[0]![1]).toBe(controller.signal);
      expect(await sharp(fallback.mock.calls[0]![0]).metadata()).toMatchObject({
        format: "png",
        width: 1024,
        hasAlpha: false,
      });
      expect(upload).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects a GPT sprite whose fallback cutout still keeps its background", async () => {
    const opaque = await opaqueImage(1024, "png");
    vi.spyOn(replicate, "generateSpriteGPT").mockResolvedValue(opaque);
    vi.spyOn(replicate, "removeBackgroundToBuffer").mockResolvedValue(
      await cutout(180, 1024, 30),
    );
    await expect(generatePetAppearance(pet, "GPT", async () => {})).rejects.toThrow(
      "not removed cleanly",
    );
    expect(quality.classifyPetAppearanceImage).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects an opaque Nano Banana cutout without another cutout attempt", async () => {
    const opaque = await opaqueImage(128, "webp");
    const nano = vi
      .spyOn(replicate, "generateNanoBananaImage")
      .mockResolvedValue(opaque);
    const fallback = vi.spyOn(replicate, "removeBackgroundToBuffer");
    await expect(
      generatePetAppearance(pet, "NANO_BANANA", async () => {}),
    ).rejects.toThrow("transparent background");
    expect(nano).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
    expect(quality.classifyPetAppearanceImage).not.toHaveBeenCalled();
  });

  it("mirrors every accepted right-facing pixel without another model call before the single upload", async () => {
    const provider = vi
      .spyOn(replicate, "generateSpriteGPT")
      .mockResolvedValue(await cutout());
    vi.spyOn(quality, "classifyPetAppearanceImage").mockResolvedValue({
      ...acceptedQuality,
      avatarFacing: "right",
    });
    const controller = new AbortController();
    expect(
      await generatePetAppearance(pet, "GPT", async () => {}, controller.signal),
    ).toEqual({ avatar: avatarUrl, avatarFacing: "left" });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(
      "pet",
      expect.any(Blob),
      "webp",
      controller.signal,
    );
    const reviewed = await sharp(review.mock.calls[0]![0].image)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const mirrored = Buffer.from(await upload.mock.calls[0]![1].arrayBuffer());
    const { width, height } = reviewed.info;
    const expected = Buffer.alloc(reviewed.data.length);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const source = (y * width + width - 1 - x) * 4;
        expected.set(reviewed.data.subarray(source, source + 4), (y * width + x) * 4);
      }
    const pixels = await sharp(mirrored).ensureAlpha().raw().toBuffer();
    expect(pixels).toEqual(expected);
    expect(pixels).not.toEqual(reviewed.data);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it.each(["upload", "tracking"] as const)(
    "does not accept a sprite after its %s fails",
    async (stage) => {
      vi.spyOn(replicate, "generateSpriteGPT").mockResolvedValue(await cutout());
      if (stage === "upload")
        upload.mockResolvedValue({
          data: null,
          error: { message: "Storage unavailable" },
        } as never);
      const owned: string[] = [];
      await expect(
        generatePetAppearance(pet, "GPT", async (url) => {
          owned.push(url);
          throw new Error("Upload tracking failed");
        }),
      ).rejects.toThrow(
        stage === "upload" ? "Could not upload" : "Upload tracking failed",
      );
      expect(owned).toEqual(stage === "upload" ? [] : [avatarUrl]);
    },
  );

  it("tracks a completed upload before observing a cancellation", async () => {
    vi.spyOn(replicate, "generateSpriteGPT").mockResolvedValue(await cutout());
    const controller = new AbortController();
    upload.mockImplementation(async () => {
      controller.abort(new Error("Generation deadline reached"));
      return { data: { ufsUrl: avatarUrl }, error: null } as never;
    });
    const owned: string[] = [];
    await expect(
      generatePetAppearance(
        pet,
        "GPT",
        async (url) => {
          owned.push(url);
        },
        controller.signal,
      ),
    ).rejects.toThrow("Generation deadline reached");
    expect(owned).toEqual([avatarUrl]);
  });

  it("does not upload after the generation deadline expires during review", async () => {
    vi.spyOn(replicate, "generateSpriteGPT").mockResolvedValue(await cutout());
    const controller = new AbortController();
    vi.spyOn(quality, "classifyPetAppearanceImage").mockImplementation(async () => {
      controller.abort(new Error("Generation deadline reached"));
      return acceptedQuality;
    });
    await expect(
      generatePetAppearance(pet, "GPT", async () => {}, controller.signal),
    ).rejects.toThrow("Generation deadline reached");
    expect(upload).not.toHaveBeenCalled();
  });

  it("does not accept, correct or upload a candidate that fails moderation", async () => {
    const provider = vi
      .spyOn(replicate, "generateSpriteGPT")
      .mockResolvedValue(await cutout());
    vi.spyOn(moderator, "classifyNsfwImage").mockResolvedValue({
      isNsfw: true,
      reason: "Unsafe source",
    });
    await expect(generatePetAppearance(pet, "GPT", async () => {})).rejects.toThrow(
      "content review",
    );
    expect(provider).toHaveBeenCalledTimes(1);
    expect(quality.classifyPetAppearanceImage).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it.each(["GPT", "NANO_BANANA"] as const)(
    "sends %s an opaque neutral evolution reference while reviewing against the accepted pixels",
    async (provider) => {
      const previous = await cutout();
      stubDownload(previous);
      const gpt = vi
        .spyOn(replicate, "generateSpriteGPT")
        .mockResolvedValue(await cutout(80));
      const nano = vi
        .spyOn(replicate, "generateNanoBananaImage")
        .mockResolvedValue(await cutout(80));
      expect(
        await generatePetAppearance(
          { ...pet, rank: 2, artRank: 1, avatar: sourceUrl },
          provider,
          async () => {},
        ),
      ).toEqual({ avatar: avatarUrl, avatarFacing: "left" });
      const call = provider === "GPT" ? gpt.mock.calls[0]![0] : nano.mock.calls[0]![0];
      expect(call.prompt).toContain("SAME individual animal");
      await expectOpaqueReference(
        provider === "GPT"
          ? gpt.mock.calls[0]![0].reference
          : nano.mock.calls[0]![0].previousImg,
        previous,
      );
      expect(quality.classifyPetAppearanceImage).toHaveBeenCalledWith(
        expect.objectContaining({ previousImage: previous, rank: 2, previousRank: 1 }),
        expect.any(AbortSignal),
      );
    },
  );

  it("passes a same-rank redraw to review without treating it as another evolution", async () => {
    const buffer = await cutout();
    stubDownload(buffer);
    const edit = vi.spyOn(replicate, "generateSpriteGPT").mockResolvedValue(buffer);
    await generatePetAppearance(
      { ...pet, rank: 4, artRank: 4, avatar: sourceUrl },
      "GPT",
      async () => {},
    );
    expect(quality.classifyPetAppearanceImage).toHaveBeenCalledWith(
      expect.objectContaining({ rank: 4, previousRank: 4, previousImage: buffer }),
      expect.any(AbortSignal),
    );
    expect(edit.mock.calls[0]![0].prompt).toContain("Do not evolve");
    await expectOpaqueReference(edit.mock.calls[0]![0].reference, buffer);
  });

  it("redraws a founder's wrong species anatomy once from the framed candidate while keeping its traits", async () => {
    const species = initialPetSpecies.find((entry) => entry.name === "Crow")!;
    const crow = {
      ...pet,
      species,
      speciesId: species.id,
      paletteIndex: PET_PALETTES.find((entry) => entry.name === "Honey")!.index,
      characteristicIndex: PET_CHARACTERISTICS.find(
        (entry) => entry.name === "Bright eyes",
      )!.index,
      auraIndex: PET_AURAS.find((entry) => entry.name === "Lightning")!.index,
    };
    const edit = vi
      .spyOn(replicate, "generateSpriteGPT")
      .mockResolvedValue(await cutout());
    const review = vi
      .spyOn(quality, "classifyPetAppearanceImage")
      .mockResolvedValueOnce({
        ...acceptedQuality,
        speciesMatches: false,
        reason: "A baby chick instead of the requested crow",
      })
      .mockResolvedValueOnce(acceptedQuality);
    const controller = new AbortController();
    const owned: string[] = [];
    expect(
      await generatePetAppearance(
        crow,
        "GPT",
        async (url) => {
          owned.push(url);
        },
        controller.signal,
      ),
    ).toEqual({ avatar: avatarUrl, avatarFacing: "left" });
    expect(edit).toHaveBeenCalledTimes(2);
    const corrective = edit.mock.calls[1]![0];
    expect(corrective.signal).toBe(controller.signal);
    expect(corrective.prompt).toContain("A baby chick instead of the requested crow");
    expect(corrective.prompt).toContain(crow.species.description);
    expect(corrective.prompt).toContain("Evolution rank 1 of 10");
    for (const trait of [
      PET_PALETTES[crow.paletteIndex]!,
      PET_CHARACTERISTICS[crow.characteristicIndex]!,
      PET_AURAS[crow.auraIndex]!,
    ])
      expect(corrective.prompt).toContain(trait.description);
    // The rejected founder is the reference: framed to 512px and flattened on the neutral backdrop.
    expect(await sharp(corrective.reference!).metadata()).toMatchObject({
      format: "png",
      width: 512,
      height: 512,
      hasAlpha: false,
    });
    expect(review).toHaveBeenCalledTimes(2);
    expect(review.mock.calls[1]![1]).toBe(controller.signal);
    expect(moderator.classifyNsfwImage).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(owned).toEqual([avatarUrl]);
  });

  it("rejects a malformed founder after exactly one failed correction without uploading", async () => {
    const edit = vi
      .spyOn(replicate, "generateSpriteGPT")
      .mockResolvedValue(await cutout());
    vi.spyOn(quality, "classifyPetAppearanceImage").mockResolvedValue({
      ...acceptedQuality,
      singleAnimal: false,
      reason: "Two heads on one animal",
    });
    await expect(generatePetAppearance(pet, "GPT", async () => {})).rejects.toThrow(
      "Two heads",
    );
    expect(edit).toHaveBeenCalledTimes(2);
    expect(quality.classifyPetAppearanceImage).toHaveBeenCalledTimes(2);
    expect(upload).not.toHaveBeenCalled();
  });

  it.each(["unsafe", "opaque"] as const)(
    "does not accept an %s correction",
    async (failure) => {
      const edit = vi
        .spyOn(replicate, "generateNanoBananaImage")
        .mockResolvedValue(await cutout());
      vi.spyOn(quality, "classifyPetAppearanceImage").mockResolvedValueOnce({
        ...acceptedQuality,
        singleAnimal: false,
        reason: "Two heads on one animal",
      });
      if (failure === "unsafe") {
        vi.spyOn(moderator, "classifyNsfwImage")
          .mockResolvedValueOnce({ isNsfw: false, reason: "Safe cutout" })
          .mockResolvedValueOnce({ isNsfw: true, reason: "Unsafe correction" });
      } else {
        edit
          .mockResolvedValueOnce(await cutout())
          .mockResolvedValueOnce(await opaqueImage(128, "webp"));
      }
      await expect(
        generatePetAppearance(pet, "NANO_BANANA", async () => {}),
      ).rejects.toThrow(
        failure === "unsafe" ? "content review" : "transparent background",
      );
      expect(edit).toHaveBeenCalledTimes(2);
      expect(quality.classifyPetAppearanceImage).toHaveBeenCalledTimes(1);
      expect(upload).not.toHaveBeenCalled();
    },
  );

  it.each(["provider", "vision"] as const)(
    "does not start a correction after a %s failure",
    async (stage) => {
      const provider = vi
        .spyOn(replicate, "generateSpriteGPT")
        .mockResolvedValue(await cutout());
      const error = new Error(`${stage} unavailable`);
      if (stage === "provider") provider.mockRejectedValue(error);
      else vi.spyOn(quality, "classifyPetAppearanceImage").mockRejectedValue(error);
      await expect(generatePetAppearance(pet, "GPT", async () => {})).rejects.toBe(
        error,
      );
      expect(provider).toHaveBeenCalledTimes(1);
    },
  );

  it("does not start a correction after the generation deadline expires during review", async () => {
    const provider = vi
      .spyOn(replicate, "generateSpriteGPT")
      .mockResolvedValue(await cutout());
    const controller = new AbortController();
    vi.spyOn(quality, "classifyPetAppearanceImage").mockImplementation(async () => {
      controller.abort(new DOMException("Generation deadline reached", "TimeoutError"));
      return {
        ...acceptedQuality,
        singleAnimal: false,
        reason: "Two heads on one animal",
      };
    });
    await expect(
      generatePetAppearance(pet, "GPT", async () => {}, controller.signal),
    ).rejects.toThrow("Generation deadline reached");
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it.each([
    { check: "noGroundOrScene", reason: "A ground patch below the feet" },
    {
      check: "evolutionStronger",
      reason: "Only the edge glow changed; the animal does not look stronger",
    },
  ] as const)(
    "repairs a rejected evolution's $check once from its accepted reference",
    async ({ check, reason }) => {
      const previous = { ...pet, rank: 2, artRank: 1, avatar: sourceUrl };
      const reference = await cutout();
      stubDownload(reference);
      const edit = vi
        .spyOn(replicate, "generateSpriteGPT")
        .mockResolvedValue(await cutout(80));
      const review = vi
        .spyOn(quality, "classifyPetAppearanceImage")
        .mockResolvedValueOnce({ ...acceptedQuality, [check]: false, reason })
        .mockResolvedValueOnce(acceptedQuality);
      expect(await generatePetAppearance(previous, "GPT", async () => {})).toEqual({
        avatar: avatarUrl,
        avatarFacing: "left",
      });
      expect(previous.avatar).toBe(sourceUrl);
      expect(edit).toHaveBeenCalledTimes(2);
      expect(edit.mock.calls[1]![0].reference).toEqual(
        edit.mock.calls[0]![0].reference!,
      );
      await expectOpaqueReference(edit.mock.calls[1]![0].reference, reference);
      expect(edit.mock.calls[1]![0].prompt).toContain(reason);
      for (const [input] of review.mock.calls)
        expect(input).toMatchObject({
          previousImage: reference,
          previousRank: 1,
          rank: 2,
        });
      expect(upload).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects an evolution after its one repair still fails", async () => {
    stubDownload(await cutout());
    const edit = vi
      .spyOn(replicate, "generateSpriteGPT")
      .mockResolvedValue(await cutout());
    vi.spyOn(quality, "classifyPetAppearanceImage").mockResolvedValue({
      ...acceptedQuality,
      noGroundOrScene: false,
      reason: "A ground patch below the feet",
    });
    await expect(
      generatePetAppearance(
        { ...pet, rank: 2, artRank: 1, avatar: sourceUrl },
        "GPT",
        async () => {},
      ),
    ).rejects.toThrow("ground patch");
    expect(edit).toHaveBeenCalledTimes(2);
    expect(upload).not.toHaveBeenCalled();
  });

  it("accepts an evolution whose repair fails only the strength comparison and logs it without a Sentry issue", async () => {
    stubDownload(await cutout());
    const edit = vi
      .spyOn(replicate, "generateSpriteGPT")
      .mockResolvedValue(await cutout());
    const reason = "It does not look clearly stronger than the previous image";
    vi.spyOn(quality, "classifyPetAppearanceImage").mockResolvedValue({
      ...acceptedQuality,
      evolutionStronger: false,
      reason,
    });
    const captured = vi.spyOn(Sentry, "captureMessage").mockImplementation(() => "");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await generatePetAppearance(
        { ...pet, rank: 2, artRank: 1, avatar: sourceUrl },
        "GPT",
        async () => {},
      ),
    ).toEqual({ avatar: avatarUrl, avatarFacing: "left" });
    expect(edit).toHaveBeenCalledTimes(2);
    expect(captured).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("not judged clearly stronger"),
      expect.stringContaining(reason),
    );
  });

  it("still rejects a repair that fails the strength comparison and another check", async () => {
    stubDownload(await cutout());
    vi.spyOn(replicate, "generateSpriteGPT").mockResolvedValue(await cutout());
    vi.spyOn(quality, "classifyPetAppearanceImage").mockResolvedValue({
      ...acceptedQuality,
      evolutionStronger: false,
      identityPreserved: false,
      reason: "A different animal",
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      generatePetAppearance(
        { ...pet, rank: 2, artRank: 1, avatar: sourceUrl },
        "GPT",
        async () => {},
      ),
    ).rejects.toThrow("different animal");
    expect(warning).not.toHaveBeenCalled();
  });

  it("sends the framed WebP bytes through the moderation SDK", async () => {
    moderation.mockRestore();
    vi.spyOn(replicate, "generateSpriteGPT").mockResolvedValue(await cutout());
    const transport = vi.spyOn(Moderations.prototype, "create").mockImplementation(
      () =>
        Promise.resolve({
          results: [{ categories: {}, category_scores: {} }],
        }) as never,
    );
    expect(await generatePetAppearance(pet, "GPT", async () => {})).toEqual({
      avatar: avatarUrl,
      avatarFacing: "left",
    });
    expect(transport).toHaveBeenCalledTimes(1);
    const request = transport.mock.calls[0]![0];
    const input = Array.isArray(request.input) ? request.input[0] : null;
    if (!input || typeof input === "string" || input.type !== "image_url")
      throw new Error("Expected image moderation input");
    const dataUrl = input.image_url.url;
    expect(dataUrl.startsWith("data:image/webp;base64,")).toBe(true);
    expect(
      Buffer.from(dataUrl.split(",")[1]!, "base64").equals(
        review.mock.calls[0]![0].image,
      ),
    ).toBe(true);
    expect(transport.mock.calls[0]![1]).toEqual({
      signal: expect.any(AbortSignal),
      timeout: 30_000,
      maxRetries: 0,
    });
  });

  it("shares the job signal with the provider, moderation and review, combining it with each download timeout", async () => {
    const download = stubDownload(await cutout());
    const provider = vi
      .spyOn(replicate, "generateSpriteGPT")
      .mockResolvedValue(await cutout());
    const controller = new AbortController();
    await generatePetAppearance(
      { ...pet, rank: 2, artRank: 1, avatar: sourceUrl },
      "GPT",
      async () => {},
      controller.signal,
    );
    expect(provider).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(moderation.mock.calls.every((call) => call[2] === controller.signal)).toBe(
      true,
    );
    expect(quality.classifyPetAppearanceImage).toHaveBeenCalledWith(
      expect.any(Object),
      controller.signal,
    );
    const downloadSignal = download.mock.calls[0]![1]?.signal;
    expect(downloadSignal).not.toBe(controller.signal);
    expect(downloadSignal?.aborted).toBe(false);
    controller.abort();
    expect(downloadSignal?.aborted).toBe(true);
  });

  it.each(["GPT", "NANO_BANANA"] as const)(
    "does not dispatch %s when the job was already aborted",
    async (provider) => {
      const gpt = vi.spyOn(replicate, "generateSpriteGPT");
      const nano = vi.spyOn(replicate, "generateNanoBananaImage");
      await expect(
        generatePetAppearance(pet, provider, async () => {}, AbortSignal.abort()),
      ).rejects.toThrow();
      expect(gpt).not.toHaveBeenCalled();
      expect(nano).not.toHaveBeenCalled();
    },
  );

  it("fails closed on download errors, empty bodies and oversized declared responses", async () => {
    const download = vi.spyOn(globalThis, "fetch");
    download.mockResolvedValueOnce(new Response("Missing upload", { status: 404 }));
    await expect(
      downloadPetImage(sourceUrl, new AbortController().signal),
    ).rejects.toThrow("Could not download");
    download.mockResolvedValueOnce(new Response());
    await expect(
      downloadPetImage(sourceUrl, new AbortController().signal),
    ).rejects.toThrow("Could not download");
    download.mockResolvedValueOnce(new Response(new Uint8Array(0)));
    await expect(
      downloadPetImage(sourceUrl, new AbortController().signal),
    ).rejects.toThrow("empty");
    download.mockResolvedValueOnce(
      new Response(new Uint8Array(1), {
        headers: { "content-length": String(6 * 1024 * 1024) },
      }),
    );
    await expect(
      downloadPetImage(sourceUrl, new AbortController().signal),
    ).rejects.toThrow("too large");
  });

  it("cancels a streaming response that exceeds the byte budget despite an understated header", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, { headers: { "content-length": "1" } }),
    );
    await expect(
      downloadPetImage(sourceUrl, new AbortController().signal),
    ).rejects.toThrow("too large");
    expect(cancelled).toBe(true);
  });
});

/** A square, fully opaque white image: a sprite whose background was never removed. */
const opaqueImage = (size: number, format: "png" | "webp") =>
  sharp({ create: { width: size, height: size, channels: 3, background: "white" } })
    [format]()
    .toBuffer();
const stubReview = () =>
  vi.spyOn(quality, "classifyPetAppearanceImage").mockResolvedValue(acceptedQuality);

const stubModeration = () =>
  vi
    .spyOn(moderator, "classifyNsfwImage")
    .mockResolvedValue({ isNsfw: false, reason: "Safe" });

const stubUpload = () =>
  vi
    .spyOn(replicate, "uploadFileFromReplicate")
    .mockResolvedValue({ data: { ufsUrl: avatarUrl }, error: null } as never);

const stubDownload = (buffer: Buffer) =>
  vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => new Response(new Blob([buffer as BlobPart])));

/** Reference preparation must preserve the animal and make even enclosed alpha gaps unambiguous. */
const expectOpaqueReference = async (
  reference: Buffer | string | null | undefined,
  original: Buffer,
) => {
  if (typeof reference === "string") {
    expect(reference).toStartWith("data:image/png;base64,");
    reference = Buffer.from(reference.split(",")[1]!, "base64");
  }
  if (!reference) throw new Error("Expected a reference image");
  expect(await sharp(reference).metadata()).toMatchObject({
    format: "png",
    width: 128,
    height: 128,
    hasAlpha: false,
  });
  const pixels = await sharp(reference).raw().toBuffer();
  const originalPixels = await sharp(original).ensureAlpha().raw().toBuffer();
  for (const [x, y] of [
    [0, 0],
    [60, 60],
  ] as const) {
    expect([...pixels.subarray((y * 128 + x) * 3, (y * 128 + x) * 3 + 3)]).toEqual([
      240, 240, 240,
    ]);
    expect(originalPixels[(y * 128 + x) * 4 + 3]).toBe(0);
  }
  expect(pixels.subarray((30 * 128 + 50) * 3, (30 * 128 + 50) * 3 + 3)).toEqual(
    originalPixels.subarray((30 * 128 + 50) * 4, (30 * 128 + 50) * 4 + 3),
  );
};

/** A transparent cutout with an enclosed gap, scaled to the canvas size, over an optional faint haze. */
const cutout = async (red = 180, size = 128, hazeAlpha = 0) => {
  const unit = size / 128;
  const data = Buffer.alloc(size * size * 4);
  if (hazeAlpha) for (let i = 3; i < data.length; i += 4) data[i] = hazeAlpha;
  for (let y = 20 * unit; y < 110 * unit; y++)
    for (let x = 35 * unit; x < 95 * unit; x++) {
      if (y >= 50 * unit && y < 70 * unit && x >= 55 * unit && x < 65 * unit) continue;
      data[(y * size + x) * 4] = red;
      data[(y * size + x) * 4 + 3] = 255;
    }
  const image = sharp(data, { raw: { width: size, height: size, channels: 4 } });
  return size === 128 && !hazeAlpha
    ? image.webp({ lossless: true }).toBuffer()
    : image.png().toBuffer();
};

describe("companion appearance prompts", () => {
  it("uses authored rank-specific growth and reference preservation prompts", () => {
    const base = {
      userId: "player",
      speciesId: "pet-species-0",
      species: initialPetSpecies[0]!,
      paletteIndex: 0,
      characteristicIndex: 0,
      auraIndex: 0,
      rank: 1,
      artRank: 0,
      avatar: null,
    };
    const founder = getPetAppearancePrompt(base, "GPT");
    expect(founder.startsWith(`Full-body ${base.species.name} companion`)).toBe(true);
    expect(founder).toContain("natural adult proportions");
    const rankedPrompts = PET_RANKS.map(({ rank, name }) => {
      const prompt = getPetAppearancePrompt(
        { ...base, rank, artRank: rank - 1, avatar: "/previous.webp" },
        "GPT",
      );
      expect(prompt).toContain(`Evolution rank ${rank} of 10 (${name})`);
      expect(prompt).toContain(base.species.description);
      return prompt;
    });
    expect(new Set(rankedPrompts).size).toBe(10);
    const evolution = getPetAppearancePrompt(
      { ...base, rank: 2, artRank: 1, avatar: "/previous.webp" },
      "GPT",
    );
    expect(evolution).toContain("next evolution");
    expect(evolution).toContain("SAME individual animal");
    // Later ranks impress through refinement and may replace earlier features instead of stacking layers.
    expect(evolution).toContain("never through extra bulk");
    expect(evolution).toContain("you may simplify or remove clutter");
    expect(evolution).toMatch(
      /spiky or porcupine-like masses.*tails merged into the body.*wings, horns, extra limbs.*a smaller animal/,
    );
    expect(founder).toContain("Growth phase");
    expect(rankedPrompts[3]).toContain("Seasoned fighter phase");
    expect(rankedPrompts[6]).toContain("Ascended phase");
    expect(rankedPrompts[9]).toContain("Legendary apex");
    expect(rankedPrompts[9]).toContain("never bulkier, spikier or fluffier");
    const restyle = getPetAppearancePrompt(
      { ...base, rank: 2, artRank: 2, avatar: "/previous.webp" },
      "GPT",
    );
    expect(restyle).toContain("Do not evolve it, rank it up or age it");
    expect(restyle).toContain("Evolution rank 2 of 10");
    expect(restyle).not.toContain("next evolution");
    expect(() => getPetAppearancePrompt({ ...base, species: null }, "GPT")).toThrow(
      "Invalid pet appearance",
    );
    const retiredSpecies = {
      ...initialPetSpecies[0]!,
      name: "Spirit fox",
      description: "A fox with translucent ears",
      isActive: false,
    };
    expect(
      getPetAppearancePrompt({ ...base, species: retiredSpecies }, "GPT"),
    ).toContain(retiredSpecies.description);
  });

  it("applies staff species art direction and rank concepts, falling back to built-in milestones", () => {
    const kitsune = {
      ...initialPetSpecies[65]!,
      artDirection: "A white fox with flowing red-tipped flame tails.",
      rankConcepts: ["A slim white kit with two short flame-tipped tails", "", "  "],
    };
    const base = {
      userId: "player",
      speciesId: kitsune.id,
      species: kitsune,
      paletteIndex: 0,
      characteristicIndex: 0,
      auraIndex: 0,
      rank: 1,
      artRank: 0,
      avatar: null,
    };
    const founder = getPetAppearancePrompt(base, "GPT");
    expect(founder).toContain(
      `${kitsune.description}. Species art direction: A white fox with flowing red-tipped flame tails. Colour palette:`,
    );
    expect(founder).toContain(
      "(Companion): A slim white kit with two short flame-tipped tails. Tail stage:",
    );
    expect(founder).not.toContain(PET_RANK_APPEARANCES[0]);
    expect(founder).toContain("Keep all limbs inside the frame");
    // Blank, whitespace-only and missing entries keep the generic milestone for that rank.
    for (const rank of [2, 3, 4]) {
      const prompt = getPetAppearancePrompt(
        { ...base, rank, artRank: rank - 1, avatar: "/previous.webp" },
        "GPT",
      );
      expect(prompt).toContain(`: ${PET_RANK_APPEARANCES[rank - 1]}. Tail stage:`);
      expect(prompt).toContain("Species art direction: A white fox");
    }
    const plain = getPetAppearancePrompt(
      { ...base, species: { ...kitsune, artDirection: null, rankConcepts: [] } },
      "GPT",
    );
    expect(plain).not.toContain("Species art direction");
    expect(plain).toContain(PET_RANK_APPEARANCES[0]);
  });

  it("starts signature features small, grows tails to the full count by rank 7 and gates the aura glow", () => {
    const kitsune = {
      ...initialPetSpecies.find((entry) => entry.name === "Kitsune")!,
      artDirection: null,
      rankConcepts: [],
    };
    const base = {
      userId: "player",
      speciesId: kitsune.id,
      species: kitsune,
      paletteIndex: 0,
      characteristicIndex: 0,
      auraIndex: 0,
      rank: 1,
      artRank: 0,
      avatar: null,
    };
    const prompts = PET_RANKS.map(({ rank }) =>
      getPetAppearancePrompt(
        {
          ...base,
          rank,
          artRank: rank - 1,
          avatar: rank > 1 ? "/previous.webp" : null,
        },
        "GPT",
      ),
    );
    const tails = [
      "exactly ONE tail",
      "exactly TWO tails",
      "exactly THREE tails",
      "exactly FOUR tails",
      "exactly FIVE tails",
      "exactly SIX tails",
      "full number of tails",
      "full number of tails",
      "full number of tails",
      "full number of tails",
    ];
    tails.forEach((count, index) =>
      expect(prompts[index]).toContain(
        `Tail stage: ${index < 6 ? "this multi-tailed species has " : "it now shows its "}${count}`,
      ),
    );
    expect(prompts[0]).toContain("this overrides any tail count in its description");
    expect(prompts[1]).toContain("more tails than this rank's tail stage allows");
    expect(prompts[0]).toContain("only small, short beginnings");
    // Single-tailed species never see tail-count wording, which models otherwise apply to them.
    const wolfSpecies = {
      ...initialPetSpecies.find((entry) => entry.name === "Wolf")!,
      artDirection: null,
      rankConcepts: [],
    };
    const wolf = { ...base, speciesId: wolfSpecies.id, species: wolfSpecies };
    for (const { rank } of PET_RANKS) {
      const prompt = getPetAppearancePrompt(
        { ...wolf, rank, artRank: rank - 1, avatar: "/previous.webp" },
        "GPT",
      );
      expect(prompt).not.toContain("Tail stage");
      expect(prompt).not.toMatch(/\b(ONE|TWO|THREE|FOUR|FIVE|SIX) tails?\b/);
      expect(prompt).toContain("additional tails");
    }
    for (const concept of PET_RANK_APPEARANCES)
      expect(concept).not.toMatch(/multiple tails/i);
    for (const prompt of prompts.slice(0, 3)) {
      expect(prompt).toContain(
        "Aura stage: no aura effects yet, only plain natural colouring with no glowing, luminous or emissive markings",
      );
      expect(prompt).not.toContain("crisp luminous markings");
    }
    for (const prompt of prompts.slice(3, 6)) {
      expect(prompt).toContain("Aura stage: flat painted markings");
      expect(prompt).not.toContain("crisp luminous markings");
    }
    for (const prompt of prompts.slice(6))
      expect(prompt).toContain("Aura stage: crisp luminous markings");
    for (const concept of PET_RANK_APPEARANCES.slice(0, 6))
      expect(concept).not.toMatch(/glow|luminous/i);
    // Staff concepts replace the milestone but still follow the aura stage.
    const staff = getPetAppearancePrompt(
      {
        ...base,
        species: { ...kitsune, rankConcepts: ["A kit with one ember-tipped tail"] },
      },
      "GPT",
    );
    expect(staff).toContain(
      "A kit with one ember-tipped tail. Tail stage: this multi-tailed species has exactly ONE tail",
    );
    expect(staff).toContain("Aura stage: no aura effects yet");
  });

  it("asks GPT for native transparency and Nano Banana for the neutral cutout backdrop", () => {
    const base = {
      userId: "player",
      speciesId: "pet-species-0",
      species: initialPetSpecies[0]!,
      paletteIndex: 0,
      characteristicIndex: 0,
      auraIndex: 0,
      rank: 1,
      artRank: 0,
      avatar: null,
    };
    const gpt = getPetAppearancePrompt(base, "GPT");
    const nano = getPetAppearancePrompt(base, "NANO_BANANA");
    expect(gpt).toContain("fully transparent background");
    expect(gpt).not.toContain("#f0f0f0");
    expect(nano).toContain("uniform light gray (#f0f0f0) background");
  });
});
