import { TERRITORY_WAR_INTERVAL_HOURS } from "@/drizzle/constants";
import type { territoryWar } from "@/drizzle/schema";

/** Project the active notice and the earliest opening allowed by the latest event. */
export const getTerritoryWarNotice = (
  latest: typeof territoryWar.$inferSelect | undefined,
  now: number,
) => {
  if (!latest) return { event: null, nextStartsAt: null };
  return {
    event:
      !latest.resolvedAt &&
      latest.startsAt.getTime() <= now &&
      latest.endsAt.getTime() > now
        ? latest
        : null,
    // An unresolved expiry can still have an in-flight scorer that captured an
    // earlier victory time. Only a durable resolution establishes the quiet window.
    nextStartsAt: latest.resolvedAt
      ? new Date(latest.resolvedAt.getTime() + TERRITORY_WAR_INTERVAL_HOURS * 3_600_000)
      : latest.startsAt.getTime() > now
        ? latest.startsAt
        : null,
  };
};

/** Keep discovery polling only when an event can be active or its opening is unknown. */
export const getTerritoryWarNoticePollInterval = (
  notice: ReturnType<typeof getTerritoryWarNotice> | undefined,
  now: number,
) => (notice?.nextStartsAt && notice.nextStartsAt.getTime() > now ? false : 30_000);

/** Confirm that creating a territory-war team has no profile balance changes. */
export const getCreateTeamUserUpdate = () => ({
  userDelta: {},
});

/** Project awake status only after the guarded territory-war queue exit affected a row. */
export const getLeaveTeamUserUpdate = ({
  wokeRowsAffected,
}: {
  wokeRowsAffected: number;
}) => ({
  userPatch: wokeRowsAffected ? { status: "AWAKE" as const } : undefined,
});

/** Project the caller's confirmed territory-war queue admission. */
export const getJoinTeamUserUpdate = () => ({
  userPatch: { status: "QUEUED" as const },
});
