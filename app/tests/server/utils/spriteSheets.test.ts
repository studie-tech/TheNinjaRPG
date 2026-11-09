import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import sharp from "sharp";
import { prepareSpriteSheetUrls } from "@/server/utils/spriteSheets";

const url = "https://utfs.io/f/source.webp";
const served = "https://uploadthing.b-cdn.net/f/source.webp";
const grid = { columns: 2, rows: 1, frameCount: 2 };
const png = (cell: number) =>
  sharp({
    create: { width: cell * 2, height: cell, channels: 4, background: "#ff0000" },
  })
    .png()
    .toBuffer();
const respond = (body: Buffer) =>
  vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((async () => new Response(new Uint8Array(body))) as never);

let uploaded = 0;
const upload = async () => `https://uploadthing.b-cdn.net/f/key-${++uploaded}`;
beforeEach(() => {
  uploaded = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("prepareSpriteSheetUrls", () => {
  it("never fetches a host outside our CDN", async () => {
    const fetched = vi.spyOn(globalThis, "fetch");
    const result = await prepareSpriteSheetUrls({
      ...grid,
      url: "http://169.254.169.254/latest",
    });
    expect(result.success).toBe(false);
    expect(fetched).not.toHaveBeenCalled();
  });

  it("refuses redirects so a sheet cannot point the server elsewhere", async () => {
    const fetched = respond(await png(128));
    await prepareSpriteSheetUrls({ ...grid, url }, upload);
    expect(fetched.mock.calls[0]?.[1]?.redirect).toBe("error");
  });

  it("reports an image that does not fit the grid before uploading", async () => {
    respond(await png(300));
    const result = await prepareSpriteSheetUrls({ ...grid, columns: 3, url }, upload);
    expect(result).toMatchObject({ success: false });
    expect(uploaded).toBe(0);
  });

  it("reports an unreadable image", async () => {
    respond(Buffer.from("not an image"));
    expect((await prepareSpriteSheetUrls({ ...grid, url }, upload)).success).toBe(
      false,
    );
  });

  it("uses a 128-pixel sheet for both sizes without uploading", async () => {
    respond(await png(128));
    expect(await prepareSpriteSheetUrls({ ...grid, url }, upload)).toEqual({
      success: true,
      url: served,
      smallUrl: served,
    });
    expect(uploaded).toBe(0);
  });

  it("keeps a 256-pixel sheet and adds a raw small version", async () => {
    respond(await png(256));
    expect(await prepareSpriteSheetUrls({ ...grid, url }, upload)).toEqual({
      success: true,
      url: served,
      smallUrl: "https://uploadthing.b-cdn.net/f/key-1",
    });
  });

  it("replaces a larger sheet, which the battle loader would reject", async () => {
    respond(await png(512));
    const result = await prepareSpriteSheetUrls({ ...grid, url }, upload);
    expect(uploaded).toBe(2);
    expect(result).toMatchObject({ success: true });
    if (result.success) {
      expect(result.url).not.toBe(served);
      expect(result.smallUrl).not.toBe(result.url);
    }
  });

  it("reports a failed upload instead of saving a partial sheet", async () => {
    respond(await png(256));
    const failing = async () => {
      throw new Error("storage down");
    };
    expect((await prepareSpriteSheetUrls({ ...grid, url }, failing)).success).toBe(
      false,
    );
  });
});
