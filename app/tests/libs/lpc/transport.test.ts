import { expect, it } from "bun:test";
import superjson from "superjson";
import { buildLpcCatalog } from "@/libs/lpc/catalog";
import {
  packLpcCatalog,
  packLpcDesigns,
  unpackLpcCatalog,
  unpackLpcDesigns,
} from "@/libs/lpc/transport";
import { lpcConfigValidator } from "@/validators/lpcAsset";
import { lpcAssets } from "../../setup/lpc";

const layout = {
  cell: 128,
  columns: 1,
  pixelsPerUnit: 100,
  ground: { x: 64, y: 105 },
  clips: { stand: [[0], [0], [0], [0]], walk: [[0], [0], [0], [0]] },
  regions: {
    stand: {
      x: 16,
      y: 8,
      columns: 1,
      trim: { x: 30, y: 20, width: 40, height: 80 },
    },
    walk: {
      x: 16,
      y: 8,
      columns: 1,
      trim: { x: 30, y: 20, width: 40, height: 80 },
    },
  },
};
const atlas = (name: string) => ({
  image: `https://example.test/${name}.webp`,
  depth: `https://example.test/${name}.png`,
  z: 4,
  bodyRegions: true,
  layout,
  palette: {
    channel: "skin",
    images: { light: `https://example.test/${name}.webp` },
  },
});
const config = lpcConfigValidator.parse({
  ...lpcAssets[0]!.lpcConfig,
  variants: {
    "male/gray/blue": [
      {
        ...atlas("right"),
        part: "sleeve",
        material: "cloth",
        component: "coat",
        offhand: atlas("left"),
        travel: { ...atlas("moving"), offhand: atlas("moving-left") },
      },
    ],
    "female/gray/blue": [{ ...atlas("female"), travel: atlas("moving-female") }],
  },
  defaultColor: "gray",
  defaultEyes: "blue",
});

it("round-trips regions, zero-valued palette indices, numerical masks and both-hand movement poses", () => {
  const catalog = buildLpcCatalog([{ id: "coat", lpcConfig: config }]);
  const packed = JSON.parse(JSON.stringify(packLpcCatalog(catalog)));
  expect(unpackLpcCatalog(packed)).toEqual(catalog);
  expect(unpackLpcCatalog(packed)).toBe(unpackLpcCatalog(packed));
  const sheet = unpackLpcCatalog(packed).entries["coat/male/gray/blue"]![0]!;
  expect(sheet.palette).toBe(0);
  expect(sheet.travel?.offhand?.depth).toBe("https://example.test/moving-left.png");
});

it("retains drafts, row metadata and complete editable settings through tRPC serialization", () => {
  const rows = [
    { id: "coat", hidden: true, createdAt: new Date(0), lpcConfig: config },
    { id: "draft", hidden: false, createdAt: new Date(10), lpcConfig: null },
  ];
  const delivered = superjson.parse<ReturnType<typeof packLpcDesigns>>(
    superjson.stringify(packLpcDesigns(rows)),
  );
  expect(unpackLpcDesigns(delivered)).toEqual(rows);
});

it("rejects missing images and cyclic atlas references before constructing a character", () => {
  const catalog = buildLpcCatalog([{ id: "coat", lpcConfig: config }]);
  const missing = packLpcCatalog(catalog);
  missing.images = [];
  expect(() => unpackLpcCatalog(missing)).toThrow("Missing character image");
  const cyclic = packLpcCatalog(catalog);
  cyclic.sheets[0]!.offhand = 0;
  expect(() => unpackLpcCatalog(cyclic)).toThrow("Missing character atlas");
});

it("keeps the complete bundled discovery and scene responses within function payload headroom", () => {
  const scene = packLpcCatalog(buildLpcCatalog(lpcAssets));
  const designs = packLpcDesigns(lpcAssets);
  expect(unpackLpcDesigns(designs)).toEqual(lpcAssets);
  // Leave room for tRPC and SuperJSON envelopes below the 4.5 MB response limit.
  for (const payload of [scene, designs])
    expect(Buffer.byteLength(superjson.stringify(payload))).toBeLessThan(4_000_000);
});
