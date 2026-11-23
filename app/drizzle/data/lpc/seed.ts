import type { LpcMaterial } from "../../../src/validators/lpc";
import type { LpcConfig, LpcLayout } from "../../../src/validators/lpcAsset";
import { lpcConfigValidator } from "../../../src/validators/lpcAsset";
import source from "./catalog.json";
import credits from "./credits.json";

const catalog = source as unknown as {
  entries: Record<
    string,
    {
      image: string;
      z: number;
      layout: number;
      part?: string;
      material?: LpcMaterial;
      travel?: { image: string; z: number; layout: number };
    }[]
  >;
  layouts: LpcLayout[];
  revision: string;
  creditsUrl: string;
  upstream?: Record<string, LpcConfig["upstream"]>;
};

/** Stable IDs preserve saved item profiles and built-in character trait recipes. */
export const lpcSeedAssets = () => {
  const profiles = [
    ...new Set(Object.keys(catalog.entries).map((key) => key.split("/")[0]!)),
  ];
  const assets = profiles.map((profile) => {
    // Persist these recipe roles so runtime clothing replacement needs no source-path knowledge.
    const replacementSlot =
      (
        {
          shirt: "shirt",
          robe: "shirt",
          "shirt-short": "shirt",
          "shirt-sleeveless": "shirt",
          leather: "shirt",
          plate: "shirt",
          chainmail: "shirt",
          pants: "legs",
          leggings: "legs",
          boots: "feet",
          tabi: "feet",
          sandals: "feet",
          footarmour: "feet",
          bandana: "bandana",
          headband: "bandana",
          hood: "bandana",
          "hood-sack": "bandana",
          kerchief: "bandana",
          "headband-tied": "bandana",
          "bandana-bordered": "bandana",
          helmet: "bandana",
          "wide-hat": "bandana",
          crown: "bandana",
        } as Record<string, LpcConfig["replacementSlots"][number]>
      )[profile] ?? "none";
    const category: LpcConfig["category"] =
      profile === "body"
        ? "body"
        : profile.startsWith("head-")
          ? "head"
          : profile.startsWith("hair-")
            ? "hair"
            : profile.startsWith("beard-")
              ? "beard"
              : replacementSlot === "bandana" || profile === "horns"
                ? "headgear"
                : "equipment";
    const variants: LpcConfig["variants"] = {};
    for (const [key, sheets] of Object.entries(catalog.entries)) {
      if (!key.startsWith(`${profile}/`)) continue;
      variants[key.slice(profile.length + 1)] = sheets.map((sheet) => ({
        image: sheet.image,
        z: sheet.z,
        layout: catalog.layouts[sheet.layout] as LpcLayout,
        ...(sheet.part ? { part: sheet.part } : {}),
        ...(sheet.material ? { material: sheet.material } : {}),
        ...(sheet.travel
          ? {
              travel: {
                image: sheet.travel.image,
                z: sheet.travel.z,
                layout: catalog.layouts[sheet.travel.layout] as LpcLayout,
              },
            }
          : {}),
      }));
    }
    const config = lpcConfigValidator.parse({
      version: 2,
      upstream: catalog.upstream?.[profile] ?? [],
      category,
      replacementSlots: [
        ...(replacementSlot === "none" ? [] : [replacementSlot]),
        ...(["hood", "hood-sack", "helmet"].includes(profile) ? ["hair" as const] : []),
        ...(profile === "mask" ? ["beard" as const] : []),
      ],
      defaultColor: category === "body" || category === "head" ? "light" : "gray",
      defaultEyes: "blue",
      variants,
      attributions: credits.filter((credit) => credit.profile === profile),
      sourceRevision: catalog.revision,
      sourceUrl: `https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/tree/${catalog.revision}`,
    });
    return {
      id: profile,
      name: `LPC ${profile.replaceAll("-", " ")}`,
      type: "LPC" as const,
      image: Object.values(variants)[0]![0]!.image,
      url: catalog.creditsUrl,
      hidden: false,
      folder: "LPC",
      licenseDetails: [
        ...new Set(config.attributions.map((credit) => credit.chosenLicense)),
      ].join(", "),
      lpcConfig: config,
    };
  });
  for (const recipe of [
    {
      id: "outfit-shinobi",
      name: "Shinobi uniform",
      profiles: ["shirt", "pants", "sandals"],
    },
    { id: "hooded-cloak", name: "Hooded cloak", profiles: ["cloak", "hood"] },
    { id: "helmet-horned", name: "Horned helmet", profiles: ["helmet", "horns"] },
    { id: "hood-horned", name: "Horned hood", profiles: ["hood", "horns"] },
  ]) {
    const sources = recipe.profiles.map(
      (id) => assets.find((asset) => asset.id === id)!,
    );
    const first = sources[0]!;
    const variants: LpcConfig["variants"] = {};
    for (const key of Object.keys(first.lpcConfig.variants)) {
      if (!sources.every((asset) => asset.lpcConfig.variants[key])) continue;
      variants[key] = sources.flatMap((asset, component) =>
        asset.lpcConfig.variants[key]!.map((sheet, index) => ({
          ...sheet,
          part: `component_${component}_${index}`,
          component: `component_${component}`,
        })),
      );
    }
    const config = lpcConfigValidator.parse({
      ...first.lpcConfig,
      category: ["helmet-horned", "hood-horned"].includes(recipe.id)
        ? "headgear"
        : "equipment",
      replacementSlots: [
        ...new Set(sources.flatMap((asset) => asset.lpcConfig.replacementSlots)),
      ],
      variants,
      upstream: [],
      attributions: [
        ...new Map(
          sources
            .flatMap((asset) => asset.lpcConfig.attributions)
            .map((credit) => [JSON.stringify(credit), credit]),
        ).values(),
      ],
    });
    assets.push({
      ...first,
      id: recipe.id,
      name: `LPC ${recipe.name}`,
      lpcConfig: config,
    });
  }
  return assets;
};
