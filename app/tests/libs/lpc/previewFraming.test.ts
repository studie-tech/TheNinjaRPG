import { expect, it } from "bun:test";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import { buildLpcCatalog } from "@/libs/lpc/catalog";
import {
  CHARACTER_PREVIEW_HEIGHT,
  CHARACTER_PREVIEW_WIDTH,
  characterPreviewFraming,
} from "@/libs/lpc/previewFraming";
import { lpcAssets, lpcCatalog } from "../../setup/lpc";

it.each(["male", "female"] as const)("fills the portrait with the %s build", (body) => {
  const appearance = resolveSpriteAppearance({ spriteBodyStyle: body });
  const framing = characterPreviewFraming(lpcCatalog, appearance, "idle");
  expect(framing.scale).toBeGreaterThan(250);
  expect(framing.scale).toBeLessThanOrEqual(320);
  expect(framing.x).toBeGreaterThan(0);
  expect(framing.x).toBeLessThan(CHARACTER_PREVIEW_WIDTH);
  expect(framing.y).toBeGreaterThan(0);
  expect(framing.y).toBeLessThan(CHARACTER_PREVIEW_HEIGHT);
});

it("reserves space for an entire attack region, including the mirrored opposite hand", () => {
  const base = lpcAssets.find((asset) => asset.id === "spear")!.lpcConfig;
  const catalog = buildLpcCatalog([
    {
      id: "long-weapon",
      lpcConfig: {
        ...base,
        variants: {
          "male/gray/blue": [
            {
              image: "https://example.test/weapon.png",
              z: 1,
              layout: {
                cell: 192,
                columns: 4,
                pixelsPerUnit: 100,
                ground: { x: 80, y: 137 },
                clips: { thrust: [[0], [1], [2], [3]] },
                regions: {
                  thrust: {
                    x: 0,
                    y: 0,
                    columns: 4,
                    trim: { x: 5, y: 10, width: 180, height: 160 },
                  },
                },
              },
            },
          ],
        },
      },
    },
  ]);
  const appearance = {
    version: 1 as const,
    body: "male" as const,
    layers: [{ profile: "long-weapon", color: "gray", mirror: true }],
  };
  const framing = characterPreviewFraming(catalog, appearance, "thrust");
  // Source crop [5,185] around ground x80 becomes [-1.05,.75] when mirrored.
  expect(framing.x - 1.05 * framing.scale).toBeCloseTo(16);
  expect(framing.x + 0.75 * framing.scale).toBeCloseTo(240);
  const top = (10 - 137) / 100 + 28 / 64;
  const bottom = (170 - 137) / 100 + 28 / 64;
  expect(framing.y + top * framing.scale).toBeGreaterThanOrEqual(20);
  expect(framing.y + bottom * framing.scale).toBeLessThanOrEqual(300);
});

it("fits oversized weapons more loosely than the neutral outfit", () => {
  const appearance = resolveSpriteAppearance({ spriteBodyStyle: "female" });
  const plain = characterPreviewFraming(lpcCatalog, appearance, "slash");
  const armed = characterPreviewFraming(
    lpcCatalog,
    {
      ...appearance,
      layers: [
        ...appearance.layers,
        { profile: "spear", color: "gray", slot: "HAND_1" },
      ],
    },
    "slash",
  );
  expect(armed.scale).toBeLessThan(plain.scale);
});

it("fits the complete high-resolution animation even when its first pose has a narrow crop", () => {
  const base = lpcAssets.find((asset) => asset.id === "spear")!.lpcConfig;
  const ppu = 128000 / 381;
  const catalog = buildLpcCatalog([
    {
      id: "weapon",
      lpcConfig: {
        ...base,
        variants: {
          "male/gray/blue": [
            {
              image: "https://example.test/weapon.png",
              z: 1,
              layout: {
                cell: 640,
                columns: 1,
                pixelsPerUnit: ppu,
                clips: {
                  slash: [
                    [0, 1],
                    [0, 1],
                    [0, 1],
                    [0, 1],
                  ],
                },
                cells: [
                  { x: 1, y: 1, trim: { x: 318, y: 210, width: 6, height: 250 } },
                  { x: 10, y: 1, trim: { x: 14, y: 190, width: 610, height: 260 } },
                ],
              },
            },
          ],
        },
      },
    },
  ]);
  const frame = characterPreviewFraming(
    catalog,
    { version: 1, body: "male", layers: [{ profile: "weapon", color: "gray" }] },
    "slash",
  );
  expect(frame.x + ((14 - 320) / ppu) * frame.scale).toBeCloseTo(16);
  expect(frame.x + ((624 - 320) / ppu) * frame.scale).toBeCloseTo(240);
});
