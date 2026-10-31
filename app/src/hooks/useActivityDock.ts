"use client";

import { useLocalStorage } from "@/hooks/localstorage";

/** Keep chat and activities on opposite sides, following the player's display preference. */
export function useActivityDock() {
  const [stored, setSwapSides] = useLocalStorage("swapChatAndActivity", false);
  const swapSides = stored === true;
  return { swapSides, setSwapSides };
}
