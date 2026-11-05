import type { ClanBoostType } from "@/drizzle/constants";
import { CLAN_BOOST_CONFIG, CLAN_BOOST_PERCENT_PER_LEVEL } from "@/drizzle/constants";
import type { Clan } from "@/drizzle/schema";

/**
 * A clan boost as a fraction. Clans store percentages, and only real clans grant them:
 * outlaw factions and strongholds get none.
 */
export const getClanBoost = (
  user:
    | {
        isOutlaw?: boolean | null;
        clan?: Partial<Pick<Clan, ClanBoostField>> | null;
      }
    | null
    | undefined,
  field: ClanBoostField,
) => (user?.isOutlaw ? 0 : (user?.clan?.[field] ?? 0) / 100);

/** Purchased levels of a clan boost, from its stored percentage. */
export const getClanBoostLevel = (currentBoost: number) =>
  currentBoost / CLAN_BOOST_PERCENT_PER_LEVEL;

/** Ryo price of a clan boost's next level. */
export const getClanBoostCost = (boostType: ClanBoostType, currentBoost: number) => {
  const { baseCost, perLevelCost } = CLAN_BOOST_CONFIG[boostType];
  return baseCost + getClanBoostLevel(currentBoost) * perLevelCost;
};

type ClanBoostField =
  | "missionRewardBoost"
  | "hunterExpBoost"
  | "gathererExpBoost"
  | "craftingExpBoost";
