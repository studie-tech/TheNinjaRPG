import {
  CS_CARD_URL,
  IMG_KESSEN_MINIGAME_TILE,
  IMG_MANUAL_TOWER_UPGRADES,
} from "@/drizzle/constants";
import { ImageLinkGrid } from "@/layout/ImageLinkGrid";

/**
 * Every minigame as a tile that opens straight into play. The /minigames page (Wake
 * Island's Minigames building) and the manual's Minigames section both show it.
 */
export const MinigameGrid = ({ priority }: { priority?: boolean }) => (
  <ImageLinkGrid priority={priority} entries={MINIGAMES} />
);

const MINIGAMES = [
  {
    name: "towerDefense",
    label: "Tower Defense",
    img: IMG_MANUAL_TOWER_UPGRADES,
    href: "/towerDefense",
  },
  {
    name: "chakraStorm",
    label: "Chakra Storm",
    img: CS_CARD_URL,
    href: "/chakraStorm",
  },
  { name: "kessen", label: "Kessen", img: IMG_KESSEN_MINIGAME_TILE, href: "/kessen" },
];
