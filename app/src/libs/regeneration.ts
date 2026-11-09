import { combatCacheEnergy } from "@/deltas/combat";
import { REGEN_SECONDS } from "@/drizzle/constants";
import type { UserStatus } from "@/drizzle/schema";
import {
  getTimedRegenerationGain,
  type RegenerationPeriod,
  type TimedBuff,
} from "@/libs/timedBuffs";
import { nextRegenerationTickAt, regenTicksSince, secondsPassed } from "@/utils/time";

/**
 * Calculate current state of the bar based on regen
 */
export const calcCurrent = (
  start?: number,
  total?: number,
  status?: UserStatus,
  regen?: number,
  regenAt?: Date | null,
  timeDiff?: number,
  combatRegenerationPeriods?: readonly RegenerationPeriod[],
  timedBuffs?: readonly TimedBuff[],
) => {
  const end = total ?? 100;
  let current = Math.max(start ?? 0, 0);
  let nextTickSeconds: number | undefined;
  if (status === "BATTLE" || start === undefined) {
    current = end;
  } else if (
    regen !== undefined &&
    status !== undefined &&
    regenAt &&
    ["AWAKE", "ASLEEP", "TRAVEL"].includes(status)
  ) {
    const minutes = regenTicksSince(regenAt, timeDiff);
    if (regen >= 0) {
      current = combatRegenerationPeriods
        ? combatCacheEnergy(
            { curEnergy: start, regenAt: regenAt.toISOString() },
            end,
            regen,
            new Date(Date.now() - (timeDiff ?? 0)),
            0,
            combatRegenerationPeriods,
          )
        : Math.min(
            end,
            start +
              getTimedRegenerationGain(
                regen,
                timedBuffs ?? [],
                regenAt,
                minutes,
                REGEN_SECONDS,
              ),
          );
    } else {
      current = Math.max(0, start + regen * minutes);
    }
    // Seconds until the next one-minute regeneration tick, shown while the bar still moves
    if (
      !combatRegenerationPeriods &&
      ((regen > 0 && current < end) || (regen < 0 && current > 0))
    ) {
      nextTickSeconds = Math.max(
        1,
        Math.ceil(
          -secondsPassed(nextRegenerationTickAt(regenAt, timeDiff), timeDiff, false),
        ),
      );
    }
  }
  const width = (current / end) * 100;

  return { current, width, nextTickSeconds };
};
