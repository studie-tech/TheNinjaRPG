import { expect, it } from "bun:test";
import { resolveItemSprite, resolveSpriteAppearance } from "@/libs/lpc/appearance";
import { buildLpcCatalog, spriteLayerSheets } from "@/libs/lpc/catalog";
import { lpcDesignColors, lpcDesignCoverage } from "@/libs/lpc/designs";
import { importLpcRecipe } from "@/libs/lpc/recipe";
import { lpcConfigValidator } from "@/validators/lpcAsset";
import { customCharacterConfig } from "../../setup/customCharacters";
import { lpcAssets } from "../../setup/lpc";

const layeredDesign = () => {
  const source = customCharacterConfig("shirt");
  source.upstream = [
    {
      id: "test_shirt",
      name: "Test Shirt",
      group: "clothes",
      colors: [
        { label: "Fabric", group: "clothes", material: "cloth" },
        { label: "Trim", group: "clothes_trim", material: "trim" },
      ],
    },
  ];
  source.replacementSlots = ["shirt", "legs", "hair"];
  for (const [key, sheets] of Object.entries(source.variants)) {
    const sheet = sheets[0]!;
    source.variants[key] = [
      { ...sheet, part: "fabric", material: "cloth" },
      {
        ...sheet,
        layout: structuredClone(sheet.layout),
        image: `${sheet.image}trim`,
        part: "trim",
        material: "trim",
      },
    ];
  }
  return source;
};

it("inherits material channels independently, retaining explicit variant palettes", () => {
  const item = {
    lpcProfile: "coat",
    lpcColor: "red",
    lpcMaterialColors: { cloth: "blue", metal: "gold" },
  };
  expect(
    resolveItemSprite(item, {
      lpcMaterialColors: { cloth: null, metal: "silver", wood: "brown" },
    }),
  ).toEqual({
    profile: "coat",
    color: "red",
    materialColors: { cloth: "blue", metal: "silver", wood: "brown" },
  });
  expect(
    resolveSpriteAppearance({
      items: [
        {
          equipped: "CHEST",
          item,
          activeVariant: { lpcMaterialColors: { metal: "silver" } },
        },
      ],
    }).layers.find((layer) => layer.profile === "coat")?.materialColors,
  ).toEqual({ cloth: "blue", metal: "silver" });
});

it("selects each material's exact matching sheet part and preserves its movement companion on both bodies", () => {
  const config = layeredDesign();
  const catalog = buildLpcCatalog([{ id: "coat", lpcConfig: config }]);
  for (const body of ["male", "female"] as const) {
    const appearance = { version: 1 as const, body, layers: [] };
    const layer = {
      profile: "coat",
      color: "red",
      materialColors: { cloth: "blue", trim: "gold" },
    };
    const full = spriteLayerSheets(catalog, appearance, layer);
    expect(full[0]!.image).toBe(config.variants[`${body}/blue/blue`]![0]!.image);
    expect(full[1]!.image).toBe(config.variants[`${body}/gold/blue`]![1]!.image);
    expect(spriteLayerSheets(catalog, appearance, layer, "travel")).toEqual(
      full.map((sheet) => ({
        ...sheet.travel!,
        part: sheet.part,
        material: sheet.material,
      })),
    );
  }
});

it("offers only palettes available for both builds and identifies held animation fallbacks", () => {
  const config = layeredDesign();
  delete config.variants["female/red/blue"];
  expect(lpcDesignColors(config)).not.toContain("red");
  expect(lpcDesignColors(config, ["male"])).toContain("red");
  config.variants["female/gold/blue"]!.pop();
  expect(lpcDesignColors(config)).not.toContain("gold");
  expect(lpcDesignColors(config, ["male", "female"], "cloth")).toContain("gold");
  expect(lpcDesignColors(config, ["male", "female"], "trim")).not.toContain("gold");
  const sheet = config.variants["male/gray/blue"]![0]!;
  const onlyWalk = {
    ...config,
    variants: {
      ...config.variants,
      "male/gray/blue": [
        {
          ...sheet,
          layout: {
            ...sheet.layout,
            clips: { stand: sheet.layout.clips.stand!, walk: sheet.layout.clips.walk! },
          },
        },
      ],
    },
  };
  expect(
    lpcDesignCoverage(onlyWalk, "male").find((pose) => pose.animation === "spellcast")
      ?.supplied,
  ).toBe(false);
});

it("checks the material palettes rendered after base-eye fallback and retains exact requested eyes", () => {
  const config = layeredDesign();
  config.defaultColor = "blue";
  for (const body of ["male", "female"] as const) {
    for (const sheet of config.variants[`${body}/gold/blue`]!) {
      sheet.component = sheet.part;
      delete sheet.layout.clips.idle;
    }
    const catalog = buildLpcCatalog([{ id: "coat", lpcConfig: config }]);
    const appearance = { version: 1 as const, body, layers: [] };
    const layer = {
      profile: "coat",
      color: "gray",
      eyes: "green",
      materialColors: { cloth: "gold", trim: "gold" },
    };
    const fallback = spriteLayerSheets(catalog, appearance, layer);
    expect(fallback.map((sheet) => sheet.image)).toEqual(
      config.variants[`${body}/gold/blue`]!.map((sheet) => sheet.image),
    );
    expect(
      lpcDesignCoverage(config, body, "gray", "blue").find(
        (pose) => pose.animation === "idle",
      )?.supplied,
    ).toBe(true);
    expect(
      lpcDesignCoverage(config, body, "gray", "green", layer.materialColors).find(
        (pose) => pose.animation === "idle",
      )?.supplied,
    ).toBe(false);
    expect(
      spriteLayerSheets(catalog, appearance, layer, "travel").map(
        (sheet) => sheet.image,
      ),
    ).toEqual(fallback.map((sheet) => sheet.travel!.image));

    config.variants[`${body}/gray/green`] = structuredClone(
      config.variants[`${body}/gray/blue`]!,
    );
    config.variants[`${body}/gold/green`] = config.variants[`${body}/gold/blue`]!.map(
      (sheet) => ({ ...sheet, image: `${sheet.image}-green-eyes` }),
    );
    const exactCatalog = buildLpcCatalog([{ id: "coat", lpcConfig: config }]);
    expect(
      spriteLayerSheets(exactCatalog, appearance, layer).map((sheet) => sheet.image),
    ).toEqual(config.variants[`${body}/gold/green`]!.map((sheet) => sheet.image));
  }
});

it("uses fallback eyes for recipe material palettes when the requested base is unavailable", () => {
  const config = layeredDesign();
  config.defaultColor = "blue";
  config.upstream[0]!.colors.push({ label: "Eyes", group: "eyes", material: "eyes" });
  const result = importLpcRecipe(
    JSON.stringify({
      version: 2,
      bodyType: "male",
      selections: {
        fabric: { itemId: "test_shirt", subId: 0, recolor: "cloth.ulpc.gold" },
        eyes: { itemId: "test_shirt", subId: 2, recolor: "eye.ulpc.green" },
      },
    }),
    [{ id: "coat", hidden: false, lpcConfig: config }],
    { category: "equipment" },
  );
  for (const body of ["male", "female"] as const) {
    expect(result.config.variants[`${body}/gray/blue`]![0]!.image).toBe(
      config.variants[`${body}/gold/blue`]![0]!.image,
    );
    expect(result.config.variants[`${body}/gray/blue`]![1]!.image).toBe(
      config.variants[`${body}/blue/blue`]![1]!.image,
    );
  }
  expect(result.warnings).toEqual(
    ["male", "female"].map(
      (body) => `coat: blue/green is unavailable on ${body}; using its default.`,
    ),
  );
});

it("keeps imported outfit components separate when checking both full and movement breathing poses", () => {
  const config = layeredDesign();
  for (const sheets of Object.values(config.variants)) {
    sheets[0]!.component = "coat";
    sheets[1]!.component = "trim";
    delete sheets[1]!.layout.clips.idle;
  }
  const catalog = buildLpcCatalog([{ id: "outfit", lpcConfig: config }]);
  expect(
    lpcDesignCoverage(config, "female").find((pose) => pose.animation === "idle")
      ?.supplied,
  ).toBe(false);
  const movement = spriteLayerSheets(
    catalog,
    { version: 1, body: "female", layers: [] },
    { profile: "outfit", color: "gray" },
    "travel",
  );
  expect(movement.map((sheet) => sheet.component)).toEqual(["coat", "trim"]);
  const recipe = importLpcRecipe(
    JSON.stringify({
      version: 2,
      bodyType: "female",
      selections: { outfit: { itemId: "test_shirt" } },
    }),
    [{ id: "outfit", hidden: false, lpcConfig: config }],
    { category: "equipment" },
  );
  expect(
    new Set(recipe.config.variants["female/gray/blue"]!.map((sheet) => sheet.component))
      .size,
  ).toBe(2);
});

it("composes upstream recipes with exact definition IDs, material colours, replacement slots and attribution", () => {
  const config = layeredDesign();
  config.replacesBodyParts = ["torso", "upper-arms"];
  const result = importLpcRecipe(
    JSON.stringify({
      version: 2,
      bodyType: "female",
      selections: {
        fabric: { itemId: "test_shirt", subId: 0, recolor: "cloth.ulpc.blue" },
        trim: { itemId: "test_shirt", subId: 1, recolor: "cloth.ulpc.gold" },
        unsupported: { itemId: "unknown_head" },
      },
    }),
    [{ id: "coat", hidden: false, lpcConfig: config }],
    { category: "equipment" },
  );
  expect(result.body).toBe("female");
  expect(result.config.replacementSlots).toEqual(["shirt", "legs", "hair"]);
  expect(result.config.replacesBodyParts).toEqual(["torso", "upper-arms"]);
  expect(result.config.variants["female/gray/blue"]![0]!.image).toBe(
    config.variants["female/blue/blue"]![0]!.image,
  );
  expect(result.config.variants["female/gray/blue"]![1]!.image).toBe(
    config.variants["female/gold/blue"]![1]!.image,
  );
  expect(result.config.attributions).toEqual(config.attributions);
  expect(result.warnings).toEqual(["Unsupported artwork: unknown_head."]);
  expect(lpcConfigValidator.safeParse(result.config).success).toBe(true);
});

it("warns for requested material channels absent from the saved hair-tied sheets and retains their artwork", () => {
  const saved = importLpcRecipe(
    JSON.stringify({
      version: 2,
      bodyType: "male",
      selections: {
        hair: { itemId: "hair_long_tied", subId: 0, recolor: "hair.ulpc.black" },
      },
    }),
    lpcAssets,
    { category: "equipment" },
  );
  for (const tie of ["red", "blue"]) {
    const result = importLpcRecipe(
      JSON.stringify({
        version: 2,
        bodyType: "male",
        selections: {
          hair: { itemId: "hair_long_tied", subId: 0, recolor: "hair.ulpc.black" },
          tie: { itemId: "hair_long_tied", subId: 1, recolor: `cloth.ulpc.${tie}` },
        },
      }),
      lpcAssets,
      { category: "equipment" },
    );
    expect(result.warnings).toEqual(
      ["male", "female"].map(
        (body) =>
          `hair-tied: cloth colour ${tie} is unavailable on ${body}; using the saved palette.`,
      ),
    );
    expect(result.config).toEqual(saved.config);
  }
});

it("imports generator URL selections and refuses unsupported bodies and arbitrary hosts", () => {
  const designs = [{ id: "coat", hidden: false, lpcConfig: layeredDesign() }];
  const url =
    "https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/#sex=female&clothes=Test_Shirt_blue";
  expect(
    importLpcRecipe(url, designs, { category: "equipment" }).config.variants[
      "female/gray/blue"
    ]![0]!.image,
  ).toBe(designs[0]!.lpcConfig.variants["female/blue/blue"]![0]!.image);
  expect(() =>
    importLpcRecipe(url.replace("sex=female", "sex=child"), designs, {
      category: "equipment",
    }),
  ).toThrow("Other body types");
  expect(() =>
    importLpcRecipe(
      url.replace("liberatedpixelcup.github.io", "example.com"),
      designs,
      { category: "equipment" },
    ),
  ).toThrow("generator URL");
});
