"use client";

import { useLocalStorage } from "@/hooks/localstorage";
import { isTutorialActive } from "@/libs/tutorial";
import { usePublicPathname } from "@/utils/routing";
import { useUserDataSelector } from "@/utils/UserContext";

/**
 * Keep chat and activities on opposite sides, following the player's display preference.
 * A tutorial fight's action bar starts at the field's left edge and leaves its right end
 * free, so there Activity takes the right and chat the left, whatever the preference.
 */
export function useActivityDock() {
  const [stored, setSwapSides] = useLocalStorage("swapChatAndActivity", false);
  const { data: isInTutorial } = useUserDataSelector(isTutorialActive);
  const prefersSwapSides = stored === true;
  const isSideFixed = usePublicPathname() === "/combat" && isInTutorial === true;
  return {
    swapSides: isSideFixed || prefersSwapSides,
    prefersSwapSides,
    isSideFixed,
    setSwapSides,
  };
}
