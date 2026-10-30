import type { Clan } from "@/drizzle/schema";
import { calcActiveUserRegen } from "@/libs/profile";
import { getTimedRegeneration } from "@/libs/timedBuffs";
import { regenerationBuffs } from "@/libs/titles";
import type { fetchAllGameSettings } from "@/queries/profile";
import type { findMembershipUserCache } from "@/queries/socialUserCache";

/** Recompute the changed clan bonus from raw opening profile sources. */
export const getMembershipUserPatch = (
  before: NonNullable<Awaited<ReturnType<typeof findMembershipUserCache>>>,
  clan: Clan | null,
  settings: Awaited<ReturnType<typeof fetchAllGameSettings>>,
) => {
  const user = { ...before, clanId: clan?.id ?? null, clan };
  const regenerationWithoutTimedBuffs = calcActiveUserRegen(user, settings, false);
  return {
    clanId: clan?.id ?? null,
    clan,
    regenerationWithoutTimedBuffs,
    regeneration: getTimedRegeneration(
      regenerationWithoutTimedBuffs,
      regenerationBuffs(user),
    ),
  };
};
