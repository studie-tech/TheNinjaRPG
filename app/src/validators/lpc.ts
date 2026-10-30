import { z } from "zod";

/** AUTO inherits the base item; NONE explicitly hides a worn item's visual layer. */
export const lpcEquipmentProfiles = [
  "AUTO",
  "NONE",
  "bandana",
  "headband",
  "wide-hat",
  "glasses",
  "hood",
  "mask",
  "crown",
  "helmet",
  "horns",
  "shirt",
  "robe",
  "leather",
  "plate",
  "chainmail",
  "cloak",
  "pants",
  "leggings",
  "legarmour",
  "skirt",
  "boots",
  "tabi",
  "sandals",
  "footarmour",
  "gloves",
  "armarmour",
  "belt",
  "sash",
  "necklace",
  "beads",
  "scarf",
  "sword",
  "katana",
  "dagger",
  "spear",
  "staff",
  "sickle",
  "axe",
  "hammer",
  "flail",
  "bow",
  "crossbow",
  "club",
  "trident",
  "whip",
  "boomerang",
  "shield",
  "gem",
  "fan",
  "shuriken",
  "bracelet",
  "ring",
  "piercing",
] as const;
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
/** Nullable variant fields inherit the item; unconfigured items have no equipment layer. */
export const lpcItemFields = z.object({
  lpcProfile: z.enum(lpcEquipmentProfiles).nullable().default(null),
  lpcColor: z.enum(lpcColors).nullable().default(null),
});
export type LpcEquipmentProfile = (typeof lpcEquipmentProfiles)[number];
export type LpcColor = (typeof lpcColors)[number];
export type LpcBody = (typeof lpcBodyStyles)[number];
export type LpcAnimation =
  | "idle"
  | "walk"
  | "slash"
  | "thrust"
  | "spellcast"
  | "shoot"
  | "hurt";
/** Authored row order: north, west, south, east. */
export type LpcDirection = 0 | 1 | 2 | 3;
/** A visual layer; slot replaces base clothing and mirror flips off-hand equipment. */
export type SpriteLayer = {
  profile: string;
  color: string;
  eyes?: string;
  mirror?: boolean;
  slot?: string;
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
