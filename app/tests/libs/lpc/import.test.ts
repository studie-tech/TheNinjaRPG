import { describe, expect, it } from "bun:test";
import sharp from "sharp";
import { packLpcTravel, packStandardLpc, validateLpcAtlas } from "@/libs/lpc/import";
import { lpcConfigValidator } from "@/validators/lpcAsset";
import { lpcAssets } from "../../setup/lpc";

describe("LPC imports", () => {
  it("retains all existing design variants, custom poses and attribution", () => {
    expect(lpcAssets).toHaveLength(63);
    expect(
      lpcAssets.reduce(
        (sum, asset) => sum + Object.keys(asset.lpcConfig.variants).length,
        0,
      ),
    ).toBe(1566);
    for (const asset of lpcAssets)
      expect(lpcConfigValidator.safeParse(asset.lpcConfig).success).toBe(true);
  });

  it("requires the configured default variant for both bodies", () => {
    const config = structuredClone(
      lpcAssets.find((asset) => asset.id === "shirt")!.lpcConfig,
    );
    delete config.variants["female/gray/blue"];
    expect(lpcConfigValidator.safeParse(config).success).toBe(false);
  });

  it("packs standard poses and travel crops without changing any visible RGBA pixel", async () => {
    const width = 832,
      height = 1344,
      source = Buffer.alloc(width * height * 4);
    for (let row = 0; row < 21; row++)
      for (let column = 0; column < 13; column++) {
        const at = ((row * 64 + 30) * width + column * 64 + 20) * 4;
        source.set([row * 10, column * 15, 173, 127], at);
      }
    const bytes = await sharp(source, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    const packed = await packStandardLpc(bytes);
    await validateLpcAtlas(packed.bytes, packed.layout);
    const decoded = await sharp(packed.bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const stand = packed.layout.clips.stand![2]![0]!;
    const at =
      ((Math.floor(stand / 16) * 64 + 30) * decoded.info.width +
        (stand % 16) * 64 +
        20) *
      4;
    expect([...decoded.data.subarray(at, at + 4)]).toEqual([100, 0, 173, 127]);
    const travel = await packLpcTravel(packed.bytes, packed.layout);
    expect(travel).toBeDefined();
    await validateLpcAtlas(travel!.bytes, travel!.layout);
    expect(travel!.layout.trim).toEqual({ x: 20, y: 30, width: 1, height: 1 });
    const pixels = await sharp(travel!.bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const index = travel!.layout.clips.stand![2]![0]!,
      x = (index % travel!.layout.columns) * 3,
      y = Math.floor(index / travel!.layout.columns) * 3;
    for (let dy = 0; dy < 3; dy++)
      for (let dx = 0; dx < 3; dx++) {
        const offset = ((y + dy) * pixels.info.width + x + dx) * 4;
        expect([...pixels.data.subarray(offset, offset + 4)]).toEqual([
          100, 0, 173, 127,
        ]);
      }
    expect(Object.keys(travel!.layout.clips).sort()).toEqual(["stand", "walk"]);
  });

  it("rejects images whose dimensions do not match the declared frame layout", async () => {
    const bytes = await sharp({
      create: { width: 64, height: 64, channels: 4, background: "transparent" },
    })
      .png()
      .toBuffer();
    await expect(
      validateLpcAtlas(bytes, {
        cell: 64,
        columns: 1,
        clips: { stand: [[1], [1], [1], [1]] },
      }),
    ).rejects.toThrow("outside");
    await expect(packStandardLpc(bytes)).rejects.toThrow("13 columns");
  });

  it("rejects incomplete pixel data even when its dimensions fit the layout", async () => {
    const bytes = await sharp({
      create: { width: 64, height: 64, channels: 4, background: "red" },
    })
      .png()
      .toBuffer();
    const layout = {
      cell: 64 as const,
      columns: 1,
      clips: { stand: [[0], [0], [0], [0]] },
    };
    await expect(validateLpcAtlas(bytes, layout)).resolves.toBeUndefined();
    await expect(validateLpcAtlas(bytes.subarray(0, 100), layout)).rejects.toThrow();
  });
});
