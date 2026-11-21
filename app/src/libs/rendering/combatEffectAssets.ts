import type { GameAsset } from "@/drizzle/schema";
import type { GroundEffect } from "@/libs/combat/types";

/** Texture widths consumed by a combat asset's static artwork and clip uses. */
export const combatEffectRenditions = (
  asset: Pick<GameAsset, "id" | "frames">,
  effects: Partial<
    Pick<
      GroundEffect,
      | "staticAssetPath"
      | "groundStyle"
      | "staticAnimation"
      | "appearAnimation"
      | "disappearAnimation"
      | "projectileAnimation"
    >
  >[],
) => {
  const widths = new Set<number>();
  for (const effect of effects) {
    if (effect.staticAssetPath === asset.id)
      widths.add(
        effect.groundStyle === "DECAL" || effect.groundStyle === "SURFACE" ? 0 : 50,
      );
    if (
      [
        effect.staticAnimation,
        effect.appearAnimation,
        effect.disappearAnimation,
        effect.projectileAnimation,
      ].includes(asset.id)
    )
      widths.add(asset.frames > 1 ? 0 : 50);
  }
  // Built-in cues can have no authored tag in the masked battle catalog.
  return widths.size ? [...widths] : [asset.frames > 1 ? 0 : 50];
};
