import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import { DrizzleQueryError, eq } from "drizzle-orm";
import JSZip from "jszip";
import * as uploadthing from "uploadthing/server";
import { towerDefenseCharacter, userData } from "@/drizzle/schema";
import { UPLOADTHING_HOST } from "@/libs/uploadthing";
import { towerDefenseRouter } from "@/server/api/routers/towerDefense";
import { DATABASE_FAILURE_MESSAGE } from "@/server/utils/mysqlErrors";
import * as ssrf from "@/server/utils/ssrf";
import { insertUsers } from "../../../setup/factories";
import { rateLimitResponse } from "../../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const zipUrl = `${UPLOADTHING_HOST}/f/character.zip`;

const directions = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

type MetadataFrames = {
  rotations: Record<string, string>;
  animations: Record<string, Record<string, string[]>>;
};

/** A full sprite sheet: the response schema requires every direction. */
const characterZip = async (
  frameCount: number,
  editFrames: (frames: MetadataFrames) => void = () => {},
) => {
  const zip = new JSZip();
  const frames = Array.from({ length: frameCount }, (_, i) => `frames/${i}.png`);
  for (const path of frames) zip.file(path, new Uint8Array([1]));
  zip.file("rotation.png", new Uint8Array([1]));
  const metadataFrames: MetadataFrames = {
    rotations: Object.fromEntries(directions.map((dir) => [dir, "rotation.png"])),
    animations: {
      walk: Object.fromEntries(
        directions.map((dir) => [
          dir,
          dir === "s" ? frames : ["frames/0.png", "frames/missing.png"],
        ]),
      ),
    },
  };
  editFrames(metadataFrames);
  zip.file("metadata.json", JSON.stringify({ frames: metadataFrames }));
  return zip.generateAsync({ type: "uint8array" });
};

describeWithDatabase("processCharacterZip", () => {
  const validate = () => vi.spyOn(ssrf, "validateUrlForSsrf").mockResolvedValue(true);
  const stubUploads = (uploadFiles: (files: File[]) => Promise<unknown>) => {
    const uploads = vi.fn(uploadFiles);
    vi.spyOn(
      uploadthing as unknown as { UTApi: () => uploadthing.UTApi },
      "UTApi",
    ).mockImplementation(
      () => ({ uploadFiles: uploads }) as unknown as uploadthing.UTApi,
    );
    return uploads;
  };
  const serveZip = (body: Uint8Array) =>
    vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        (async (_url: string, init?: RequestInit) =>
          rateLimitResponse(init) ?? new Response(Buffer.from(body))) as never,
      );
  const process = async () =>
    (await callerFor(towerDefenseRouter, "staff")).processCharacterZip({
      characterId: "character",
      zipUrl,
    });

  beforeEach(async () => {
    await resetTables(towerDefenseCharacter, userData);
    await insertUsers([{ userId: "staff", username: "Staff", role: "CONTENT" }]);
    const database = await getTestDatabase();
    await database.insert(towerDefenseCharacter).values({
      id: "character",
      name: "Character",
      assetConfig: null,
    } as typeof towerDefenseCharacter.$inferInsert);
  });
  afterEach(() => vi.restoreAllMocks());

  it("validates the zip against the UploadThing file prefix", async () => {
    serveZip(new Uint8Array());
    const validation = vi.spyOn(ssrf, "validateUrlForSsrf").mockResolvedValue(false);
    expect(await process()).toEqual({
      success: false,
      message: "Invalid or disallowed zipUrl",
    });
    expect(validation).toHaveBeenCalledWith(zipUrl, ["https://ui0arpl8sm.ufs.sh/f/"]);
  });

  it("uploads in batches of 20 and maps uploaded files onto animations", async () => {
    validate();
    const uploads = stubUploads(async (files) =>
      files.map((file) => ({
        data: { ufsUrl: `${UPLOADTHING_HOST}/f/${file.name}`, key: file.name },
      })),
    );
    serveZip(await characterZip(44));

    const result = await process();

    expect(uploads.mock.calls.map(([files]) => files.length)).toEqual([20, 20, 5]);
    expect(result).toMatchObject({
      success: true,
      message: "Processed 45 files and created asset config",
      availableAnimations: ["walk"],
    });
    expect(result.assetConfig?.rotations.north).toEndWith("rotation.png");
    const [animation] = result.assetConfig?.animations ?? [];
    expect(animation).toMatchObject({
      name: "walk",
      state: "idle",
      frameDurationMs: 100,
      loop: true,
    });
    expect(animation?.frames.south).toHaveLength(44);
    // Frames missing from the zip are dropped.
    expect(animation?.frames.north).toEqual([expect.stringContaining("frames_0.png")]);
    const stored = await (
      await getTestDatabase()
    ).query.towerDefenseCharacter.findFirst({
      where: eq(towerDefenseCharacter.id, "character"),
    });
    expect(stored?.assetConfig).toEqual(result.assetConfig);
  });

  it.each([
    [
      "an unknown direction",
      (frames: MetadataFrames) => {
        frames.rotations.up = "rotation.png";
      },
      'Invalid metadata.json rotations: unknown direction "up"',
    ],
    [
      "a direction given twice",
      (frames: MetadataFrames) => {
        frames.rotations.north = "rotation.png";
      },
      'Invalid metadata.json rotations: direction "north" is listed twice',
    ],
    [
      "an animation without every direction",
      (frames: MetadataFrames) => {
        delete frames.animations.walk?.nw;
      },
      "Invalid metadata.json animation walk: missing directions north-west",
    ],
    [
      "a rotation image outside the zip",
      (frames: MetadataFrames) => {
        frames.rotations.e = "missing.png";
      },
      "Rotation image missing.png is not in the zip file",
    ],
    [
      "an existing non-image rotation file",
      (frames: MetadataFrames) => {
        frames.rotations.e = "metadata.json";
      },
      "Rotation image metadata.json has an unsupported format",
    ],
    [
      "a directory used as a rotation image",
      (frames: MetadataFrames) => {
        frames.rotations.e = "frames/";
      },
      "Rotation image frames/ is not in the zip file",
    ],
  ])("rejects %s before uploading or saving", async (_label, editFrames, message) => {
    validate();
    const uploads = stubUploads(async () => []);
    serveZip(await characterZip(1, editFrames));
    expect(await process()).toEqual({ success: false, message });
    expect(uploads).not.toHaveBeenCalled();
    const stored = await (
      await getTestDatabase()
    ).query.towerDefenseCharacter.findFirst({
      where: eq(towerDefenseCharacter.id, "character"),
    });
    expect(stored?.assetConfig).toBeNull();
  });

  it("saves nothing when a rotation image fails to upload", async () => {
    validate();
    stubUploads(async (files) =>
      files.map((file) =>
        file.name === "rotation.png"
          ? { data: null, error: { message: "upload rejected" } }
          : { data: { ufsUrl: `${UPLOADTHING_HOST}/f/${file.name}`, key: file.name } },
      ),
    );
    serveZip(await characterZip(1));
    expect(await process()).toEqual({
      success: false,
      message: "Failed to upload rotation image rotation.png",
    });
    const stored = await (
      await getTestDatabase()
    ).query.towerDefenseCharacter.findFirst({
      where: eq(towerDefenseCharacter.id, "character"),
    });
    expect(stored?.assetConfig).toBeNull();
  });

  it("reports unexpected failures as a rejected response", async () => {
    validate();
    serveZip(await characterZip(1));
    stubUploads(async () => {
      throw new Error("upload broke");
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const report = vi.spyOn(Sentry, "captureException").mockReturnValue("event");
    expect(await process()).toEqual({
      success: false,
      message: "Failed to process zip: upload broke",
    });
    expect(logged).toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("reports a failed statement to Sentry and keeps it out of the response", async () => {
    validate();
    serveZip(await characterZip(1));
    const failure = new DrizzleQueryError(
      "update Character",
      ["secret"],
      new TypeError("fetch failed"),
    );
    stubUploads(async () => {
      throw failure;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const report = vi.spyOn(Sentry, "captureException").mockReturnValue("event");
    expect(await process()).toEqual({
      success: false,
      message: `Failed to process zip: ${DATABASE_FAILURE_MESSAGE}`,
    });
    expect(report).toHaveBeenCalledWith(failure, expect.anything());
  });
});
