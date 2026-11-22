import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Images } from "openai/resources/images";
import Replicate from "replicate";
import sharp from "sharp";
import { UTApi } from "uploadthing/server";
import {
  createThumbnail,
  fastTxt2imgReplicate,
  generateSpriteGPT,
  removeBackgroundReplicate,
  removeBackgroundToBuffer,
  toReplicateFile,
  txt2imgNanoBanana,
} from "@/libs/replicate";
import { restoreEnvAfterEach } from "../setup/env";

const upload = { data: { ufsUrl: "https://example.com/upload.webp" }, error: null };
let savedWindow: PropertyDescriptor | undefined;
restoreEnvAfterEach("UPLOADTHING_TOKEN");
beforeEach(() => {
  // Server SDK configuration still runs before the stubbed upload methods.
  savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Reflect.deleteProperty(globalThis, "window");
  process.env.UPLOADTHING_TOKEN = Buffer.from(
    JSON.stringify({
      apiKey: "sk_test_not_a_real_key",
      appId: "abort-test",
      regions: ["fra1"],
    }),
  ).toString("base64");
});
afterEach(() => {
  vi.restoreAllMocks();
  if (savedWindow) Object.defineProperty(globalThis, "window", savedWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

describe("createThumbnail", () => {
  it("publishes transparent AI thumbnails containing both the head and feet", async () => {
    const source = await sharp({
      create: { width: 64, height: 128, channels: 4, background: "#ff0000" },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 64, height: 64, channels: 4, background: "#0000ff" },
          })
            .png()
            .toBuffer(),
          top: 64,
          left: 0,
        },
      ])
      .png()
      .toBuffer();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(source));
    const uploading = vi
      .spyOn(UTApi.prototype, "uploadFiles")
      .mockResolvedValue(upload as never);
    expect(await createThumbnail("https://example.com/ai.png", "contain")).toBe(
      upload.data.ufsUrl,
    );
    const file = uploading.mock.calls[0]![0] as unknown as File;
    expect(file.type).toBe("image/png");
    const bytes = Buffer.from(await file.arrayBuffer());
    expect(await sharp(bytes).metadata()).toMatchObject({
      width: 64,
      height: 64,
      format: "png",
      hasAlpha: true,
    });
    const pixels = await sharp(bytes).raw().toBuffer();
    const at = (x: number, y: number) =>
      Array.from(pixels.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4));
    expect(at(32, 0)).toEqual([255, 0, 0, 255]);
    expect(at(32, 63)).toEqual([0, 0, 255, 255]);
    expect(at(0, 32)).toEqual([0, 0, 0, 0]);
  });
});

describe("image provider abort propagation", () => {
  it("returns an abort while the SDK remains stalled and never starts a paid fallback", async () => {
    const controller = new AbortController();
    const run = vi.spyOn(Replicate.prototype, "run").mockImplementation(async () => {
      controller.abort(new DOMException("Generation deadline reached", "TimeoutError"));
      return new Promise<object>(() => {});
    });
    const uploading = vi.spyOn(UTApi.prototype, "uploadFilesFromUrl");
    await expect(
      fastTxt2imgReplicate({ prompt: "A fox", signal: controller.signal }),
    ).rejects.toThrow("Generation deadline reached");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![1].signal).toBe(controller.signal);
    expect(uploading).not.toHaveBeenCalled();
  });

  it.each([undefined, "851-labs"] as const)(
    "does not dispatch a %s background-removal model with an already aborted signal",
    async (model) => {
      const run = vi.spyOn(Replicate.prototype, "run");
      await expect(
        removeBackgroundReplicate(
          "https://example.com/source.webp",
          AbortSignal.abort(),
          model,
        ),
      ).rejects.toThrow();
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("uses the same live signal for a genuine provider fallback and the upload", async () => {
    const controller = new AbortController();
    const file = { url: () => new URL("https://example.com/provider.webp") };
    const run = vi
      .spyOn(Replicate.prototype, "run")
      .mockRejectedValueOnce(new Error("Flux unavailable"))
      .mockResolvedValueOnce(file);
    const uploading = vi
      .spyOn(UTApi.prototype, "uploadFilesFromUrl")
      .mockResolvedValue(upload as never);
    await fastTxt2imgReplicate({ prompt: "A fox", signal: controller.signal });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]![0]).toBe("black-forest-labs/flux-schnell");
    expect(run.mock.calls[1]![0]).toBe("prunaai/p-image");
    expect(run.mock.calls.every((call) => call[1].signal === controller.signal)).toBe(
      true,
    );
    expect(uploading.mock.calls[0]![1]?.signal).toBe(controller.signal);
  });

  it.each([undefined, "851-labs"] as const)(
    "propagates an evolution signal through Nano Banana, %s background removal and upload",
    async (backgroundRemovalModel) => {
      const controller = new AbortController();
      const buffer = await sharp({
        create: { width: 64, height: 64, channels: 4, background: "transparent" },
      })
        .webp()
        .toBuffer();
      const file = {
        url: () => new URL("https://example.com/provider.webp"),
        blob: async () => new Blob([buffer as BlobPart]),
      };
      const run = vi.spyOn(Replicate.prototype, "run").mockResolvedValue(file);
      const uploading = vi
        .spyOn(UTApi.prototype, "uploadFiles")
        .mockResolvedValue(upload as never);
      expect(
        await txt2imgNanoBanana({
          preprompt: "Pixel art",
          prompt: "Evolve the same fox",
          previousImg: "https://example.com/previous.webp",
          removeBg: true,
          backgroundRemovalModel,
          userId: "owner",
          width: 512,
          height: 512,
          size: "square",
          signal: controller.signal,
        }),
      ).toEqual([upload.data.ufsUrl]);
      expect(run).toHaveBeenCalledTimes(2);
      expect(run.mock.calls[0]![0]).toBe("google/nano-banana");
      expect(String(run.mock.calls[1]![0])).toStartWith(
        backgroundRemovalModel === "851-labs"
          ? "851-labs/background-remover:"
          : "lucataco/remove-bg:",
      );
      expect(run.mock.calls[1]![1].input).toEqual(
        backgroundRemovalModel === "851-labs"
          ? {
              image: "https://example.com/provider.webp",
              threshold: 0.5,
              background_type: "rgba",
              format: "png",
            }
          : { image: "https://example.com/provider.webp" },
      );
      expect(run.mock.calls.every((call) => call[1].signal === controller.signal)).toBe(
        true,
      );
      expect(uploading.mock.calls[0]![1]?.signal).toBe(controller.signal);
    },
  );
});

describe("txt2imgNanoBanana", () => {
  it("keeps a generated scene intact when background removal is disabled", async () => {
    const buffer = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "white" },
    })
      .webp()
      .toBuffer();
    const file = {
      url: () => new URL("https://example.com/provider.webp"),
      blob: async () => new Blob([buffer as BlobPart]),
    };
    const run = vi.spyOn(Replicate.prototype, "run").mockResolvedValue(file);
    vi.spyOn(UTApi.prototype, "uploadFiles").mockResolvedValue(upload as never);
    expect(
      await txt2imgNanoBanana({
        preprompt: "Pixel art",
        prompt: "A forest",
        removeBg: false,
        backgroundRemovalModel: "851-labs",
        userId: "owner",
        width: 512,
        height: 512,
        size: "square",
      }),
    ).toEqual([upload.data.ufsUrl]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toBe("google/nano-banana");
  });
});

describe("generateSpriteGPT", () => {
  it("draws a GPT founder at the smallest square size with medium quality and native transparency", async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 4, background: "transparent" },
    })
      .png()
      .toBuffer();
    const generate = vi.spyOn(Images.prototype, "generate").mockResolvedValue({
      created: 0,
      data: [{ b64_json: png.toString("base64") }],
    } as never);
    const edit = vi.spyOn(Images.prototype, "edit");
    const controller = new AbortController();
    expect(
      await generateSpriteGPT({
        prompt: "A fox sprite",
        userId: "owner",
        signal: controller.signal,
      }),
    ).toEqual(png);
    expect(generate).toHaveBeenCalledWith(
      {
        model: "gpt-image-2.5-flare",
        prompt: "A fox sprite",
        size: "1024x1024",
        quality: "medium",
        background: "transparent",
        output_format: "png",
        n: 1,
        user: "owner",
      },
      { signal: controller.signal },
    );
    expect(edit).not.toHaveBeenCalled();
  });

  it("edits the supplied GPT reference and logs provider failures before rethrowing", async () => {
    const reference = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#f0f0f0" },
    })
      .png()
      .toBuffer();
    const error = new Error("Image provider unavailable");
    const edit = vi.spyOn(Images.prototype, "edit").mockRejectedValue(error);
    const generate = vi.spyOn(Images.prototype, "generate");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      generateSpriteGPT({ prompt: "Evolve the fox", reference, userId: "owner" }),
    ).rejects.toBe(error);
    expect(generate).not.toHaveBeenCalled();
    const [params, options] = edit.mock.calls[0]!;
    expect(params).toMatchObject({
      model: "gpt-image-2.5-flare",
      size: "1024x1024",
      quality: "medium",
      background: "transparent",
    });
    const image = params.image as File;
    expect(Buffer.from(await image.arrayBuffer())).toEqual(reference);
    expect(options).toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("generateSpriteGPT"),
      expect.objectContaining({ hasImageInput: true, prompt: "Evolve the fox" }),
    );
  });

  it("rejects a GPT response without image data", async () => {
    vi.spyOn(Images.prototype, "generate").mockResolvedValue({
      created: 0,
      data: [],
    } as never);
    await expect(
      generateSpriteGPT({ prompt: "A fox sprite", userId: "owner" }),
    ).rejects.toThrow("No output");
  });
});

describe("removeBackgroundToBuffer", () => {
  it("cuts out sprite bytes with 851-labs under the caller's signal", async () => {
    const controller = new AbortController();
    const source = Buffer.from("source");
    const result = Buffer.from("cutout");
    const run = vi
      .spyOn(Replicate.prototype, "run")
      .mockResolvedValue({ blob: async () => new Blob([result as BlobPart]) });
    expect(await removeBackgroundToBuffer(source, controller.signal)).toEqual(result);
    expect(String(run.mock.calls[0]![0])).toStartWith("851-labs/background-remover:");
    expect(run.mock.calls[0]![1]).toEqual({
      input: { image: source, threshold: 0.5, background_type: "rgba", format: "png" },
      signal: controller.signal,
    });
  });
});

describe("toReplicateFile", () => {
  const bytes = Buffer.from("image-bytes");
  const readBytes = async (blob: Blob) => Buffer.from(await blob.arrayBuffer());

  it("reads a FileOutput through its own blob and url without refetching", async () => {
    const fetching = vi.spyOn(globalThis, "fetch");
    const file = toReplicateFile({
      url: () => new URL("https://replicate.delivery/out.webp"),
      blob: async () => new Blob([bytes as BlobPart]),
    });
    expect(file?.url()).toBe("https://replicate.delivery/out.webp");
    expect(await readBytes(await file!.blob())).toEqual(bytes);
    expect(fetching).not.toHaveBeenCalled();
  });

  it.each([
    ["a URL string", "https://replicate.delivery/out.webp"],
    ["a URL object", new URL("https://replicate.delivery/out.webp")],
    [
      "an array of URL strings",
      ["https://replicate.delivery/out.webp", "https://x.y/z"],
    ],
    ["an object of URL strings", { image: "https://replicate.delivery/out.webp" }],
  ])("downloads %s under the caller's signal", async (_label, output) => {
    const fetching = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(bytes as BodyInit));
    const controller = new AbortController();
    const file = toReplicateFile(output, controller.signal);
    expect(file?.url()).toBe("https://replicate.delivery/out.webp");
    expect(await readBytes(await file!.blob())).toEqual(bytes);
    expect(fetching).toHaveBeenCalledWith("https://replicate.delivery/out.webp", {
      signal: controller.signal,
    });
  });

  it("takes the first file of an array of FileOutputs", async () => {
    const first = {
      url: () => new URL("https://a.test/1.png"),
      blob: async () => new Blob(),
    };
    const second = {
      url: () => new URL("https://a.test/2.png"),
      blob: async () => new Blob(),
    };
    expect(toReplicateFile([null, first, second])?.url()).toBe("https://a.test/1.png");
  });

  it("returns undefined for outputs without a file", () => {
    for (const output of [null, undefined, [], "", "not a url", 42, {}, [null, "x"]]) {
      expect(toReplicateFile(output)).toBeUndefined();
    }
  });

  it("rejects when a plain URL output cannot be downloaded", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("gone", { status: 404 }),
    );
    await expect(
      toReplicateFile("https://replicate.delivery/gone.webp")!.blob(),
    ).rejects.toThrow("Failed to download Replicate output (404)");
  });
});

describe("Replicate outputs that are not FileOutputs", () => {
  const webp = () =>
    sharp({ create: { width: 64, height: 64, channels: 3, background: "white" } })
      .webp()
      .toBuffer();

  it.each([
    ["a URL string", "https://replicate.delivery/nano.webp"],
    ["an array of URL strings", ["https://replicate.delivery/nano.webp"]],
  ])("uploads a Nano Banana image returned as %s", async (_label, output) => {
    const buffer = await webp();
    const fetching = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(buffer as BodyInit));
    vi.spyOn(Replicate.prototype, "run").mockResolvedValue(output as never);
    const uploading = vi
      .spyOn(UTApi.prototype, "uploadFiles")
      .mockResolvedValue(upload as never);
    expect(
      await txt2imgNanoBanana({
        preprompt: "Pixel art",
        prompt: "A forest",
        removeBg: false,
        userId: "owner",
        width: 512,
        height: 512,
        size: "square",
      }),
    ).toEqual([upload.data.ufsUrl]);
    expect(fetching.mock.calls[0]![0]).toBe("https://replicate.delivery/nano.webp");
    expect(uploading).toHaveBeenCalledTimes(1);
  });

  it("passes a URL-string Nano Banana output to background removal and reads its array result", async () => {
    const buffer = await webp();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(buffer as BodyInit));
    const run = vi
      .spyOn(Replicate.prototype, "run")
      .mockResolvedValueOnce("https://replicate.delivery/nano.webp" as never)
      .mockResolvedValueOnce(["https://replicate.delivery/cutout.png"] as never);
    vi.spyOn(UTApi.prototype, "uploadFiles").mockResolvedValue(upload as never);
    expect(
      await txt2imgNanoBanana({
        preprompt: "Pixel art",
        prompt: "A fox",
        removeBg: true,
        userId: "owner",
        width: 512,
        height: 512,
        size: "square",
      }),
    ).toEqual([upload.data.ufsUrl]);
    expect(run.mock.calls[1]![1].input).toEqual({
      image: "https://replicate.delivery/nano.webp",
    });
  });

  it("cuts out sprite bytes when 851-labs returns a URL string", async () => {
    const result = Buffer.from("cutout");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(result as BodyInit));
    vi.spyOn(Replicate.prototype, "run").mockResolvedValue(
      "https://replicate.delivery/cutout.png" as never,
    );
    expect(await removeBackgroundToBuffer(Buffer.from("source"))).toEqual(result);
  });

  it("rejects background removal without any file output", async () => {
    vi.spyOn(Replicate.prototype, "run").mockResolvedValue([] as never);
    await expect(removeBackgroundToBuffer(Buffer.from("source"))).rejects.toThrow(
      "No output from remove-bg model",
    );
  });

  it("uploads a fast preview from a URL-string fallback output", async () => {
    vi.spyOn(Replicate.prototype, "run")
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce("https://replicate.delivery/p-image.webp" as never);
    const uploading = vi
      .spyOn(UTApi.prototype, "uploadFilesFromUrl")
      .mockResolvedValue(upload as never);
    await fastTxt2imgReplicate({ prompt: "A fox" });
    expect(uploading.mock.calls[0]![0]).toMatchObject({
      url: "https://replicate.delivery/p-image.webp",
    });
  });
});
