import { useLocalStorage } from "@/hooks/localstorage";

export const SHOW_DAY_NIGHT_MAP_OVERLAYS_KEY = "showDayNightMapOverlays";

/**
 * Cached preference for day/night map shading overlays.
 * Defaults to true so existing users keep current behavior.
 */
export const useDayNightMapOverlays = () => {
  const [showDayNightMapOverlays, setShowDayNightMapOverlays] =
    useLocalStorage<boolean>(SHOW_DAY_NIGHT_MAP_OVERLAYS_KEY, true);
  return { showDayNightMapOverlays, setShowDayNightMapOverlays };
};
