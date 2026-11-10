import { WORLD_DETAIL } from "@/libs/rendering/worldDetail";

/** Adapt visible character count over two-second windows, recovering only after four healthy windows. */
export const createTravelCharacterBudget = () => {
  let limit = WORLD_DETAIL.travelCharacters;
  let previous: number | undefined;
  let elapsed = 0,
    frames = 0,
    healthyWindows = 0,
    longestGap = 0;
  return {
    get limit() {
      return limit;
    },
    /** Sample monotonic frame time in milliseconds; return whether the scene needs a new limit. */
    sample(now: number) {
      const interval = previous === undefined ? 0 : now - previous;
      previous = now;
      if (interval <= 0) {
        elapsed = frames = healthyWindows = longestGap = 0;
        return false;
      }
      // Exclude one long gap per window: suspension or an isolated stall is not
      // sustained load, but repeated slow frames must still reduce the body count.
      if (interval > 250) {
        if (!longestGap) elapsed = frames = healthyWindows = 0;
        longestGap = Math.max(longestGap, interval);
      }
      elapsed += interval;
      frames++;
      const measured = elapsed - longestGap;
      if (measured < 2000) return false;
      const average = measured / (frames - Number(longestGap > 0));
      elapsed = frames = longestGap = 0;
      const before = limit;
      if (average > 25) {
        limit = Math.max(WORLD_DETAIL.travelCharactersMin, limit - 4);
        healthyWindows = 0;
      } else if (average < 18.5) {
        if (++healthyWindows >= 4) {
          limit = Math.min(WORLD_DETAIL.travelCharactersMax, limit + 4);
          healthyWindows = 0;
        }
      } else healthyWindows = 0;
      return before !== limit;
    },
  };
};
