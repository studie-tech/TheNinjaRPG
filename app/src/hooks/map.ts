import { useEffect } from "react";
import type { GlobalMapData } from "@/libs/threejs/types";
import { fetchMap } from "@/libs/threejs/globe";

export const useMap = (
  setGlobe: React.Dispatch<React.SetStateAction<GlobalMapData | null>>,
) => {
  useEffect(() => {
    let cancelled = false;
    void fetchMap()
      .then((data) => {
        if (!cancelled) setGlobe(data);
      })
      .catch((error) => {
        // Error is already logged to Sentry in fetchMap
        // Just log to console for local debugging
        console.error("[useMap] Failed to fetch map data:", error);
        
        // Set globe to null to indicate failure
        // The UI should handle null globe state appropriately
        if (!cancelled) setGlobe(null);
      });
    return () => {
      cancelled = true; // guard against state‑update after unmount
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
};
