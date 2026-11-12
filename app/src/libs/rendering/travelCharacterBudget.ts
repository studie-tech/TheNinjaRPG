import { WORLD_DETAIL } from "@/libs/rendering/worldDetail";

/** Adapt the character body budget over two seconds of measured frame time; recover after four healthy windows. */
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
    /** Sample monotonic frame time; available candidate demand bounds slow-window backoff. */
    sample(now: number, continuous = true, demand = limit) {
      // Intentional on-demand intervals measure invalidation cadence, not rendering capacity.
      if (!continuous) {
        previous = undefined;
        elapsed = frames = healthyWindows = longestGap = 0;
        return false;
      }
      const interval = previous === undefined ? 0 : now - previous;
      previous = now;
      if (interval <= 0) {
        elapsed = frames = healthyWindows = longestGap = 0;
        return false;
      }
      // Exclude the largest long gap per window: suspension or an isolated stall is not
      // sustained load, but repeated slow frames must still reduce the body count.
      if (interval > 250) {
        if (!longestGap) elapsed = frames = healthyWindows = 0;
        longestGap = Math.max(longestGap, interval);
      }
      elapsed += interval;
      frames++;
      // The excluded gap contributes neither time nor a sample to the pacing average.
      const measured = elapsed - longestGap;
      if (measured < 2000) return false;
      const average = measured / (frames - Number(longestGap > 0));
      elapsed = frames = longestGap = 0;
      const before = limit;
      if (average > 25) {
        limit = Math.max(WORLD_DETAIL.travelCharactersMin, Math.min(limit, demand) - 4);
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
