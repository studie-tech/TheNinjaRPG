import { z } from "zod";

/** Equipment palettes supported by the bundled atlas selections and staff editors. */
export const lpcColors = [
  "black",
  "blue",
  "brown",
  "gray",
  "green",
  "orange",
  "purple",
  "red",
  "white",
  "yellow",
  "gold",
  "silver",
] as const;
/** Atlas body keys are independent of the player's gender selection. */
export const lpcBodyStyles = ["male", "female"] as const;
/** Independently coloured parts retain their authored silhouettes and alpha. */
export const lpcMaterials = ["cloth", "metal", "wood", "trim"] as const;
export const lpcColorValidator = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9_-]+$/);
export const lpcMaterialColorsValidator = z.partialRecord(
  z.enum(lpcMaterials),
  lpcColorValidator.nullable(),
);
export type LpcMaterial = (typeof lpcMaterials)[number];
export type LpcMaterialColors = z.infer<typeof lpcMaterialColorsValidator>;
/** Nullable variant fields inherit the item; unconfigured items have no equipment layer. */
export const lpcItemFields = z.object({
  lpcProfile: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .nullable()
    .default(null),
  lpcColor: lpcColorValidator.nullable().default(null),
  lpcMaterialColors: lpcMaterialColorsValidator.nullable().default(null),
});
export type LpcEquipmentProfile = string;
export type LpcColor = string;
export type LpcBody = (typeof lpcBodyStyles)[number];
/** Shared clip names for authored layouts, renderer playback and editor choices. */
export const lpcAnimations = [
  "stand",
  "idle",
  "combat",
  "walk",
  "slash",
  "thrust",
  "spellcast",
  "shoot",
  "hurt",
] as const;
export type LpcAnimation = (typeof lpcAnimations)[number];
/** Authored row order: north, west, south, east. */
export type LpcDirection = 0 | 1 | 2 | 3;
/** A visual layer; slot replaces base clothing and mirror flips off-hand equipment. */
export type SpriteLayer = {
  profile: string;
  color: string;
  eyes?: string;
  mirror?: boolean;
  slot?: string;
  materialColors?: LpcMaterialColors;
  /** Multiplied into the layer's artwork, for a colour the design has no palette of; tint its white one. */
  tint?: number;
};
/** Serializable public artwork recipe without raw inventory IDs, stats or content URLs. */
export type SpriteAppearance = { version: 1; body: LpcBody; layers: SpriteLayer[] };
/** An opaque cue ID retriggers repeated attacks without revealing the underlying action ID. */
export type SpriteAction = {
  id: string;
  animation: LpcAnimation;
  longitude: number;
  latitude: number;
};
