import { expect, it } from "bun:test";
import sharp from "sharp";
import { lpcAtlasResources } from "@/libs/lpc/atlases";
import { buildLpcCatalog, spriteLayerSheets } from "@/libs/lpc/catalog";
import { validateLpcAtlas } from "@/libs/lpc/import";
import { lpcConfigValidator } from "@/validators/lpcAsset";

const layout = {
  cell: 128 as const,
  columns: 4,
  pixelsPerUnit: 128 as const,
  clips: { stand: [[0], [1], [2], [3]], walk: [[4], [5], [6], [7]] },
};
const atlas = (name: string) => ({
  image: `https://example.com/${name}.webp`,
  depth: `https://example.com/${name}-depth.png`,
  bodyRegions: true,
  z: 0,
  layout,
  palette: {
    channel: "skin" as const,
    images: {
      light: `https://example.com/${name}-light.webp`,
      black: `https://example.com/${name}-black.webp`,
    },
  },
});
const right = {
  ...atlas("right"),
  offhand: atlas("left"),
  travel: { ...atlas("travel"), offhand: atlas("travel-left") },
};
const config = lpcConfigValidator.parse({
  version: 2,
  category: "equipment",
  replacementSlots: [],
  replacesBodyParts: ["lower-arms"],
  defaultColor: "gray",
  defaultEyes: "blue",
  variants: { "male/gray/blue": [right], "female/gray/blue": [right] },
  attributions: [
    {
      authors: ["Fixture artist"],
      licenses: ["Commercial license"],
      chosenLicense: "Commercial license",
      urls: ["https://example.com/artwork"],
      notes: "",
    },
  ],
});

it("retains colour palettes, camera depth and region masks across full, travel and handed designs", () => {
  const resources = lpcAtlasResources(config);
  expect(resources).toHaveLength(16);
  expect(resources.filter((entry) => entry.numerical)).toHaveLength(4);
  const catalog = buildLpcCatalog([{ id: "sleeves", lpcConfig: config }]);
  catalog.designs.body = {
    category: "body",
    replacementSlots: [],
    defaultColor: "light",
    defaultEyes: "blue",
  };
  const layer = { profile: "sleeves", color: "gray" };
  const appearance = {
    version: 1 as const,
    body: "female" as const,
    layers: [{ profile: "body", color: "black" }, layer],
  };
  expect(catalog.designs.sleeves?.replacesBodyParts).toEqual(["lower-arms"]);
  for (const mode of ["all", "travel"] as const) {
    const sheet = spriteLayerSheets(catalog, appearance, layer, mode)[0]!;
    expect(sheet.image).toContain("-black.webp");
    expect(sheet.offhand?.image).toContain("-black.webp");
    expect(sheet.bodyRegions).toBe(true);
    expect(sheet.offhand?.bodyRegions).toBe(true);
    expect(catalog.layouts[sheet.layout]?.pixelsPerUnit).toBe(128);
  }
  expect(
    lpcConfigValidator.safeParse({ ...config, replacesBodyParts: ["legs", "legs"] })
      .success,
  ).toBe(false);
  expect(
    lpcConfigValidator.safeParse({
      ...config,
      variants: {
        ...config.variants,
        "male/gray/blue": [{ ...right, depth: undefined }],
      },
    }).success,
  ).toBe(false);
});

it("accepts raw RGB24 numerical pixels and rejects transparent or compressed depth", async () => {
  const source = Buffer.alloc(512 * 256 * 4);
  for (let i = 0; i < source.length; i += 4) source.set([126, 49, 18, 255], i);
  const encode = () => sharp(source, { raw: { width: 512, height: 256, channels: 4 } });
  await validateLpcAtlas(await encode().png().toBuffer(), layout, true);
  await expect(
    validateLpcAtlas(await encode().webp({ lossless: true }).toBuffer(), layout, true),
  ).rejects.toThrow("eight-bit PNG");
  source[3] = 254;
  await expect(
    validateLpcAtlas(await encode().png().toBuffer(), layout, true),
  ).rejects.toThrow("opaque alpha");
});

it("keeps independently selected material accents and both hands in movement mode", () => {
  const variants = Object.fromEntries(
    ["gray", "red"].flatMap((color) =>
      ["male", "female"].map((body) => [
        `${body}/${color}/blue`,
        [
          {
            ...atlas(`metal-${color}`),
            palette: undefined,
            part: "buckle",
            material: "metal",
            component: "jacket",
            travel: {
              ...atlas(`moving-metal-${color}`),
              palette: undefined,
              offhand: {
                ...atlas(`moving-left-metal-${color}`),
                palette: undefined,
              },
            },
          },
        ],
      ]),
    ),
  );
  const catalog = buildLpcCatalog([
    { id: "jacket", lpcConfig: lpcConfigValidator.parse({ ...config, variants }) },
  ]);
  const layer = {
    profile: "jacket",
    color: "gray",
    materialColors: { metal: "red" as const },
  };
  for (const body of ["male", "female"] as const) {
    const [sheet] = spriteLayerSheets(
      catalog,
      { version: 1, body, layers: [layer] },
      layer,
      "travel",
    );
    expect(sheet).toMatchObject({
      part: "buckle",
      material: "metal",
      component: "jacket",
      image: "https://example.com/moving-metal-red.webp",
      offhand: { image: "https://example.com/moving-left-metal-red.webp" },
    });
  }
});
