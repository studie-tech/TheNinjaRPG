import { useEffect, useState } from "react";
import type { GlobalMapData } from "@/libs/threejs/types";
import { fetchMap } from "@/libs/threejs/globe";

interface UseMapResult {
  hasError: boolean;
}

export const useMap = (
  setGlobe: React.Dispatch<React.SetStateAction<GlobalMapData | null>>,
): UseMapResult => {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchMap()
      .then((data) => {
        if (!cancelled) {
          setGlobe(data);
          setHasError(false);
        }
      })
      .catch((error) => {
        // Error is already logged to Sentry in fetchMap
        // Just log to console for local debugging
        console.error("[useMap] Failed to fetch map data:", error);

        // Set globe to null and mark error state
        if (!cancelled) {
          setGlobe(null);
          setHasError(true);
        }
      });
    return () => {
      cancelled = true; // guard against state‑update after unmount
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { hasError };
};
