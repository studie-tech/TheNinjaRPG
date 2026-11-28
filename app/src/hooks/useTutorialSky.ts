import { atom, useAtom } from "jotai";
import { useEffect, useMemo } from "react";
import { getMorningShift } from "@/libs/dayNight";
import type { WorldSky, WorldWeather } from "@/libs/rendering/worldWeather";
import { isTutorialActive } from "@/libs/tutorial";

/**
 * The sky over the maps and battles of a player in the tutorial, or null for everyone else:
 * the clock starts at dawn when the visit's first lesson shows and runs on from there, and
 * the day is fair, with cloud shadows. It is drawn only; the game keeps the world's clock.
 */
export const useTutorialSky = (
  user: Parameters<typeof isTutorialActive>[0],
  timeDiff: number,
): WorldSky | null => {
  const isActive = isTutorialActive(user);
  const isLoaded = !!user;
  const [dawn, setDawn] = useAtom(tutorialDawnAtom);
  useEffect(() => {
    if (isLoaded) setDawn((at) => (isActive ? (at ?? Date.now() - timeDiff) : null));
  }, [isActive, isLoaded, timeDiff, setDawn]);
  return useMemo(
    () =>
      isActive && dawn !== null
        ? { shiftMs: getMorningShift(dawn), weather: TUTORIAL_WEATHER }
        : null,
    [isActive, dawn],
  );
};

/** When this visit's first lesson showed, on the server's clock. */
const tutorialDawnAtom = atom<number | null>(null);

const TUTORIAL_WEATHER: WorldWeather = { kind: "clouds", intensity: 0.65 };
