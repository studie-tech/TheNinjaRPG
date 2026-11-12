import { VILLAGE_DUTY_PRESENCE_SECONDS } from "@/drizzle/constants";
import { oddQHexDistance } from "@/libs/hexgrid";
import { getWarRelationship } from "@/libs/objectiveWar";
import { WANDER_STEP_MS } from "@/libs/overworldWander";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { isUserCurrentlyStealthed } from "@/libs/stealth";
import {
  planVillageDutyPursuits,
  villageDutyCapacity,
  villageDutyPursuitPosition,
} from "@/libs/villageDuty";
import {
  fetchVillageDutyHome,
  fetchVillageDutyUser,
  findVillageDutyShift,
  listVillageDutyCandidates,
  listVillageDutyRoster,
  listVillageDutyVisitors,
  saveVillageDutyShift,
  touchVillageDutyPresence,
  updateVillageDutyPursuits,
} from "@/queries/villageDuty";
import { fetchActiveWars } from "@/routers/war";
import type { DrizzleClient } from "@/server/db";
import { fetchPublishedSectorMap } from "@/server/utils/sectorMap";
import { getUtcHourStart, secondsFromDate } from "@/utils/time";

/** Lazily publish a fixed hourly roster; only initialization losers reconcile another writer's result. */
export const ensureVillageDutyShift = async (
  client: DrizzleClient,
  home: Pick<
    NonNullable<Awaited<ReturnType<typeof fetchVillageDutyHome>>>,
    "id" | "structures" | "dutyShift"
  >,
  now = new Date(),
) => {
  const startedAt = getUtcHourStart(now);
  if (home.dutyShift && home.dutyShift.startedAt >= startedAt) return home.dutyShift;
  const capacity = villageDutyCapacity(home.structures);
  const candidates = capacity
    ? await listVillageDutyCandidates(client, home.id, now)
    : [];
  const patrols = candidates
    .slice(0, capacity)
    .map(({ userId }) => ({ userId, defeated: false, battleId: null }));
  let previous: typeof home.dutyShift | null = home.dutyShift;
  for (let attempt = 0; attempt < 2; attempt++) {
    const saved = await saveVillageDutyShift(
      client,
      home.id,
      startedAt,
      patrols,
      capacity,
      previous,
    );
    if (saved.rowsAffected === 1)
      return {
        villageId: home.id,
        startedAt,
        patrols,
        capacity,
        revision: (previous?.revision ?? -1) + 1,
      };
    const raced = await findVillageDutyShift(client, home.id);
    if (raced && raced.startedAt >= startedAt) return raced;
    previous = raced ?? null;
  }
  return undefined;
};

/** Hostile diplomacy applies only to awake, active visitors physically inside the defended village. */
export const isVillageDutyIntruder = (
  home: NonNullable<Awaited<ReturnType<typeof fetchVillageDutyHome>>>,
  user: {
    userId: string;
    villageId: string | null;
    sector: number;
    status: string;
    location: string | null;
    isAi: boolean;
    isBanned: boolean;
  },
  wars: Parameters<typeof getWarRelationship>[0] = [],
) =>
  !user.isAi &&
  !user.isBanned &&
  user.status === "AWAKE" &&
  user.location === "Village" &&
  user.sector === home.sector &&
  user.villageId !== home.id &&
  (getWarRelationship(wars, { userId: "", villageId: home.id }, user) === "ENEMY" ||
    [...home.relationshipA, ...home.relationshipB].some(
      (relation) =>
        relation.status === "ENEMY" &&
        (relation.villageIdA === user.villageId ||
          relation.villageIdB === user.villageId),
    ));

/** Pursue visible visitors with one guarded write; stealth leaves only an expiring last-known trail. */
export const advanceVillageDutyPursuits = async (
  client: DrizzleClient,
  home: NonNullable<Awaited<ReturnType<typeof fetchVillageDutyHome>>>,
  owners: Awaited<ReturnType<typeof listVillageDutyRoster>>,
  presence: Awaited<ReturnType<typeof listVillageDutyVisitors>>,
  map: NormalizedSectorMap,
  visitor: Parameters<typeof isVillageDutyIntruder>[1] &
    Parameters<typeof isUserCurrentlyStealthed>[0] & {
      longitude: number;
      latitude: number;
    },
  now = new Date(),
  wars: Parameters<typeof getWarRelationship>[0] = [],
) => {
  const shift = home.dutyShift;
  if (
    !shift ||
    !isVillageDutyIntruder(home, visitor, wars) ||
    isUserCurrentlyStealthed(visitor)
  )
    return null;
  const intruders = [
    ...presence.flatMap((entry) =>
      entry.user &&
      entry.user.userId !== visitor.userId &&
      !isUserCurrentlyStealthed(entry.user) &&
      isVillageDutyIntruder(home, entry.user, wars)
        ? [{ ...entry.user, expiresAt: entry.expiresAt.getTime() }]
        : [],
    ),
    {
      ...visitor,
      expiresAt: secondsFromDate(VILLAGE_DUTY_PRESENCE_SECONDS, now).getTime(),
    },
  ];
  const patrols = planVillageDutyPursuits(
    shift.patrols,
    owners,
    map,
    intruders,
    now.getTime(),
    home.structures,
  );
  const changed = patrols.some((patrol, index) => patrol !== shift.patrols[index]);
  const [saved] = await Promise.all([
    changed ? updateVillageDutyPursuits(client, shift, patrols) : undefined,
    touchVillageDutyPresence(
      client,
      visitor.userId,
      visitor.sector,
      secondsFromDate(VILLAGE_DUTY_PRESENCE_SECONDS, now),
    ),
  ]);
  if (changed && saved?.rowsAffected !== 1) return null;
  return { ...shift, patrols, revision: shift.revision + Number(changed) };
};

/** Fetch independent encounter inputs up front; movement callers reuse their already-loaded snapshots. */
export const prepareVillageDutyEncounter = async ({
  client,
  userId,
  sector,
  force = false,
  preload,
}: {
  client: DrizzleClient;
  userId: string;
  sector: number;
  force?: boolean;
  preload?: {
    user: Parameters<typeof advanceVillageDutyPursuits>[5];
    home: Awaited<ReturnType<typeof fetchVillageDutyHome>>;
    map: NormalizedSectorMap | null;
    roster: Awaited<ReturnType<typeof listVillageDutyRoster>>;
    presence: Awaited<ReturnType<typeof listVillageDutyVisitors>>;
    wars?: Parameters<typeof getWarRelationship>[0];
  };
}) => {
  const now = new Date();
  const [user, home, map, loadedRoster, presence, wars] = preload
    ? ([
        preload.user,
        preload.home,
        preload.map,
        preload.roster,
        preload.presence,
        preload.wars ??
          (preload.home && isVillageDutyIntruder(preload.home, preload.user)
            ? []
            : await fetchActiveWars(client)),
      ] as const)
    : await Promise.all([
        fetchVillageDutyUser(client, userId),
        fetchVillageDutyHome(client, sector),
        fetchPublishedSectorMap(client, sector).catch(() => null),
        listVillageDutyRoster(client, sector, now),
        listVillageDutyVisitors(client, sector, now),
        fetchActiveWars(client),
      ]);
  if (!home || !user || !isVillageDutyIntruder(home, user, wars)) return null;
  // Stealth hides passive travel, while an attempted attack still confronts the shared patrol.
  if (!force && isUserCurrentlyStealthed(user)) return null;
  if (!map) return { blocked: true as const };
  const initialized = await ensureVillageDutyShift(client, home, now);
  if (!initialized) return { blocked: true as const };
  const roster =
    home.dutyShift?.startedAt.getTime() === initialized.startedAt.getTime()
      ? loadedRoster
      : await listVillageDutyRoster(client, home.id, now);
  const shift = await advanceVillageDutyPursuits(
    client,
    { ...home, dutyShift: initialized },
    roster,
    presence,
    map,
    force ? { ...user, stealthActive: false } : user,
    now,
    wars,
  );
  if (!shift) return { blocked: true as const };
  const eligibleIds = new Set(roster.map((entry) => entry.userId));
  const remaining = shift.patrols.filter(
    (patrol) => !patrol.defeated && eligibleIds.has(patrol.userId),
  );
  let slot = -1,
    closest = Number.POSITIVE_INFINITY;
  for (const [index, patrol] of shift.patrols.entries()) {
    if (
      patrol.defeated ||
      patrol.battleId ||
      !eligibleIds.has(patrol.userId) ||
      (!force && patrol.pursuit?.targetUserId !== userId)
    )
      continue;
    const pose =
      patrol.pursuit && villageDutyPursuitPosition(patrol.pursuit, now.getTime());
    if (!pose) {
      if (force && slot < 0) {
        slot = index;
        closest = Number.POSITIVE_INFINITY;
      }
      continue;
    }
    const at = pose.progress < 0.5 ? pose.from : pose.to;
    const distance = oddQHexDistance(at.x, at.y, user.longitude, user.latitude);
    const reached =
      !!patrol.pursuit &&
      now.getTime() >=
        patrol.pursuit.startedAt +
          Math.max(0, patrol.pursuit.path.length - 1) * WANDER_STEP_MS;
    if ((force || distance <= 1 || reached) && distance < closest) {
      slot = index;
      closest = distance;
    }
  }
  return {
    blocked: false as const,
    user,
    home,
    shift,
    slot,
    remaining: remaining.length,
    eligibleUserIds: eligibleIds,
  };
};
