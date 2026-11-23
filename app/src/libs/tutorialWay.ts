import { getTutorialStepPath, TUTORIAL_WAKE_SECTOR } from "@/libs/tutorial";

/** The next move towards a lesson's page: the control to press, and what Lemu says of it. */
export type TutorialWay = {
  elementIds: string[];
  action: string;
  /** Said where the lesson has no words of its own for the way. */
  lead: string;
  /** The control stands in the main or location menu, which phones keep in the game menu. */
  isInGameMenu: boolean;
  /** Where the control leads, for a player who cannot find it. */
  href: string;
};

/**
 * The next move from `pathname` to a lesson's page through the game's own menus and
 * buildings, so the player learns the way instead of being taken. Undefined for a page
 * with no such way, or when they are already there.
 */
export const getTutorialWay = (info: {
  page: string;
  /** The page the step's own control leads to, which tells whose village page it needs. */
  arrivesAt?: string;
  pathname: string;
  /** The sector the player stands in, and their village. */
  sector: number | undefined;
  village: { name: string; sector: number } | null | undefined;
  hasUnassignedExperience: boolean;
}): TutorialWay | undefined => {
  const { pathname, sector, village, hasUnassignedExperience } = info;
  const path = getTutorialStepPath(info.page);
  if (path === pathname && path !== "/village") return undefined;
  if (path === "/travel")
    return menuWay("travel", "Travel", "The map will show us where to go.");
  if (path === "/profile")
    return menuWay("profile", "Profile", "Your profile keeps all of this.");
  if (path === "/profile/experience") {
    if (hasUnassignedExperience)
      return {
        elementIds: ["tutorial-unassigned-stats"],
        action: "Tap Assign XP.",
        lead: "Your experience still waits under <b>Assign XP</b>.",
        isInGameMenu: true,
        href: path,
      };
    return pathname === "/profile"
      ? {
          elementIds: ["tutorial-level-up-btn", "tutorial-level-up-dashboard"],
          action: "Tap Level up!",
          lead: "You have earned a level, and your profile says so.",
          isInGameMenu: false,
          href: path,
        }
      : menuWay("profile", "Profile", "You have earned a level. Let's take it.");
  }
  const building = BUILDINGS[path];
  if (!building && path !== "/village") return undefined;
  // Only the Bondkeepers' sanctuary stands on Wake Island; the rest are in the village.
  const place = (building ?? BUILDINGS[info.arrivesAt ?? ""])?.isOnWakeIsland
    ? { name: "Wake Island", sector: TUTORIAL_WAKE_SECTOR }
    : village;
  if (!place || (path === pathname && sector === place.sector)) return undefined;
  if (sector !== place.sector)
    return pathname === "/travel"
      ? {
          elementIds: ["tutorial-Global"],
          action: `Travel to ${place.name} on the Global map.`,
          lead: `We are far from <b>${place.name}</b>. The <b>Global</b> map takes us there.`,
          isInGameMenu: false,
          href: `/travel?sector=${place.sector}`,
        }
      : menuWay(
          "travel",
          "Travel",
          `We are far from <b>${place.name}</b>. Let's travel there first.`,
        );
  if (building && pathname === "/village")
    return {
      elementIds: [`tutorial-${path.slice(1)}`],
      action: `Tap ${building.name}.`,
      lead: `Next stop: the <b>${building.name}</b>.`,
      isInGameMenu: false,
      href: path,
    };
  return {
    elementIds: ["tutorial-village"],
    action: `Tap ${place.name} in the location menu.`,
    lead: building
      ? `Next stop: the <b>${building.name}</b>. The <b>location menu</b> leads to every building around you.`
      : "The <b>location menu</b> leads to every building around you.",
    isInGameMenu: true,
    href: "/village",
  };
};

/** The buildings lessons take place in, by route and by the name on the village page. */
const BUILDINGS: Partial<Record<string, { name: string; isOnWakeIsland?: boolean }>> = {
  "/academy": { name: "Academy" },
  "/traininggrounds": { name: "Training Grounds" },
  "/itemshop": { name: "Item shop" },
  "/battlearena": { name: "Battle Arena" },
  "/ramenshop": { name: "Ramen Shop" },
  "/pets": { name: "Bondkeeper Sanctuary", isOnWakeIsland: true },
};

const menuWay = (
  route: "travel" | "profile",
  name: string,
  lead: string,
): TutorialWay => ({
  elementIds: [`tutorial-${route}`],
  action: `Tap ${name} in the main menu.`,
  lead,
  isInGameMenu: true,
  href: `/${route}`,
});
