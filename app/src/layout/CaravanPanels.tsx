"use client";

import {
  CircleArrowUp,
  Flag,
  Handshake,
  MapPin,
  Package,
  Shield,
  Swords,
  X,
} from "lucide-react";
import { useState } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CARAVAN_CHECKPOINTS,
  CARAVAN_GUARD_SLOTS,
  CARAVAN_MAX_CARGO_ITEMS,
  CARAVAN_MAX_CARGO_UNITS,
  CARAVAN_MIN_CARGO_UNITS,
  CARAVANS_PER_TRADE_ROUTE,
  TRADE_ROUTE_MARKER_MAX_CONTROL,
} from "@/drizzle/constants";
import type { useCaravans } from "@/hooks/useCaravans";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import { cn } from "@/libs/shadui";
import { useRequiredUserData } from "@/utils/UserContext";

type RouteData = NonNullable<RouterOutputs["tradeRoute"]["getRoutes"]>;
type CaravanData = NonNullable<RouterOutputs["caravan"]["getCaravans"]>;
type WarehouseData = NonNullable<RouterOutputs["warehouse"]["getWarehouse"]>;
type CaravanActions = ReturnType<typeof useCaravans>;

/** Agreements with other villages, their markers and upgrades. */
export const TradeRoutesPanel = ({
  data,
  actions,
}: {
  data: RouteData;
  actions: CaravanActions;
}) => {
  const [partnerId, setPartnerId] = useState<string>();
  const partner = data.partners.find((row) => row.id === partnerId);
  return (
    <ContentBox
      title="Trade Routes"
      subtitle={`${data.capacity.used} of ${data.capacity.total} caravans on the road · every active route adds ${CARAVANS_PER_TRADE_ROUTE}`}
      initialBreak
    >
      <div className="@container">
        {data.canManage && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Select value={partnerId} onValueChange={setPartnerId}>
              <SelectTrigger
                className="min-w-48 grow basis-48"
                aria-label="Trade partner"
              >
                <SelectValue placeholder="Propose a route to…" />
              </SelectTrigger>
              <SelectContent>
                {data.partners.map((row) => (
                  <SelectItem key={row.id} value={row.id} disabled={!!row.block}>
                    {row.name}
                    {row.block ? ` · ${row.block}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              disabled={!partner || !!partner.block || actions.propose.isPending}
              loading={actions.propose.isPending}
              onClick={() =>
                partner && actions.propose.mutate({ villageId: partner.id })
              }
            >
              <Handshake className="mr-2 size-4" aria-hidden />
              Propose
            </Button>
          </div>
        )}
        {data.routes.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No trade routes yet. Allied and neutral villages with a Warehouse can agree
            one.
          </p>
        ) : (
          <ul
            className={cn("grid gap-2", data.routes.length > 1 && "@2xl:grid-cols-2")}
          >
            {data.routes.map((route) => (
              <li key={route.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="grow font-semibold">{route.partner.name}</p>
                  {route.status === "PROPOSED" ? (
                    <Badge variant="outline">
                      {route.proposedByUs ? "Awaiting answer" : "Proposal received"}
                    </Badge>
                  ) : route.blocked ? (
                    <Badge variant="destructive">Cut off</Badge>
                  ) : (
                    <Badge>Active</Badge>
                  )}
                </div>
                <p className="text-muted-foreground text-sm">
                  Level {route.level}/{route.maxLevel} · {route.travelMinutes} min
                  travel · {route.sectors} sectors
                </p>
                {route.markers.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1">
                    {route.markers.map((marker) => (
                      <li key={marker.id}>
                        <Badge
                          variant={marker.controller ? "destructive" : "secondary"}
                          title={
                            marker.controller
                              ? `Held by ${marker.controller}`
                              : `Control ${marker.control}/${TRADE_ROUTE_MARKER_MAX_CONTROL}`
                          }
                        >
                          <MapPin className="mr-1 size-3" aria-hidden />
                          {marker.sector}
                          {marker.controller
                            ? ` · ${marker.controller}`
                            : ` · ${marker.control}%`}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
                {data.canManage && (
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    {route.status === "PROPOSED" && !route.proposedByUs && (
                      <>
                        <Button
                          size="sm"
                          disabled={actions.respond.isPending}
                          onClick={() =>
                            actions.respond.mutate({ routeId: route.id, accept: true })
                          }
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={actions.respond.isPending}
                          onClick={() =>
                            actions.respond.mutate({ routeId: route.id, accept: false })
                          }
                        >
                          Decline
                        </Button>
                      </>
                    )}
                    {route.status === "ACTIVE" && route.nextTravelMinutes !== null && (
                      <Confirm
                        title="Upgrade trade route"
                        proceed_label="Upgrade"
                        onAccept={() =>
                          actions.upgradeRoute.mutate({ routeId: route.id })
                        }
                        button={
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={actions.upgradeRoute.isPending}
                          >
                            <CircleArrowUp className="mr-1 size-4" aria-hidden />
                            Upgrade
                          </Button>
                        }
                      >
                        Spend {route.upgradeCost.toLocaleString()} {data.fundsLabel} to
                        cut travel from {route.travelMinutes} to{" "}
                        {route.nextTravelMinutes} minutes.
                      </Confirm>
                    )}
                    <Confirm
                      title={
                        route.status === "PROPOSED"
                          ? "Withdraw proposal"
                          : "Close route"
                      }
                      proceed_label="Close"
                      onAccept={() => actions.closeRoute.mutate({ routeId: route.id })}
                      button={
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={actions.closeRoute.isPending}
                        >
                          <X className="mr-1 size-4" aria-hidden />
                          {route.status === "PROPOSED" && route.proposedByUs
                            ? "Withdraw"
                            : "Close"}
                        </Button>
                      }
                    >
                      Caravans already on the road still arrive; unsent ones are called
                      off.
                    </Confirm>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </ContentBox>
  );
};

/** Shipments in preparation and on the road, with escort duty and shipping controls. */
export const CaravansPanel = ({
  data,
  routes,
  warehouse,
  actions,
}: {
  data: CaravanData;
  routes: RouteData;
  warehouse: WarehouseData;
  actions: CaravanActions;
}) => {
  const { data: user, timeDiff } = useRequiredUserData();
  const now = Date.now() - timeDiff;
  return (
    <ContentBox
      title="Caravans"
      subtitle={`Escort caravans for pay; ${CARAVAN_GUARD_SLOTS} escorts per caravan`}
      initialBreak
    >
      <div className="@container">
        {data.canManage && (
          <PrepareCaravan routes={routes} warehouse={warehouse} actions={actions} />
        )}
        {data.caravans.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No caravans are preparing or travelling.
          </p>
        ) : (
          <ul
            className={cn("grid gap-2", data.caravans.length > 1 && "@3xl:grid-cols-2")}
          >
            {data.caravans.map((row) => {
              const isGuard = !!row.viewer;
              const fighting = row.encounter && row.encounter.status !== "PENDING";
              return (
                <li key={row.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Package className="size-5 text-orange-500" aria-hidden />
                    <p className="grow font-semibold">
                      {row.outgoing ? `To ${row.partner}` : `From ${row.partner}`}
                    </p>
                    <Badge
                      variant={row.status === "TRAVELLING" ? "default" : "outline"}
                    >
                      {row.status === "TRAVELLING" ? "On the road" : "Preparing"}
                    </Badge>
                    {row.disrupted && <Badge variant="destructive">Disrupted</Badge>}
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {row.cargo
                      .map((line) => `${line.quantity} ${line.name}`)
                      .join(", ")}
                    {row.lossPercent > 0 ? ` · lost ${row.lossPercent}%` : ""}
                  </p>
                  {row.status === "TRAVELLING" && row.arrivesAt && (
                    <div className="mt-2">
                      <Progress value={Math.round(row.progress * 100)} />
                      <p className="text-muted-foreground mt-1 text-xs">
                        Sector {row.sector} · checkpoint {row.checkpoints}/
                        {CARAVAN_CHECKPOINTS} · arrives{" "}
                        {new Date(row.arrivesAt).toLocaleTimeString()}
                        {row.delayMinutes ? ` (+${row.delayMinutes} min delay)` : ""}
                      </p>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <Shield className="size-4" aria-hidden />
                    {row.guards.map((guard) => (
                      <Badge
                        key={guard.userId}
                        variant="secondary"
                        title={guard.status}
                      >
                        {guard.username}
                        {guard.objectives ? ` · ${guard.objectives}★` : ""}
                      </Badge>
                    ))}
                    {Array.from({ length: row.openSlots }, (_, i) => (
                      <Badge key={`open-${i}`} variant="outline">
                        Open slot
                      </Badge>
                    ))}
                  </div>
                  {row.encounter && (
                    <div className="bg-destructive/10 mt-2 flex flex-wrap items-center gap-2 rounded-md p-2 text-sm">
                      <Swords className="text-destructive size-4" aria-hidden />
                      <span className="grow">
                        {row.encounter.type === "AMBUSH" &&
                        row.encounter.status === "PENDING"
                          ? `Bandits ambush the caravan until ${new Date(row.encounter.expiresAt ?? now).toLocaleTimeString()}`
                          : "A fight over the caravan is underway"}
                      </span>
                      {isGuard && row.encounter.type === "AMBUSH" && !fighting && (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={
                            actions.defend.isPending || row.viewer?.status !== "QUEUED"
                          }
                          onClick={() =>
                            row.encounter &&
                            actions.defend.mutate({
                              caravanId: row.id,
                              encounterId: row.encounter.id,
                            })
                          }
                        >
                          Defend
                        </Button>
                      )}
                    </div>
                  )}
                  {row.sabotage.map((op) => (
                    <div
                      key={op.id}
                      className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-orange-500/10 p-2 text-sm"
                    >
                      <span className="grow">
                        {op.username} is{" "}
                        {op.type === "DELAY" ? "delaying" : "disrupting"} the caravan
                        until {new Date(op.finishesAt).toLocaleTimeString()}
                      </span>
                      {isGuard && (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={
                            actions.intervene.isPending ||
                            row.viewer?.status !== "QUEUED"
                          }
                          onClick={() =>
                            actions.intervene.mutate({
                              caravanId: row.id,
                              operationId: op.id,
                            })
                          }
                        >
                          Intervene
                        </Button>
                      )}
                    </div>
                  ))}
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    {row.outgoing &&
                      !isGuard &&
                      row.status === "PREPARING" &&
                      row.openSlots > 0 && (
                        <Button
                          size="sm"
                          disabled={
                            actions.joinEscort.isPending || user?.status !== "AWAKE"
                          }
                          onClick={() =>
                            actions.joinEscort.mutate({ caravanId: row.id })
                          }
                        >
                          <Shield className="mr-1 size-4" aria-hidden />
                          Join escort
                        </Button>
                      )}
                    {isGuard && row.status === "PREPARING" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actions.leaveEscort.isPending}
                        onClick={() =>
                          actions.leaveEscort.mutate({ caravanId: row.id })
                        }
                      >
                        Leave escort
                      </Button>
                    )}
                    {isGuard && row.viewer?.canCheckIn && (
                      <Button
                        size="sm"
                        disabled={actions.checkIn.isPending}
                        onClick={() => actions.checkIn.mutate({ caravanId: row.id })}
                      >
                        <Flag className="mr-1 size-4" aria-hidden />
                        Check in
                      </Button>
                    )}
                    {isGuard &&
                      row.status === "TRAVELLING" &&
                      row.viewer?.status === "AWAKE" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={actions.rejoinEscort.isPending}
                          onClick={() =>
                            actions.rejoinEscort.mutate({ caravanId: row.id })
                          }
                        >
                          Rejoin escort
                        </Button>
                      )}
                    {data.canManage && row.outgoing && row.status === "PREPARING" && (
                      <>
                        <Confirm
                          title="Cancel caravan"
                          proceed_label="Cancel caravan"
                          onAccept={() => actions.cancel.mutate({ caravanId: row.id })}
                          button={
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={actions.cancel.isPending}
                            >
                              Cancel
                            </Button>
                          }
                        >
                          The reserved cargo returns to the Warehouse and the escort is
                          released.
                        </Confirm>
                        <Button
                          size="sm"
                          disabled={actions.dispatch.isPending}
                          onClick={() => actions.dispatch.mutate({ caravanId: row.id })}
                        >
                          Dispatch
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {data.history.length > 0 && (
          <div className="mt-3">
            <h3 className="font-semibold">Recent caravans</h3>
            <ul className="mt-2 divide-y text-sm">
              {data.history.map((row) => (
                <li key={row.id} className="flex flex-wrap gap-x-2 py-1">
                  <Badge variant={row.status === "DELIVERED" ? "secondary" : "outline"}>
                    {row.status === "DELIVERED" ? "Delivered" : "Cancelled"}
                  </Badge>
                  <span className="grow">
                    {row.outgoing ? `To ${row.partner}` : `From ${row.partner}`}:{" "}
                    {row.cargo
                      .map((line) => `${line.quantity} ${line.name}`)
                      .join(", ")}
                  </span>
                  {row.resolvedAt && (
                    <span className="text-muted-foreground text-xs">
                      {new Date(row.resolvedAt).toLocaleString()}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </ContentBox>
  );
};

/** Choose a route and reserve cargo for a new caravan. */
const PrepareCaravan = ({
  routes,
  warehouse,
  actions,
}: {
  routes: RouteData;
  warehouse: WarehouseData;
  actions: CaravanActions;
}) => {
  const active = routes.routes.filter(
    (route) => route.status === "ACTIVE" && !route.blocked,
  );
  const [routeId, setRouteId] = useState<string>();
  const [cargo, setCargo] = useState<Record<string, number>>({});
  const lines = Object.entries(cargo)
    .filter(([, quantity]) => quantity > 0)
    .map(([itemId, quantity]) => ({ itemId, quantity }));
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  // An entry outside its limits holds NaN, and free stock can shrink below an entered
  // quantity; either blocks the reservation until corrected.
  const hasInvalidCargo = Object.entries(cargo).some(([itemId, quantity]) => {
    const row = warehouse.stock.find((stock) => stock.itemId === itemId);
    return Number.isNaN(quantity) || quantity > (row ? row.quantity - row.reserved : 0);
  });
  // Chosen goods stay listed after their free stock runs out, so they can be set to zero.
  const available = warehouse.stock.filter(
    (row) => row.quantity - row.reserved > 0 || isChosen(cargo[row.itemId]),
  );
  const full = routes.capacity.used >= routes.capacity.total;
  if (active.length === 0)
    return (
      <p className="text-muted-foreground mb-3 text-sm">
        Agree an active trade route to send caravans.
      </p>
    );
  return (
    <div className="mb-4 rounded-md border p-3">
      <h3 className="font-semibold">Prepare a caravan</h3>
      <div className="mt-2 grid gap-2 @2xl:grid-cols-[1fr_2fr]">
        <Select value={routeId} onValueChange={setRouteId}>
          <SelectTrigger aria-label="Trade route">
            <SelectValue placeholder="Route" />
          </SelectTrigger>
          <SelectContent>
            {active.map((route) => (
              <SelectItem key={route.id} value={route.id}>
                {route.partner.name} · {route.travelMinutes} min
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ul className="grid gap-1 @md:grid-cols-2">
          {available.map((row) => {
            const free = row.quantity - row.reserved;
            const chosen = isChosen(cargo[row.itemId]);
            return (
              <li key={row.itemId} className="flex items-center gap-2 text-sm">
                <span className="grow truncate" title={row.name}>
                  {row.name} <span className="text-muted-foreground">({free})</span>
                </span>
                <NumberInput
                  optional
                  aria-label={`Units of ${row.name} to ship`}
                  className="w-20"
                  min={0}
                  max={free}
                  value={cargo[row.itemId]}
                  onOptionalValueChange={(value) =>
                    setCargo((prev) => ({ ...prev, [row.itemId]: value ?? 0 }))
                  }
                  disabled={!chosen && lines.length >= CARAVAN_MAX_CARGO_ITEMS}
                />
              </li>
            );
          })}
        </ul>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="text-muted-foreground grow text-xs">
          {units.toLocaleString()} / {CARAVAN_MAX_CARGO_UNITS.toLocaleString()} units
          (at least {CARAVAN_MIN_CARGO_UNITS}) · {lines.length}/
          {CARAVAN_MAX_CARGO_ITEMS} goods
          {full ? " · every route already has a caravan out" : ""}
        </p>
        <Button
          disabled={
            !routeId ||
            hasInvalidCargo ||
            units < CARAVAN_MIN_CARGO_UNITS ||
            units > CARAVAN_MAX_CARGO_UNITS ||
            full ||
            actions.prepare.isPending
          }
          loading={actions.prepare.isPending}
          onClick={() =>
            routeId &&
            actions.prepare.mutate(
              { routeId, cargo: lines },
              { onSuccess: (result) => result.success && setCargo({}) },
            )
          }
        >
          <Package className="mr-2 size-4" aria-hidden />
          Reserve cargo
        </Button>
      </div>
    </div>
  );
};

/** Whether a cargo entry is part of the shipment, including one still being corrected. */
const isChosen = (quantity: number | undefined) =>
  quantity !== undefined && quantity !== 0;
