import {
  BANDIT_RANKS,
  BANDIT_REQUIRED_EXP,
  BANDIT_SCOUT_MINUTES,
  BANDIT_STEAL_BP,
  BANDIT_SUCCESS_CHANCE,
  type BanditRank,
  CARAVAN_CHECKPOINTS,
  CARAVAN_ENEMY_SCOUT_MINUTES,
  CARAVAN_GUARD_DELIVERY_RYO,
  CARAVAN_GUARD_OBJECTIVE_RYO,
  CARAVAN_MAX_DELAY_MINUTES,
  CARAVAN_MAX_GUARD_OBJECTIVES,
  CARAVAN_MAX_LOSS_BP,
  CARAVAN_SABOTAGE_MINUTES,
  CARAVAN_STEALTH_BASE_CHANCE,
  CARAVAN_STEALTH_CHANCE_PER_1000,
  CARAVAN_STEALTH_MAX_CHANCE,
  CARAVANS_PER_TRADE_ROUTE,
  type CaravanEncounterType,
  type CaravanOperationType,
  type CaravanRole,
  STEALTH_SENSORY_DEFAULT,
  TRADE_ROUTE_BASE_TRAVEL_MINUTES,
  TRADE_ROUTE_MAX_LEVEL,
  TRADE_ROUTE_MAX_MARKERS,
  TRADE_ROUTE_MIN_MARKERS,
  TRADE_ROUTE_SECTORS_PER_MARKER,
  TRADE_ROUTE_TRAVEL_REDUCTION_PER_LEVEL,
  type TradeRouteStatus,
} from "@/drizzle/constants";
import type { Caravan, UserData, VillageAlliance } from "@/drizzle/schema";
import { getRankForExperience, getRankProgress } from "@/libs/occupationRank";
import { sectorGridNeighbors } from "@/libs/sector-map/world-grid";
import { findRelationship, isVillagePair } from "@/utils/alliance";
import { clamp, secureRandomInt } from "@/utils/math";

/** A shipment's manifest line. */
export type CargoLine = { itemId: string; quantity: number };

/**
 * Shortest sector path between two home sectors over the world grid, both ends included.
 * Neighbors are explored in [north, east, south, west] order, so the path is stable.
 */
export const findSectorPath = (from: number, to: number): number[] | null => {
  if (from === to) return [from];
  const previous = new Map<number, number>([[from, from]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head] as number;
    for (const next of sectorGridNeighbors(current)) {
      if (next < 0 || previous.has(next)) continue;
      previous.set(next, current);
      if (next === to) {
        const path = [to];
        let step = to;
        while (step !== from) {
          step = previous.get(step) as number;
          path.unshift(step);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
};

/** Caravan travel time of a route at this level. */
export const getRouteTravelMinutes = (level: number) =>
  Math.round(
    (TRADE_ROUTE_BASE_TRAVEL_MINUTES *
      (100 - TRADE_ROUTE_TRAVEL_REDUCTION_PER_LEVEL * (Math.max(1, level) - 1))) /
      100,
  );

/**
 * A trade route as a village's route list shows it, with the travel times of its level. A
 * marker with a controller blocks the route.
 */
export const describeTradeRoute = (route: {
  id: string;
  status: TradeRouteStatus;
  level: number;
  partner: { id: string; name: string };
  proposedByUs: boolean;
  sectors: number;
  markers: { id: string; sector: number; control: number; controller: string | null }[];
}) => ({
  id: route.id,
  status: route.status,
  level: route.level,
  travelMinutes: getRouteTravelMinutes(route.level),
  nextTravelMinutes:
    route.level < TRADE_ROUTE_MAX_LEVEL ? getRouteTravelMinutes(route.level + 1) : null,
  partner: route.partner,
  proposedByUs: route.proposedByUs,
  sectors: route.sectors,
  blocked: route.markers.some((marker) => marker.controller !== null),
  markers: route.markers,
});

/**
 * A village's caravan slots: every active route adds its share, and each open caravan the
 * village sends fills one until it is delivered or cancelled.
 */
export const getCaravanCapacity = (
  routes: { status: TradeRouteStatus }[],
  caravans: { outgoing: boolean }[] = [],
) => ({
  total:
    routes.filter((route) => route.status === "ACTIVE").length *
    CARAVANS_PER_TRADE_ROUTE,
  used: caravans.filter((row) => row.outgoing).length,
});

/**
 * Moments a journey passes each checkpoint; they sit evenly between departure and arrival.
 */
export const getCheckpointTimes = (
  caravan: Pick<Caravan, "departedAt" | "arrivesAt">,
) => {
  if (!caravan.departedAt || !caravan.arrivesAt) return [];
  const start = caravan.departedAt.getTime();
  const step = (caravan.arrivesAt.getTime() - start) / (CARAVAN_CHECKPOINTS + 1);
  return Array.from(
    { length: CARAVAN_CHECKPOINTS },
    (_, index) => new Date(start + step * (index + 1)),
  );
};

/**
 * Random hidden marker sectors between a route's two villages. Adjacent villages have no
 * sectors between them and therefore no markers.
 */
export const planRouteMarkers = (
  path: number[],
  pick: (maxExclusive: number) => number = secureRandomInt,
) => {
  const interior = [...new Set(path.slice(1, -1))];
  const count = Math.min(
    interior.length,
    clamp(
      Math.round(path.length / TRADE_ROUTE_SECTORS_PER_MARKER),
      TRADE_ROUTE_MIN_MARKERS,
      TRADE_ROUTE_MAX_MARKERS,
    ),
  );
  const pool = [...interior];
  const picked: { sector: number }[] = [];
  while (picked.length < count && pool.length > 0) {
    const [sector] = pool.splice(pick(pool.length), 1);
    if (sector === undefined) break;
    picked.push({ sector });
  }
  return picked;
};

/** Whether two villages fight each other in an open war. */
const isAtWar = (
  wars: OpenWar[],
  villageIdA?: string | null,
  villageIdB?: string | null,
) =>
  wars.some((war) =>
    isVillagePair(
      { villageIdA: war.attackerVillageId, villageIdB: war.defenderVillageId },
      villageIdA,
      villageIdB,
    ),
  );

/** Whether two villages may agree a trade route: enemies and warring villages cannot. */
export const getTradeBlock = (
  relationships: VillageAlliance[],
  wars: OpenWar[],
  villageIdA: string,
  villageIdB: string,
) => {
  if (villageIdA === villageIdB) return "A village cannot trade with itself";
  if (isAtWar(wars, villageIdA, villageIdB)) return "Villages at war cannot trade";
  if (findRelationship(relationships, villageIdA, villageIdB)?.status === "ENEMY")
    return "Enemy villages cannot trade";
  return null;
};

/** Share of the journey completed, from 0 at departure to 1 on arrival. */
export const getJourneyProgress = (
  caravan: Pick<Caravan, "departedAt" | "arrivesAt">,
  now = new Date(),
) => {
  if (!caravan.departedAt || !caravan.arrivesAt) return 0;
  const total = caravan.arrivesAt.getTime() - caravan.departedAt.getTime();
  if (total <= 0) return 1;
  return clamp((now.getTime() - caravan.departedAt.getTime()) / total, 0, 1);
};

/** Sector a caravan is passing through; its origin until it departs. */
export const getCaravanSector = (
  caravan: Pick<Caravan, "departedAt" | "arrivesAt" | "path" | "status">,
  now = new Date(),
) => {
  const path = caravan.path;
  if (caravan.status === "DELIVERED") return path[path.length - 1] ?? -1;
  if (caravan.status !== "TRAVELLING") return path[0] ?? -1;
  const index = Math.min(
    path.length - 1,
    Math.floor(getJourneyProgress(caravan, now) * path.length),
  );
  return path[index] ?? -1;
};

/** Checkpoints the journey has passed; they sit evenly between departure and arrival. */
export const getReachedCheckpoints = (
  caravan: Pick<Caravan, "departedAt" | "arrivesAt" | "status">,
  now = new Date(),
) =>
  caravan.status === "TRAVELLING"
    ? Math.min(
        CARAVAN_CHECKPOINTS,
        Math.floor(getJourneyProgress(caravan, now) * (CARAVAN_CHECKPOINTS + 1)),
      )
    : 0;

/**
 * Units of a manifest a caravan still carries after its losses. Each line loses whole units
 * up to its share, so no line loses more than the journey's loss and stolen shares, which
 * round down too, never exceed what the caravan lost.
 */
export const getRemainingCargo = (cargo: CargoLine[], lossBp: number): CargoLine[] =>
  cargo.map((line) => ({
    itemId: line.itemId,
    quantity: Math.ceil((line.quantity * (10_000 - Math.min(lossBp, 10_000))) / 10_000),
  }));

/** Share of the manifest a new loss may still take under the journey's cap. */
export const getAllowedLoss = (lossBp: number, requestedBp: number) =>
  Math.max(0, Math.min(requestedBp, CARAVAN_MAX_LOSS_BP - lossBp));

/** Delay a new sabotage may still add under the journey's cap. */
export const getAllowedDelay = (delayMinutes: number, requested: number) =>
  Math.max(0, Math.min(requested, CARAVAN_MAX_DELAY_MINUTES - delayMinutes));

/**
 * Stolen goods split between the robbers. Each line divides evenly; the leader, listed
 * first, keeps any remainder. A robber whose share rounds to nothing gets no entry.
 */
export const splitLoot = (
  cargo: CargoLine[],
  stolenBp: number,
  robberIds: string[],
) => {
  const loot = new Map<string, CargoLine[]>();
  for (const line of cargo) {
    const stolen = Math.floor((line.quantity * stolenBp) / 10_000);
    if (stolen <= 0 || robberIds.length === 0) continue;
    const share = Math.floor(stolen / robberIds.length);
    robberIds.forEach((id, index) => {
      const quantity = share + (index === 0 ? stolen - share * robberIds.length : 0);
      if (quantity > 0)
        loot.set(id, [...(loot.get(id) ?? []), { itemId: line.itemId, quantity }]);
    });
  }
  return loot;
};

/** Delivery pay of a guard, for a capped number of objectives; none earns nothing. */
export const getGuardReward = (objectives: number) =>
  objectives > 0
    ? CARAVAN_GUARD_DELIVERY_RYO +
      Math.min(objectives, CARAVAN_MAX_GUARD_OBJECTIVES) * CARAVAN_GUARD_OBJECTIVE_RYO
    : 0;

/** Bandit rank of an amount of bandit experience. */
export const getBanditRank = (experience: number): BanditRank =>
  getRankForExperience(BANDIT_RANKS, BANDIT_REQUIRED_EXP, experience);

/** Progress towards the next bandit rank. */
export const getBanditRankProgress = (experience: number) =>
  getRankProgress(BANDIT_RANKS, BANDIT_REQUIRED_EXP, experience);

/** Covert success chance of an enemy shinobi, from their stealth. */
export const getStealthChance = (stealth: number) =>
  Math.min(
    CARAVAN_STEALTH_MAX_CHANCE,
    CARAVAN_STEALTH_BASE_CHANCE +
      (Math.max(0, stealth - STEALTH_SENSORY_DEFAULT) / 1000) *
        CARAVAN_STEALTH_CHANCE_PER_1000,
  );

/** Success chance of an operation for its role, in percent. */
export const getOperationChance = (
  role: CaravanRole,
  user: Pick<UserData, "stealth" | "banditExperience">,
) =>
  role === "BANDIT"
    ? BANDIT_SUCCESS_CHANCE[getBanditRank(user.banditExperience)]
    : getStealthChance(user.stealth);

/** Minutes an operation takes for its role. */
export const getOperationMinutes = (
  type: CaravanOperationType,
  role: CaravanRole,
  banditExperience: number,
) => {
  if (type === "DISRUPT" || type === "DELAY") return CARAVAN_SABOTAGE_MINUTES;
  return role === "BANDIT"
    ? BANDIT_SCOUT_MINUTES[getBanditRank(banditExperience)]
    : CARAVAN_ENEMY_SCOUT_MINUTES;
};

/** Share of the manifest a robbery led by this bandit steals. */
export const getStealBp = (banditExperience: number) =>
  BANDIT_STEAL_BP[getBanditRank(banditExperience)];

/**
 * Side a player may take against a caravan of another village: outlaw bandits rob any
 * caravan, and shinobi of an enemy or warring village disrupt it. Guards are its own
 * villagers.
 */
export const getAttackerRole = (
  user: Pick<UserData, "isOutlaw" | "isBandit" | "villageId">,
  ownerVillageId: string,
  relationships: VillageAlliance[],
  wars: OpenWar[],
): CaravanRole | null => {
  if (user.villageId === ownerVillageId) return null;
  if (user.isOutlaw) return user.isBandit ? "BANDIT" : null;
  const relation = findRelationship(relationships, user.villageId, ownerVillageId);
  return isAtWar(wars, user.villageId, ownerVillageId) || relation?.status === "ENEMY"
    ? "ENEMY"
    : null;
};

/** Roll a percent chance. */
export const rollChance = (percent: number) => secureRandomInt(10_000) < percent * 100;

/**
 * Everything settlement needs about a caravan or marker fight, frozen when it starts so the
 * final combat write performs no reads.
 */
export type CaravanBattleState = {
  encounterId: string;
  battleId: string;
  type: CaravanEncounterType;
  caravanId: string | null;
  markerId: string | null;
  /** Battle side of the raiders, saboteur or marker assault. */
  attackerDirection: "left" | "right";
  attackerRole: CaravanRole | null;
  attackerVillageId: string | null;
  /** Human attackers and escorts; AI fill the remaining places. */
  attackerIds: string[];
  guardIds: string[];
  /** Manifest and losses at the start, for capped losses and stolen goods. */
  cargo: CargoLine[];
  lossBp: number;
  stealBp: number;
  /** Village that takes a marker when the assault destroys its last control. */
  captureVillageId: string | null;
  /** Marker holder the assault was allowed against; a marker taken since keeps its control. */
  markerControllerId: string | null;
};

/** Views a caravan or trade route notice refreshes in the recipient's open tabs. */
export type CaravanNoticeView = "profile" | "caravans" | "routes" | "controls";

/** The sides of an open war, which the trade and raiding rules read. */
type OpenWar = { attackerVillageId: string; defenderVillageId: string };
