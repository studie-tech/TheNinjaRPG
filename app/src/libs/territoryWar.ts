import {
  TERRITORY_WAR_BOOST_HOURS,
  TERRITORY_WAR_BOOST_PERCENT,
  VILLAGE_SYNDICATE_ID,
} from "@/drizzle/constants";
import type { Clan, Village } from "@/drizzle/schema";

/** Political identity is frozen at admission, independently of combat team IDs. */
export type TerritoryCompetitor = {
  id: string;
  name: string;
  clanId: string | null;
  villageId: string | null;
};
/** Private initiation snapshot; settlement needs no fresh identity/event reads. */
export type TerritoryBattleState = {
  id: string;
  competitors: Record<string, TerritoryCompetitor>;
};

/**
 * Citizens represent their village; any outlaw clan takes precedence over Syndicate.
 * Clanless outlaws (and missing village IDs) use Syndicate. Freeze this result at
 * admission so a later political change cannot redirect an encounter's credit.
 */
export const getTerritoryCompetitor = (user: {
  isOutlaw: boolean;
  villageId: string | null;
  clanId: string | null;
  village?: Pick<Village, "id" | "name"> | null;
  clan?: Pick<Clan, "id" | "name" | "hasHideout" | "villageId"> | null;
}): TerritoryCompetitor => {
  if (user.isOutlaw && user.clanId && user.clan) {
    return {
      id: `clan:${user.clanId}`,
      name: user.clan.name,
      clanId: user.clanId,
      villageId: null,
    };
  }
  const villageId = user.isOutlaw
    ? VILLAGE_SYNDICATE_ID
    : (user.villageId ?? VILLAGE_SYNDICATE_ID);
  return {
    id: `village:${villageId}`,
    name: user.isOutlaw ? "Syndicate" : (user.village?.name ?? "Syndicate"),
    clanId: null,
    villageId,
  };
};

/** UTC ISO timestamps for one awarded interval; retain expired windows for unsettled work. */
export type TerritoryBoostWindow = { startsAt: string; endsAt: string };

/** Preloaded history and current competitor deadline shared by activity/UI calculations. */
export type TerritoryBoostUser = {
  territoryWarBoostWindows?: TerritoryBoostWindow[];
  isOutlaw?: boolean;
  clanId?: string | null;
  clan?: { territoryWarBoostUntil?: Date | string | null } | null;
  village?: { territoryWarBoostUntil?: Date | string | null } | null;
};

/** Current competitor's deadline: outlaw clan first, otherwise the player's village. */
export const getTerritoryWarBoostUntil = (user: TerritoryBoostUser) => {
  const value =
    user.isOutlaw && user.clanId
      ? user.clan?.territoryWarBoostUntil
      : user.village?.territoryWarBoostUntil;
  return value ? new Date(value) : null;
};

/** Start-inclusive/end-exclusive bonus fraction; callers apply their activity's stacking rules. */
export const getTerritoryWarBoost = (user: TerritoryBoostUser, now = new Date()) => {
  return territoryWarBoostWindows(user).some(
    (window) => new Date(window.startsAt) <= now && now < new Date(window.endsAt),
  )
    ? TERRITORY_WAR_BOOST_PERCENT / 100
    : 0;
};

/**
 * Time-weighted bonus fraction over [startsAt, endsAt), clipping history to actual
 * work. Empty/reversed periods grant zero; late collection never extends eligibility.
 */
export const getTerritoryWarPeriodBoost = (
  user: TerritoryBoostUser,
  startsAt: Date,
  endsAt: Date,
) => {
  const duration = endsAt.getTime() - startsAt.getTime();
  if (duration <= 0) return 0;
  const windows = territoryWarBoostWindows(user);
  const overlap = windows.reduce(
    (total, window) =>
      total +
      Math.max(
        0,
        Math.min(endsAt.getTime(), new Date(window.endsAt).getTime()) -
          Math.max(startsAt.getTime(), new Date(window.startsAt).getTime()),
      ),
    0,
  );
  return ((TERRITORY_WAR_BOOST_PERCENT / 100) * Math.min(duration, overlap)) / duration;
};

/**
 * Use preloaded history plus a missing current deadline's fixed-duration fallback.
 * All calculations stay in memory, including after the current bonus has expired.
 */
export const territoryWarBoostWindows = (user: TerritoryBoostUser) => {
  const windows = [...(user.territoryWarBoostWindows ?? [])];
  const until = getTerritoryWarBoostUntil(user);
  if (
    until &&
    !windows.some((window) => new Date(window.endsAt).getTime() === until.getTime())
  )
    windows.push({
      startsAt: new Date(
        until.getTime() - TERRITORY_WAR_BOOST_HOURS * 3600000,
      ).toISOString(),
      endsAt: until.toISOString(),
    });
  return windows;
};
