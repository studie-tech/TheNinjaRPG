import {
  LPC_CONFIG_MAX_BYTES,
  lpcConfigValidator,
  type LpcConfig,
} from "@/validators/lpcAsset";
import { describe, expect, it } from "bun:test";
import { previewSpriteDesign, resolveSpriteAppearance } from "@/libs/lpc/appearance";
import { lpcLicenseUrl } from "@/libs/lpc/attribution";
import { lpcAssets } from "../../setup/lpc";

describe("LPC design preview and credits", () => {
  it("keeps a 256-variant design export within the settings import limit", () => {
    const source = lpcAssets.find((asset) => asset.id === "head-hard")!.lpcConfig;
    const variants: LpcConfig["variants"] = {};
    for (const body of ["male", "female"])
      for (let index = 0; index < 128; index++)
        variants[`${body}/color${index}/blue`] = source.variants[`${body}/light/blue`]!;
    const config = lpcConfigValidator.parse({
      ...source,
      defaultColor: "color0",
      variants,
    });
    const json = JSON.stringify(config);
    expect(Buffer.byteLength(json)).toBeLessThanOrEqual(LPC_CONFIG_MAX_BYTES);
    expect(lpcConfigValidator.parse(JSON.parse(json))).toEqual(config);
  });

  it.each(["head-soft", "head-sharp", "hair-long", "body"])(
    "replaces the corresponding base role when previewing %s",
    (id) => {
      const config = lpcAssets.find((asset) => asset.id === id)!.lpcConfig;
      const result = previewSpriteDesign(
        resolveSpriteAppearance({}),
        id,
        config,
        "black",
        "blue",
        false,
      );
      const role = config.category;
      expect(result.layers.filter((layer) => layer.profile === id)).toHaveLength(1);
      expect(
        result.layers.some((layer) => layer.slot === role && layer.profile !== id),
      ).toBe(false);
      expect(result.layers.some((layer) => layer.profile === "shirt")).toBe(true);
      if (role === "body" || role === "head")
        expect(
          result.layers
            .filter((layer) => layer.slot === "body" || layer.slot === "head")
            .every((layer) => layer.color === "black"),
        ).toBe(true);
    },
  );
  it("does not label original or custom artwork with a Creative Commons licence URL", () => {
    expect(lpcLicenseUrl("TNR")).toBeUndefined();
    expect(lpcLicenseUrl("Custom agreement")).toBeUndefined();
    expect(lpcLicenseUrl("CC-BY-SA 4.0")).toBe(
      "https://creativecommons.org/licenses/by-sa/4.0/",
    );
    for (const asset of lpcAssets)
      for (const credit of asset.lpcConfig.attributions)
        expect(lpcLicenseUrl(credit.chosenLicense)).toBeDefined();
  });
});
