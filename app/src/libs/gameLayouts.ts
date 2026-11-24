import {
  IMG_FRONTPAGE_SCREENSHOT_SECTOR,
  IMG_LAYOUT_CLASSIC_PREVIEW,
  IMG_LAYOUT_THEME_ART,
  IMG_PIXEL_HERO_POSTER,
} from "@/drizzle/constants";
import { bunnyImageUrl } from "@/utils/image";

/** Every selectable design has one identity across settings, public pages and the game. */
export const GAME_LAYOUTS = [
  {
    id: "default",
    name: "Classic",
    art: IMG_LAYOUT_CLASSIC_PREVIEW,
    audience: "Players who enjoy the traditional village setting",
    rationale:
      "Seasonal landscapes, illustrated scrolls and familiar navigation put the village at the center of the game.",
    composition:
      "Illustrated masthead with player and world sidebars around the main content scroll.",
    tone: "light",
    frame: "classic",
    publicFrame: "game",
    welcome: "classic",
    sidebarBreakpoint: 768,
    supportsColorMode: true,
    visualLanguage: "Illustrated village",
    welcomeTitle: "Your ninja journey begins here.",
    welcomeIntro:
      "Create your character and explore Seichi with a community of shinobi.",
  },
  {
    id: "pixel",
    name: "Pixel",
    art: IMG_PIXEL_HERO_POSTER,
    audience: "Players who enjoy pixel art and compact navigation",
    rationale:
      "A pixel-art landscape and crisp panels create a focused, atmospheric space for daily progression and community play.",
    composition:
      "Compact navigation above a three-column game frame, with an immersive welcome page.",
    tone: "dark",
    frame: "pixel",
    publicFrame: "landing",
    welcome: "pixel",
    sidebarBreakpoint: 768,
    supportsColorMode: false,
    visualLanguage: "Pixel landscape",
    welcomeTitle: "Enter a world of shinobi.",
    welcomeIntro: "Train, explore and build your story in a persistent ninja world.",
  },
  {
    id: "20-eclipse-observatory",
    art: IMG_LAYOUT_THEME_ART["20-eclipse-observatory"],
    name: "Eclipse Observatory",
    audience: "Endgame players and collectors of unusual aesthetics",
    rationale:
      "An orbital navigation frame and compact character column keep progression screens readable. Engraved curves and controlled violet contrast carry the celestial character without taking space from the game.",
    composition:
      "Compact header above the character and content columns, orbital navigation beside the character panel and a full-height world rail on the right.",
    tone: "dark",
    frame: "panel",
    publicFrame: "page",
    welcome: "illustrated",
    sidebarBreakpoint: 1100,
    supportsColorMode: false,
    visualLanguage: "Celestial engraving",
    welcomeTitle: "There is always another horizon.",
    welcomeIntro:
      "Discover another technique, another challenge, another possibility. Build a shinobi whose story is still unfolding in a world shared with other players.",
  },
  {
    id: "17-obsidian-council",
    art: IMG_LAYOUT_THEME_ART["17-obsidian-council"],
    name: "Obsidian Council",
    audience: "Kage, clan leaders and experienced strategists",
    rationale:
      "The council-room composition favors deliberate decision making. A restrained brass accent and low banner leave room for management screens; world systems occupy a prominent left rail and character information sits to the right.",
    composition:
      "Understated council masthead, left world directory, wide decision surface, right personal dossier, navigation aligned to content.",
    tone: "dark",
    frame: "panel",
    publicFrame: "page",
    welcome: "illustrated",
    sidebarBreakpoint: 1100,
    supportsColorMode: false,
    visualLanguage: "Lacquer and brass",
    welcomeTitle: "The next era needs its leaders.",
    welcomeIntro:
      "Join a village, build lasting alliances, and grow into the decisions that shape a community. Your journey can lead from the academy to something much larger.",
  },
  {
    id: "3-sakura-courtyard",
    art: IMG_LAYOUT_THEME_ART["3-sakura-courtyard"],
    name: "Sakura Courtyard",
    audience: "Social players and long-session readers",
    rationale:
      "A botanical editorial treatment gives the community a peaceful home. A generous reading column and softer lavender hierarchy support forum posts, inbox conversations and quest dialogue.",
    composition:
      "Horizontal top navigation, a slim character folio, a wide reading column and a slender world rail.",
    tone: "light",
    frame: "panel",
    publicFrame: "page",
    welcome: "illustrated",
    sidebarBreakpoint: 1100,
    supportsColorMode: false,
    visualLanguage: "Botanical editorial",
    welcomeTitle: "Find your place among the shinobi.",
    welcomeIntro:
      "Some journeys are remembered for their battles. Others, for the people along the way. Make friends, join a village, and write a character story of your own.",
  },
  {
    id: "sector",
    name: "Sector Layout",
    art: IMG_FRONTPAGE_SCREENSHOT_SECTOR,
    audience: "Players using the sector as their main game interface",
    rationale:
      "Explore a full-screen sector map and visit the Bank and Item Shop in dialogs. Other destinations open as pages through the game menu.",
    composition:
      "A full-height map with sliding sidebars, centered bottom shortcuts and building dialogs.",
    tone: "light",
    frame: "sector",
    publicFrame: "page",
    welcome: "illustrated",
    sidebarBreakpoint: null,
    supportsColorMode: true,
    visualLanguage: "Sector exploration",
    welcomeTitle: "Your next adventure is out there.",
    welcomeIntro:
      "Explore Seichi, train your shinobi and find your place in the village.",
  },
] as const;

export type GameLayout = (typeof GAME_LAYOUTS)[number];
export type GameLayoutId = GameLayout["id"];
export const DEFAULT_GAME_LAYOUT: GameLayoutId = "default";
export const GAME_LAYOUT_ATTRIBUTE = "data-game-layout";
export const GAME_LAYOUT_FRAME_ATTRIBUTE = "data-game-frame";

/** Normalize saved preferences to the canonical layout identity. */
export const toGameLayoutId = (value: unknown): GameLayoutId | undefined =>
  GAME_LAYOUTS.find(
    (layout) => layout.id === (value === "experimental" ? "sector" : value),
  )?.id;

export const getGameLayout = (id: GameLayoutId): GameLayout =>
  GAME_LAYOUTS.find((layout) => layout.id === id) ?? GAME_LAYOUTS[0];

export const GAME_LAYOUT_ART_STYLES = GAME_LAYOUTS.map(
  (layout) =>
    `html[data-game-layout="${layout.id}"]{--theme-art:url("${bunnyImageUrl(layout.art, 1536)}");--theme-art-mobile:url("${bunnyImageUrl(layout.art, 720)}")}`,
).join("");

/** A site's public default never replaces an explicit visitor preference. */
export const getWelcomeLayout = (
  value: unknown = process.env.NEXT_PUBLIC_WELCOME_LAYOUT,
): GameLayoutId => toGameLayoutId(value) ?? DEFAULT_GAME_LAYOUT;

/** The proxy chose the document's layout; set its design before hydration without changing shells. */
export const getGameLayoutScript = (id: GameLayoutId) => {
  const layout = getGameLayout(id);
  return `(function(){var dark=${layout.tone === "dark"};${layout.supportsColorMode ? 'try{dark=localStorage.getItem("theme")==="dark"}catch(e){}' : ""}document.documentElement.setAttribute("${GAME_LAYOUT_ATTRIBUTE}","${layout.id}");document.documentElement.setAttribute("${GAME_LAYOUT_FRAME_ATTRIBUTE}","${layout.frame}");document.documentElement.classList.toggle("dark",dark)})()`;
};

/** Prerender a character-only preference with Classic until its account is confirmed. */
export const getInitialGameLayout = (id: GameLayoutId): GameLayoutId =>
  id === "sector" ? DEFAULT_GAME_LAYOUT : id;
