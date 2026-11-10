import { WORLD_DETAIL } from "@/libs/rendering/worldDetail";

/** Adapt visible character count over two-second windows, recovering only after four healthy windows. */
export const createTravelCharacterBudget = () => {
  let limit = WORLD_DETAIL.travelCharacters;
  let previous: number | undefined;
  let elapsed = 0,
    frames = 0,
    healthyWindows = 0;
  return {
    get limit() {
      return limit;
    },
    /** Sample monotonic frame time in milliseconds; return whether the scene needs a new limit. */
    sample(now: number) {
      const interval = previous === undefined ? 0 : now - previous;
      previous = now;
      // Tab suspension and isolated long stalls must not influence sustained frame pacing.
      if (interval <= 0 || interval > 250) {
        elapsed = frames = healthyWindows = 0;
        return false;
      }
      elapsed += interval;
      frames++;
      if (elapsed < 2000) return false;
      const average = elapsed / frames;
      elapsed = frames = 0;
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
