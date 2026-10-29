import { z } from "zod";

export const lpcEquipmentProfiles = [
  "AUTO",
  "NONE",
  "bandana",
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
  "boomerang",
  "shield",
  "gem",
  "fan",
  "shuriken",
  "bracelet",
  "ring",
  "piercing",
] as const;
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
export const lpcBodyStyles = ["male", "female"] as const;
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
export type LpcDirection = 0 | 1 | 2 | 3;
export type SpriteLayer = {
  profile: string;
  color: string;
  eyes?: string;
  mirror?: boolean;
  slot?: string;
};
export type SpriteAppearance = { version: 1; body: LpcBody; layers: SpriteLayer[] };
export type SpriteAction = {
  id: string;
  animation: LpcAnimation;
  longitude: number;
  latitude: number;
};
