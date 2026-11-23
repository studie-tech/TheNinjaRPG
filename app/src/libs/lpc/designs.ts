import type { LpcBody, LpcMaterial } from "@/validators/lpc";
import { lpcAnimations } from "@/validators/lpc";
import type { LpcConfig } from "@/validators/lpcAsset";

/** Offer palettes only when the chosen artwork provides them on every requested body. */
export const lpcDesignColors = (
  config: LpcConfig,
  bodies: readonly LpcBody[] = ["male", "female"],
  material?: LpcMaterial,
) => {
  const colors = bodies.map((body) => {
    const required = (
      config.variants[`${body}/${config.defaultColor}/${config.defaultEyes}`] ?? []
    ).filter((sheet) => !material || sheet.material === material);
    return new Set(
      Object.entries(config.variants)
        .filter(
          ([key, sheets]) =>
            key.startsWith(`${body}/`) &&
            key.endsWith(`/${config.defaultEyes}`) &&
            required.length > 0 &&
            required.every((part) =>
              sheets.some((sheet) =>
                part.part
                  ? sheet.part === part.part && sheet.material === part.material
                  : !material || sheet.material === material,
              ),
            ),
        )
        .map(([key]) => key.split("/")[1]!),
    );
  });
  return [...(colors[0] ?? [])]
    .filter((color) => colors.every((set) => set.has(color)))
    .sort();
};

/** Display authored poses separately from the renderer's neutral-pose substitutions. */
export const lpcDesignCoverage = (
  config: LpcConfig,
  body: LpcBody,
  color = config.defaultColor,
  eyes = config.defaultEyes,
) => {
  const sheets =
    config.variants[`${body}/${color}/${eyes}`] ??
    config.variants[`${body}/${config.defaultColor}/${config.defaultEyes}`] ??
    [];
  const components = [...new Set(sheets.map((sheet) => sheet.component))];
  return lpcAnimations.map((animation) => ({
    animation,
    supplied:
      components.length > 0 &&
      components.every((component) =>
        sheets.some(
          (sheet) => sheet.component === component && !!sheet.layout.clips[animation],
        ),
      ),
  }));
};

/** Group silhouettes for staff browsing without relying on item names to select art. */
export const lpcDesignGroup = (config: LpcConfig) =>
  config.category !== "equipment"
    ? config.category
    : config.replacementSlots.some((slot) => ["shirt", "legs", "feet"].includes(slot))
      ? "clothing"
      : "equipment";
