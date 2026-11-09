import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { UserRole } from "@/drizzle/constants";
import * as furnitureImage from "@/libs/furnitureImage";
import { itemRouter } from "@/server/api/routers/item";
import * as http from "@/utils/http";
import * as ssrf from "@/server/utils/ssrf";
import type { FurnitureGeometry } from "@/validators/itemFurniture";
import { resetServerModuleStubs, stubProfile } from "../../../setup/serverModules";
import { callerForDatabase } from "../../../setup/testDatabase";

const image = "https://ui0arpl8sm.ufs.sh/f/furniture.webp?width=128";
const geometry: FurnitureGeometry = {
  aspectRatio: 0.75,
  visibleBounds: { x: 10, y: 10, width: 70, height: 80 },
  footprint: { x: 10, y: 70, width: 70, height: 20 },
};
let role: UserRole = "CONTENT-ADMIN";
let isBanned = false;

beforeEach(() => {
  role = "CONTENT-ADMIN";
  isBanned = false;
  stubProfile("fetchUser", async () => ({ role, isBanned }));
  vi.spyOn(ssrf, "validateUrlForSsrf").mockResolvedValue(true);
  vi.spyOn(http, "fetchWithTimeout").mockResolvedValue(
    new Response(new Uint8Array([1, 2, 3])),
  );
  vi.spyOn(furnitureImage, "measureFurnitureImage").mockResolvedValue(geometry);
});

afterEach(() => {
  resetServerModuleStubs();
  vi.restoreAllMocks();
});

/** Inject only the account guard; image transport and decoding are tested through application contracts. */
const api = () => callerForDatabase(itemRouter, "content-staff", {} as never);

describe("content furniture image measurements", () => {
  it("measures the original upload through Bunny, without a resized rendition or redirects", async () => {
    const result = await api().getFurnitureImageGeometry({
      image,
      useFullFootprint: true,
    });
    expect(result).toMatchObject({
      success: true,
      image,
      useFullFootprint: true,
      geometry,
    });
    expect(ssrf.validateUrlForSsrf).toHaveBeenCalledWith(
      "https://uploadthing.b-cdn.net/f/furniture.webp",
    );
    expect(http.fetchWithTimeout).toHaveBeenCalledWith(
      "https://uploadthing.b-cdn.net/f/furniture.webp",
      { redirect: "error" },
    );
    expect(furnitureImage.measureFurnitureImage).toHaveBeenCalledWith(
      Buffer.from([1, 2, 3]),
      true,
    );
  });

  it.each([
    "https://example.com/f/furniture.webp",
    "https://uploadthing.b-cdn.net.evil.example/f/image.png",
    "http://uploadthing.b-cdn.net/f/image.png",
    "https://uploadthing.b-cdn.net:1234/f/image.png",
    "https://name:password@uploadthing.b-cdn.net/f/image.png",
  ])("rejects unsupported image URLs before any fetch: %s", async (url) => {
    const result = await api().getFurnitureImageGeometry({
      image: url,
      useFullFootprint: false,
    });
    expect(result.success).toBe(false);
    expect(result.geometry).toBeNull();
    expect(http.fetchWithTimeout).not.toHaveBeenCalled();
    expect(ssrf.validateUrlForSsrf).not.toHaveBeenCalled();
  });

  it.each(["USER", "MODERATOR"] as const)(
    "enforces content permission for %s",
    async (nextRole) => {
      role = nextRole;
      await expect(
        api().getFurnitureImageGeometry({ image, useFullFootprint: false }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(http.fetchWithTimeout).not.toHaveBeenCalled();
    },
  );

  it("rejects banned staff before fetching assets", async () => {
    isBanned = true;
    await expect(
      api().getFurnitureImageGeometry({ image, useFullFootprint: false }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(http.fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("honors shared SSRF validation", async () => {
    vi.spyOn(ssrf, "validateUrlForSsrf").mockResolvedValue(false);
    expect(
      (await api().getFurnitureImageGeometry({ image, useFullFootprint: false }))
        .success,
    ).toBe(false);
    expect(http.fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("returns a recoverable message for unreadable images", async () => {
    vi.spyOn(furnitureImage, "measureFurnitureImage").mockRejectedValue(
      new Error("Cutout is empty"),
    );
    const result = await api().getFurnitureImageGeometry({
      image,
      useFullFootprint: false,
    });
    expect(result.success).toBe(false);
    expect(result.geometry).toBeNull();
    expect(result.message).toContain("try again");
  });

  it("stops reading an oversized upload that declares no length", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.spyOn(http, "fetchWithTimeout").mockResolvedValue(new Response(body));
    const result = await api().getFurnitureImageGeometry({
      image,
      useFullFootprint: false,
    });
    expect(result).toMatchObject({
      success: false,
      message: "Furniture image is too large to measure",
      geometry: null,
    });
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThanOrEqual(13);
    expect(furnitureImage.measureFurnitureImage).not.toHaveBeenCalled();
  });

  it("measures an upload of exactly the size cap", async () => {
    const bytes = new Uint8Array(furnitureImage.FURNITURE_IMAGE_MAX_BYTES);
    vi.spyOn(http, "fetchWithTimeout").mockResolvedValue(new Response(bytes));
    expect(
      (await api().getFurnitureImageGeometry({ image, useFullFootprint: false }))
        .success,
    ).toBe(true);
    expect(furnitureImage.measureFurnitureImage).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized uploads before decoding", async () => {
    vi.spyOn(http, "fetchWithTimeout").mockResolvedValue(
      new Response(null, { headers: { "content-length": String(11 * 1024 * 1024) } }),
    );
    expect(
      (await api().getFurnitureImageGeometry({ image, useFullFootprint: false }))
        .success,
    ).toBe(false);
    expect(furnitureImage.measureFurnitureImage).not.toHaveBeenCalled();
  });
});
