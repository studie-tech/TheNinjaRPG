import { SHRINE_BOOST_COST, SHRINE_BOOST_DURATION_HOURS, type SHRINE_BOOST_TYPE } from "@/drizzle/constants";
import type { Village } from "@/drizzle/schema";
import { secondsFromNow } from "@/utils/time";

export type BoostScheduleEntry = {
  id: string;
  boostType: SHRINE_BOOST_TYPE | string;
  startAt: string; // ISO
  processed?: boolean;
};

export type ShrineSettings = NonNullable<Village["shrineSettings"]> & {
  boostSchedule?: BoostScheduleEntry[];
};

export type ProcessResult = {
  updatedSettings: ShrineSettings;
  processedIds: string[];
  tokensSpent: number;
};

/**
 * Compute updates for due scheduled shrine boosts. Pure and side-effect free.
 * - Requires at least one level 3 shrine
 * - Skips if the same boost type is already active
 * - Skips if not enough tokens
 */
export const processDueScheduledBoosts = (
  settings: ShrineSettings,
  tokens: number,
  level3Shrines: number,
  now: Date = new Date(),
): ProcessResult => {
  const schedule = [...(settings.boostSchedule || [])];
  const activeBoosts = { ...(settings.activeBoosts || {}) } as Record<string, string>;

  let availableTokens = tokens;
  let tokensSpent = 0;
  const processedIds: string[] = [];

  // Guard: need at least one level 3 shrine
  if (level3Shrines <= 0) {
    return { updatedSettings: { ...settings }, processedIds, tokensSpent };
  }

  // Sort due items by startAt ASC to process earliest first
  const dueItems = schedule
    .filter((s) => !s.processed && new Date(s.startAt) <= now)
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

  for (const item of dueItems) {
    const bType = item.boostType as SHRINE_BOOST_TYPE;
    const existing = activeBoosts[bType];
    const isActive = existing && new Date(existing) > now;
    if (isActive) continue; // skip if already active
    if (availableTokens < SHRINE_BOOST_COST) continue; // skip if not enough tokens

    // Activate boost
    const expiry = secondsFromNow(SHRINE_BOOST_DURATION_HOURS * 60 * 60).toISOString();
    activeBoosts[bType] = expiry;

    availableTokens -= SHRINE_BOOST_COST;
    tokensSpent += SHRINE_BOOST_COST;
    processedIds.push(item.id);
  }

  const remainingSchedule = schedule.filter((s) => !processedIds.includes(s.id));

  return {
    updatedSettings: {
      ...settings,
      activeBoosts,
      boostSchedule: remainingSchedule,
    },
    processedIds,
    tokensSpent,
  };
};
