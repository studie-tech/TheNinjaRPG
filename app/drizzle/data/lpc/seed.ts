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
      travel?: { image: string; z: number; layout: number };
    }[]
  >;
  layouts: LpcLayout[];
  revision: string;
  creditsUrl: string;
};

/** Stable IDs preserve saved item profiles and built-in character trait recipes. */
export const lpcSeedAssets = () => {
  const profiles = [
    ...new Set(Object.keys(catalog.entries).map((key) => key.split("/")[0]!)),
  ];
  return profiles.map((profile) => {
    // Persist these recipe roles so runtime clothing replacement needs no source-path knowledge.
    const replacementSlot =
      (
        {
          shirt: "shirt",
          robe: "shirt",
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
          helmet: "bandana",
          "wide-hat": "bandana",
          crown: "bandana",
        } as Record<string, LpcConfig["replacementSlot"]>
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
      version: 1,
      category,
      replacementSlot,
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
};
