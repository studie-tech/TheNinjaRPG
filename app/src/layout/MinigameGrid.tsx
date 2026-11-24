import {
  CS_CARD_URL,
  IMG_KESSEN_MINIGAME_TILE,
  IMG_MANUAL_TOWER_UPGRADES,
} from "@/drizzle/constants";
import { ImageLinkGrid } from "@/layout/ImageLinkGrid";
import Link from "@/layout/Link";

/**
 * Every minigame as a tile that opens straight into play. The /minigames page (Wake
 * Island's Minigames building) and the manual's Minigames section both show it.
 */
export const MinigameGrid = ({ priority }: { priority?: boolean }) => (
  <ImageLinkGrid priority={priority} entries={MINIGAMES}>
    <Link
      href="/minigames/shinobi-struggle"
      className="flex min-w-0 flex-col items-center"
    >
      <span
        className="grid aspect-square w-[125px] max-w-full place-items-center rounded-2xl border-2 border-amber-300 bg-slate-900 text-6xl text-amber-200 hover:opacity-50"
        aria-hidden="true"
      >
        忍
      </span>
      <p className="wrap-break-word w-full">Shinobi Struggle</p>
    </Link>
  </ImageLinkGrid>
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
