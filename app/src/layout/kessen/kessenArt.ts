/**
 * Kessen artwork: Bunny rendition widths for card art and the shared table, back, pack
 * and emblem images. Card illustrations are 2:3 portraits cropped to the 5:7 card by
 * their focal point; every image is served from the media CDN through `utils/image.ts`.
 */
import {
  IMG_KESSEN_BOARD,
  IMG_KESSEN_CARD_BACK,
  IMG_KESSEN_CIRCUIT_MAP,
  IMG_KESSEN_EMBLEMS,
  IMG_KESSEN_HALL_HERO,
  IMG_KESSEN_LESSON_BG,
  IMG_KESSEN_LOGO,
  IMG_KESSEN_MINIGAME_TILE,
  IMG_KESSEN_NPC_PORTRAITS,
  IMG_KESSEN_PACKS,
  KESSEN_FIRST_BUNDLE_ITEM_ID,
} from "@/drizzle/constants";
import type { DeckFaction } from "@/libs/kessen/deck";
import { KESSEN_PACK_IDS, kessenVillagePackFaction } from "@/libs/kessen/packs";
import type { KessenCard } from "@/libs/kessen/types";
import { bunnyImageUrl } from "@/utils/image";
import type { KessenFaction } from "@/validators/itemCard";

/** Shared Kessen images, for pages that compose the table, hall and packs. */
export const KESSEN_IMAGES = {
  board: IMG_KESSEN_BOARD,
  cardBack: IMG_KESSEN_CARD_BACK,
  hallHero: IMG_KESSEN_HALL_HERO,
  logo: IMG_KESSEN_LOGO,
  circuitMap: IMG_KESSEN_CIRCUIT_MAP,
  lessonBg: IMG_KESSEN_LESSON_BG,
  minigameTile: IMG_KESSEN_MINIGAME_TILE,
  emblems: IMG_KESSEN_EMBLEMS,
  packs: IMG_KESSEN_PACKS,
  npcPortraits: IMG_KESSEN_NPC_PORTRAITS,
} as const;

/**
 * Rendition widths requested from Bunny. Snapping keeps the number of cached variants
 * small; the largest equals the 1024 px width of the card portraits, so no request
 * upscales them.
 */
export const KESSEN_ART_WIDTHS = [96, 160, 256, 384, 512, 768, 1024] as const;

/** Widths of the 1536 px landscape art (board, hall hero, Circuit map). */
const KESSEN_LANDSCAPE_WIDTHS = [...KESSEN_ART_WIDTHS, 1536] as const;

/** Smallest rendition width covering `cssWidth` at the given device pixel ratio. */
export const kessenRenditionWidth = (cssWidth: number, pixelRatio = 2) => {
  const wanted = Math.max(1, cssWidth) * pixelRatio;
  return KESSEN_ART_WIDTHS.find((width) => width >= wanted) ?? 1024;
};

/** Art URL with a Bunny width snapped to `KESSEN_ART_WIDTHS` (device pixels). */
export const kessenArtUrl = (src: string, width: number) =>
  bunnyImageUrl(src, KESSEN_ART_WIDTHS.find((entry) => entry >= width) ?? 1024);

/** Landscape art URL with a Bunny width snapped up to the 1536 px source width. */
export const kessenLandscapeUrl = (src: string, width: number) =>
  bunnyImageUrl(src, KESSEN_LANDSCAPE_WIDTHS.find((entry) => entry >= width) ?? 1536);

/** Emblem roundel of a faction. */
export const kessenEmblemUrl = (faction: KessenFaction) =>
  IMG_KESSEN_EMBLEMS[factionKey(faction)];

/**
 * Pack illustration for a pack item: the seed packs' own art for their ids
 * (`kessen-pack-village-*`, the First Bundle, the Lacquer Case), else the item's image when
 * the caller has it, which is how staff-created packs show their art.
 */
export const kessenPackArt = (packItemId: string, image?: string | null) => {
  const village = kessenVillagePackFaction(packItemId);
  if (village) return KESSEN_VILLAGE_PACK_ART[village];
  if (packItemId === KESSEN_FIRST_BUNDLE_ITEM_ID) return KESSEN_FIRST_BUNDLE_ART;
  if (packItemId === KESSEN_PACK_IDS.lacquer) return KESSEN_LACQUER_CASE_ART;
  if (image) return image;
  if (packItemId.includes("village")) return IMG_KESSEN_PACKS.village;
  if (packItemId.includes("lacquer")) return KESSEN_LACQUER_CASE_ART;
  if (packItemId.includes("forbidden")) return IMG_KESSEN_PACKS.forbidden;
  return IMG_KESSEN_PACKS.paper;
};

/** Illustration of a card: the portrait art, else the square item icon, else none. */
export const kessenCardArt = (card: Pick<KessenCardDisplay, "artUrl" | "image">) =>
  card.artUrl || card.image || null;

/** CSS `object-position` of a card's focal point (percent of the source image). */
export const kessenFocalPosition = (
  card: Pick<KessenCardDisplay, "focalX" | "focalY">,
) => `${clampPercent(card.focalX ?? 50)}% ${clampPercent(card.focalY ?? 35)}%`;

/** Zoom of a leader medallion: the 2:3 portrait at 220% of the disc width shows the head. */
export const KESSEN_MEDALLION_ZOOM = 2.2;

/**
 * Inline box of a medallion portrait: the 2:3 art scaled to `zoom` times the disc width
 * and shifted so the face sits at the disc centre, clamped so the art always covers the
 * disc. The face is the card's focal point unless `KESSEN_MEDALLION_FACES` places it.
 */
export const kessenMedallionCrop = (
  card: Pick<KessenCardDisplay, "id" | "focalX" | "focalY">,
) => {
  const face = KESSEN_MEDALLION_FACES[card.id];
  const zoom = face?.zoom ?? KESSEN_MEDALLION_ZOOM;
  const width = zoom * 100;
  const height = width * 1.5;
  const fx = clampPercent(face?.x ?? card.focalX ?? 50) / 100;
  const fy = clampPercent(face?.y ?? card.focalY ?? 20) / 100;
  const offset = (focal: number, size: number) =>
    Math.min(0, Math.max(100 - size, 50 - focal * size));
  return {
    width: `${round(width)}%`,
    height: `${round(height)}%`,
    left: `${round(offset(fx, width))}%`,
    top: `${round(offset(fy, height))}%`,
  };
};

/**
 * Leader portraits whose card focal point frames the figure rather than the face: the
 * face position (percent of the source image) and zoom their medallion uses instead.
 */
const KESSEN_MEDALLION_FACES: Record<string, MedallionFace> = {
  "kessen-leader-widow-of-the-waning-moon": { x: 47, y: 13 },
  "kessen-leader-the-hollow-conductor": { x: 51, y: 16 },
  "kessen-leader-amir-the-hoarder": { x: 34, y: 24 },
  "kessen-leader-frost-sovereign": { x: 53, y: 27 },
  "kessen-leader-kaze-no-seirei": { x: 45, y: 23, zoom: 2.6 },
};

/** Visual rarity tier; Forbidden variants are LEGENDARY items with their own treatment. */
export const kessenRarityTier = (
  card: Pick<KessenCardDisplay, "rarity" | "variant">,
): KessenRarityTier => (card.variant === "FORBIDDEN" ? "FORBIDDEN" : card.rarity);

/** Tokens are the only non-collectible units (boss leaders are non-collectible leaders). */
export const isKessenToken = (
  card: Pick<KessenCardDisplay, "kind" | "isCollectible">,
) => card.kind === "UNIT" && card.isCollectible === false;

/** Display names of the visual rarity tiers. */
export const KESSEN_RARITY_LABELS: Record<KessenRarityTier, string> = {
  COMMON: "Common",
  RARE: "Rare",
  EPIC: "Epic",
  LEGENDARY: "Legendary",
  FORBIDDEN: "Forbidden",
};

/**
 * Village Bundle artwork: the shared bundle dyed in the village colour, with the village
 * emblem pressed into its seal, so bundles stay distinct as small inventory icons.
 */
const KESSEN_VILLAGE_PACK_ART: Record<DeckFaction, string> = {
  SHIROHANA: "https://uploadthing.b-cdn.net/f/kessen-1f1_0-nYjH.webp",
  TSUKIMORI: "https://uploadthing.b-cdn.net/f/kessen-SVKwG2Ce-s.webp",
  HYORIN: "https://uploadthing.b-cdn.net/f/kessen-yDm1jUMOkc.webp",
  AKASUMI: "https://uploadthing.b-cdn.net/f/kessen-r4PWxLZddQ.webp",
  AKIKAZE: "https://uploadthing.b-cdn.net/f/kessen-CsvIw0g9m1.webp",
  SYNDICATE: "https://uploadthing.b-cdn.net/f/kessen-zZ6V8dvQyT.webp",
};

/**
 * First Bundle artwork: the Paper Bundle tied with an Epic-violet cord under a gold seal
 * pressed with the character for "first", so it never reads as an ordinary Paper Bundle.
 */
const KESSEN_FIRST_BUNDLE_ART =
  "https://uploadthing.b-cdn.net/f/kessen-DipdR7HMT4.webp";

/**
 * Lacquer Case artwork cut out of its grey backdrop with a soft cast shadow. The slim
 * case leaves most of the square empty, so the full-bleed item icon would show its
 * backdrop as a grey disc inside the round masks of the pack shelf and opening table.
 */
const KESSEN_LACQUER_CASE_ART =
  "https://uploadthing.b-cdn.net/f/kessen-eR6IUcMJdW.webp";

const factionKey = (faction: KessenFaction) =>
  faction.toLowerCase() as keyof typeof IMG_KESSEN_EMBLEMS;

const round = (value: number) => Math.round(value * 10) / 10;

const clampPercent = (value: number) =>
  Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 50;

/** Face position (percent of the source image) and zoom of a leader medallion. */
type MedallionFace = { x: number; y: number; zoom?: number };

/** Visual rarity tiers: the four item rarities plus the Forbidden variant. */
export type KessenRarityTier = KessenCard["rarity"] | "FORBIDDEN";

/**
 * Everything a card face renders: the engine fields plus display data. The catalog
 * entries served by the Kessen router satisfy this shape.
 */
export type KessenCardDisplay = Pick<
  KessenCard,
  | "id"
  | "name"
  | "rarity"
  | "kind"
  | "faction"
  | "row"
  | "power"
  | "provision"
  | "abilities"
  | "leaderBonus"
  | "variant"
  | "isCollectible"
> & {
  /** Portrait illustration (2:3 source, cropped to 5:7). */
  artUrl?: string | null;
  /** Square item icon, used when no portrait exists. */
  image?: string | null;
  focalX?: number | null;
  focalY?: number | null;
  flavor?: string | null;
  /** Title of a leader's ability (e.g. "Sunflare"). */
  abilityName?: string | null;
};
