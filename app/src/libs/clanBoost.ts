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

type ClanBoostField =
  | "missionRewardBoost"
  | "hunterExpBoost"
  | "gathererExpBoost"
  | "craftingExpBoost";
