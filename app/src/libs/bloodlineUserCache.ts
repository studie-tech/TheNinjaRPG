import type { Bloodline, GameSetting } from "@/drizzle/schema";
import { effectiveMasteries, type MasteryBuffUser } from "@/libs/mastery";
import { calcActiveUserRegen, calcMaxEnergy } from "@/libs/profile";

/** Derive passive values from the saved base rate and the confirmed bloodline. */
export const getBloodlinePassivePatch = (
  user: Parameters<typeof calcActiveUserRegen>[0] & MasteryBuffUser,
  bloodline: Bloodline | null,
  settings: GameSetting[],
) => {
  const changed = { ...user, bloodlineId: bloodline?.id ?? null, bloodline };
  return {
    bloodlineId: changed.bloodlineId,
    bloodline,
    effectiveMasteries: effectiveMasteries(changed),
    maxEnergy: calcMaxEnergy(changed),
    regeneration: calcActiveUserRegen(changed, settings),
    regenerationWithoutTimedBuffs: calcActiveUserRegen(changed, settings, false),
  };
};
