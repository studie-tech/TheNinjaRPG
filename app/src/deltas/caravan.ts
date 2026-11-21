import type { RouterOutputs } from "@/app/_trpc/client";
import {
  CARAVAN_GUARD_SLOTS,
  CARAVAN_HISTORY_SIZE,
  CARAVAN_MAX_GROUP,
  CARAVAN_OPERATION_HISTORY_SIZE,
} from "@/drizzle/constants";
import { describeTradeRoute } from "@/libs/caravan";

type RoutesView = RouterOutputs["tradeRoute"]["getRoutes"];
type CaravansView = RouterOutputs["caravan"]["getCaravans"];
type CaravanEntry = NonNullable<CaravansView>["caravans"][number];
type ControlsView = RouterOutputs["caravanOps"]["getControls"];
type ControlsCaravan = ControlsView["caravans"][number];

/** Profile patch of an escort entering or leaving their caravan's queue. */
export const getEscortStatusUserUpdate = (status: "QUEUED" | "AWAKE") => ({
  userPatch: { status },
});

/**
 * Profile patch of a viewer whose queued escort a cancellation released: they wake, as
 * every released escort does. Other viewers' profiles are unchanged.
 */
export const getReleasedEscortUserUpdate = (
  user: { userId: string; status: string },
  releasedGuardIds: string[],
) =>
  user.status === "QUEUED" && releasedGuardIds.includes(user.userId)
    ? getEscortStatusUserUpdate("AWAKE")
    : {};

/** List a route the viewer's village just proposed and drop its partner from the choices. */
export const getProposedTradeRoutes = (
  current: RoutesView,
  proposed: {
    id: string;
    partner: { id: string; name: string; sector: number | null };
    sectors: number;
  },
): RoutesView | undefined => {
  if (!current) return;
  if (current.routes.some((route) => route.id === proposed.id)) return current;
  return {
    ...current,
    routes: [
      ...current.routes,
      describeTradeRoute({
        ...proposed,
        status: "PROPOSED",
        level: 1,
        proposedByUs: true,
        markers: [],
      }),
    ],
    partners: current.partners.filter((partner) => partner.id !== proposed.partner.id),
  };
};

/** Open an accepted proposal with its new markers. */
export const getActivatedTradeRoutes = (
  current: RoutesView,
  activated: {
    routeId: string;
    markers: { id: string; sector: number; control: number }[];
  },
): RoutesView | undefined => {
  const route = current?.routes.find((row) => row.id === activated.routeId);
  if (!current || route?.status !== "PROPOSED") return;
  return {
    ...current,
    routes: current.routes.map((row) =>
      row === route
        ? describeTradeRoute({
            ...row,
            status: "ACTIVE",
            markers: activated.markers.map((marker) => ({
              ...marker,
              controller: null,
            })),
          })
        : row,
    ),
  };
};

/** Remove a declined or closed route and offer its partner again. */
export const getRemovedTradeRoutes = (
  current: RoutesView,
  removed: {
    routeId: string;
    partner: { id: string; name: string; block: string | null };
  },
): RoutesView | undefined => {
  const route = current?.routes.find((row) => row.id === removed.routeId);
  if (!current || !route) return;
  return {
    ...current,
    routes: current.routes.filter((row) => row !== route),
    partners: current.partners.some((partner) => partner.id === removed.partner.id)
      ? current.partners
      : [...current.partners, removed.partner],
  };
};

/** Show an upgraded route's level and travel times; another level change needs a read. */
export const getUpgradedTradeRoutes = (
  current: RoutesView,
  upgraded: { routeId: string; level: number },
): RoutesView | undefined => {
  const route = current?.routes.find((row) => row.id === upgraded.routeId);
  if (!current || route?.level !== upgraded.level - 1) return;
  return {
    ...current,
    routes: current.routes.map((row) =>
      row === route ? describeTradeRoute({ ...row, level: upgraded.level }) : row,
    ),
  };
};

/** List a caravan the viewer's village just prepared, newest first, awaiting escorts. */
export const getPreparedCaravans = (
  current: CaravansView,
  prepared: Pick<CaravanEntry, "id" | "partner" | "cargo" | "travelMinutes" | "sector">,
): CaravansView | undefined => {
  if (!current) return;
  if (current.caravans.some((row) => row.id === prepared.id)) return current;
  return {
    ...current,
    caravans: [
      {
        ...prepared,
        status: "PREPARING",
        outgoing: true,
        lossPercent: 0,
        delayMinutes: 0,
        departedAt: null,
        arrivesAt: null,
        progress: 0,
        checkpoints: 0,
        disrupted: false,
        guards: [],
        openSlots: CARAVAN_GUARD_SLOTS,
        encounter: null,
        sabotage: [],
        viewer: null,
      },
      ...current.caravans,
    ],
  };
};

/** Move a cancelled caravan with its full manifest into the latest finished caravans. */
export const getCancelledCaravans = (
  current: CaravansView,
  cancelled: { caravanId: string; resolvedAt: Date },
): CaravansView | undefined => {
  const row = current?.caravans.find((entry) => entry.id === cancelled.caravanId);
  if (!current || row?.status !== "PREPARING") return;
  return {
    ...current,
    caravans: current.caravans.filter((entry) => entry !== row),
    history: [
      {
        id: row.id,
        status: "CANCELLED" as const,
        outgoing: row.outgoing,
        partner: row.partner,
        cargo: row.cargo,
        lossPercent: row.lossPercent,
        resolvedAt: cancelled.resolvedAt,
      },
      ...current.history,
    ].slice(0, CARAVAN_HISTORY_SIZE),
  };
};

/**
 * Whether the village's Warehouse stock moved between two caravan lists it was shown:
 * preparing reserves and departing removes the origin's stock, a cancellation returns it
 * to the origin and a delivery credits the destination. A caravan that left the list
 * without a history entry may have done either, so it counts as moved.
 */
export const hasCaravanStockMoved = (
  shown: CaravansView | undefined,
  current: CaravansView | undefined,
) => {
  if (!shown || !current) return false;
  const before = new Map(shown.caravans.map((row) => [row.id, row]));
  const open = new Set(current.caravans.map((row) => row.id));
  return (
    current.caravans.some((row) => {
      const was = before.get(row.id);
      return (
        row.outgoing &&
        (!was || (was.status === "PREPARING" && row.status === "TRAVELLING"))
      );
    }) ||
    shown.caravans.some((row) => {
      if (open.has(row.id)) return false;
      const finished = current.history.find((entry) => entry.id === row.id);
      return (
        !finished || finished.status === (finished.outgoing ? "CANCELLED" : "DELIVERED")
      );
    })
  );
};

/** Start a dispatched caravan's journey from its origin. */
export const getDepartedCaravans = (
  current: CaravansView,
  departed: Pick<
    CaravanEntry,
    "departedAt" | "arrivesAt" | "travelMinutes" | "sector"
  > & {
    caravanId: string;
  },
): CaravansView | undefined =>
  updateCaravan(current, departed.caravanId, (row) =>
    row.status === "PREPARING"
      ? {
          ...row,
          status: "TRAVELLING",
          departedAt: departed.departedAt,
          arrivesAt: departed.arrivesAt,
          travelMinutes: departed.travelMinutes,
          sector: departed.sector,
          progress: 0,
          checkpoints: 0,
          viewer: row.viewer && { ...row.viewer, canCheckIn: false },
        }
      : undefined,
  );

/** Add the viewer to a caravan's escort, queued at departure. */
export const getJoinedEscortCaravans = (
  current: CaravansView,
  caravanId: string,
  guard: Pick<
    CaravanEntry["guards"][number],
    "userId" | "username" | "avatar" | "level"
  >,
): CaravansView | undefined =>
  updateCaravan(current, caravanId, (row) =>
    row.guards.some((entry) => entry.userId === guard.userId) || row.openSlots <= 0
      ? undefined
      : {
          ...row,
          guards: [...row.guards, { ...guard, status: "QUEUED", objectives: 0 }],
          openSlots: row.openSlots - 1,
          viewer: { status: "QUEUED", objectives: 0, canCheckIn: false },
        },
  );

/** Remove the viewer from a caravan's escort before departure. */
export const getLeftEscortCaravans = (
  current: CaravansView,
  caravanId: string,
  userId: string,
): CaravansView | undefined =>
  updateCaravan(current, caravanId, (row) =>
    row.guards.some((entry) => entry.userId === userId)
      ? {
          ...row,
          guards: row.guards.filter((entry) => entry.userId !== userId),
          openSlots: row.openSlots + 1,
          viewer: null,
        }
      : undefined,
  );

/** Queue the viewer with their caravan again after a fight. */
export const getRejoinedEscortCaravans = (
  current: CaravansView,
  caravanId: string,
  userId: string,
): CaravansView | undefined =>
  updateCaravan(current, caravanId, (row) =>
    row.viewer
      ? {
          ...row,
          guards: row.guards.map((entry) =>
            entry.userId === userId ? { ...entry, status: "QUEUED" } : entry,
          ),
          viewer: { ...row.viewer, status: "QUEUED" },
        }
      : undefined,
  );

/** Credit the viewer's check-in at the checkpoint their caravan passed. */
export const getCheckedInCaravans = (
  current: CaravansView,
  caravanId: string,
  userId: string,
): CaravansView | undefined =>
  updateCaravan(current, caravanId, (row) =>
    row.viewer
      ? {
          ...row,
          guards: row.guards.map((entry) =>
            entry.userId === userId
              ? { ...entry, objectives: entry.objectives + 1 }
              : entry,
          ),
          viewer: {
            ...row.viewer,
            objectives: row.viewer.objectives + 1,
            canCheckIn: false,
          },
        }
      : undefined,
  );

/** Remove sabotage an escort stopped without a fight. */
export const getStoppedSabotageCaravans = (
  current: CaravansView,
  caravanId: string,
  operationId: string,
): CaravansView | undefined =>
  updateCaravan(current, caravanId, (row) => ({
    ...row,
    sabotage: row.sabotage.filter((op) => op.id !== operationId),
  }));

/** Show whether the viewer now practises banditry. */
export const getBanditControls = (current: ControlsView, enabled: boolean) => ({
  ...current,
  bandit: { ...current.bandit, enabled },
});

/** List the operation the viewer just started among their latest ones. */
export const getStartedOperationControls = (
  current: ControlsView,
  operation: ControlsView["operations"][number],
): ControlsView => ({
  ...current,
  operations: [
    operation,
    ...current.operations.filter((row) => row.id !== operation.id),
  ].slice(0, CARAVAN_OPERATION_HISTORY_SIZE),
});

/** Show where the viewer last saw a tracked caravan. */
export const getTrackedControls = (
  current: ControlsView,
  sighting: { caravanId: string; sector: number; seenAt: Date },
): ControlsView | undefined =>
  updateControlsCaravan(current, sighting.caravanId, (row) => ({
    ...row,
    lastSector: sighting.sector,
    seenAt: sighting.seenAt,
    inSector: row.status === "TRAVELLING" && sighting.sector === current.sector,
  }));

/** Commit the viewer to an interception group with the caravan's groups as confirmed. */
export const getGroupControls = (
  current: ControlsView,
  group: {
    commitment: NonNullable<ControlsView["commitment"]>;
    groups: ControlsCaravan["groups"];
  },
): ControlsView | undefined => {
  const updated = updateControlsCaravan(current, group.commitment.caravanId, (row) => ({
    ...row,
    groups: group.groups,
  }));
  return updated && { ...updated, commitment: group.commitment };
};

/**
 * Release the viewer from their interception group, disbanding it when they led it. The
 * group they left opens to them again while they still know where the caravan is.
 */
export const getLeftGroupControls = (
  current: ControlsView,
  left: { caravanId: string; userId: string },
): ControlsView | undefined => {
  const updated = updateControlsCaravan(current, left.caravanId, (row) => ({
    ...row,
    groups: row.groups.flatMap((group) => {
      if (group.leaderId === left.userId) return [];
      const members = group.members.filter((member) => member.userId !== left.userId);
      return members.length === group.members.length
        ? [group]
        : [
            {
              ...group,
              members,
              joinable: row.lastSector !== null && members.length < CARAVAN_MAX_GROUP,
            },
          ];
    }),
  }));
  return updated && { ...updated, commitment: null };
};

/** Remove stolen goods the viewer claimed. */
export const getClaimedLootControls = (
  current: ControlsView,
  caravanId: string,
): ControlsView | undefined =>
  current.loot.some((row) => row.caravanId === caravanId)
    ? { ...current, loot: current.loot.filter((row) => row.caravanId !== caravanId) }
    : undefined;

const updateCaravan = (
  current: CaravansView,
  caravanId: string,
  update: (row: CaravanEntry) => CaravanEntry | undefined,
): CaravansView | undefined => {
  const row = current?.caravans.find((entry) => entry.id === caravanId);
  const next = row && update(row);
  if (!current || !next) return;
  return {
    ...current,
    caravans: current.caravans.map((entry) => (entry === row ? next : entry)),
  };
};

const updateControlsCaravan = (
  current: ControlsView,
  caravanId: string,
  update: (row: ControlsCaravan) => ControlsCaravan,
): ControlsView | undefined => {
  const row = current.caravans.find((entry) => entry.id === caravanId);
  if (!row) return;
  return {
    ...current,
    caravans: current.caravans.map((entry) => (entry === row ? update(row) : entry)),
  };
};
