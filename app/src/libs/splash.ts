import { IMG_MANUAL_REWARDS, IMG_MANUAL_TOWER_UPGRADES } from "@/drizzle/constants";
import type { SplashContent } from "@/validators/splash";

export const SPLASH_ID = "welcome";

/** The board has useful evergreen content before staff publish their first edition. */
export const DEFAULT_SPLASH: SplashContent = {
  name: "Village dispatch",
  description: "Your daily rewards, new adventures and offers from across Seichi.",
  image: "",
  enabled: true,
  startsAt: null,
  endsAt: null,
  cards: [
    {
      title: "Defend the village",
      body: "Face waves of raiders in Tower Defense. Build your defenses and train in the Guard Hall between runs.",
      image: IMG_MANUAL_TOWER_UPGRADES,
      href: "/towerDefense",
      linkLabel: "Play Tower Defense",
    },
    {
      title: "Visit the Market",
      body: "Browse reputation packs and bundles. Send a bundle to another player with Gift bundle; account limits apply to the recipient.",
      image: IMG_MANUAL_REWARDS,
      href: "/points",
      linkLabel: "Explore the Market",
    },
  ],
};

/** Scheduled editions stay out of the login dialog until their publication window. */
export const isSplashActive = (content: SplashContent, now = new Date()) =>
  content.enabled &&
  (!content.startsAt || new Date(content.startsAt) <= now) &&
  (!content.endsAt || new Date(content.endsAt) > now);
