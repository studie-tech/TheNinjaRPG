"use client";

import { useEffect, useState } from "react";

export const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    // Create media query list
    const mediaQuery = window.matchMedia(query);

    // Set initial value
    setMatches(mediaQuery.matches);

    // Create event listener
    const handler = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    // Add the callback as a listener
    mediaQuery.addEventListener("change", handler);

    // Clean up
    return () => mediaQuery.removeEventListener("change", handler);
  }, [query]);

  return matches;
};
