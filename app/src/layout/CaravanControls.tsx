"use client";

import {
  Binoculars,
  Caravan,
  Footprints,
  Gift,
  Hourglass,
  MapPin,
  Search,
  Swords,
  Users,
  Zap,
} from "lucide-react";
import { useRef, useState } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  BANDIT_OPERATION_EXP,
  CARAVAN_DELAY_MINUTES,
  CARAVAN_DISRUPTION_MINUTES,
  CARAVAN_MAX_GROUP,
  CARAVAN_SABOTAGE_MINUTES,
  TRADE_ROUTE_MARKER_MAX_CONTROL,
} from "@/drizzle/constants";
import { useCaravans } from "@/hooks/useCaravans";
import Modal from "@/layout/Modal";
import { cn } from "@/libs/shadui";
import { useRequiredUserData } from "@/utils/UserContext";

type Controls = NonNullable<RouterOutputs["caravanOps"]["getControls"]>;
type Actions = ReturnType<typeof useCaravans>;

/** Travel-map trigger opening the caravan scouting, sabotage and bandit controls. */
export const CaravanControls = ({ className }: { className: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Caravans"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className={className}
        onClick={() => setIsOpen(true)}
      >
        <Caravan className="h-7 w-7 hover:text-orange-500" aria-hidden />
      </button>
      {isOpen && (
        <Modal
          title="Caravans"
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          returnFocusRef={triggerRef}
          className="sm:max-w-3xl md:max-w-3xl"
        >
          <CaravanControlsPanel />
        </Modal>
      )}
    </>
  );
};

/** Everything a player can do against caravans and route markers from their sector. */
const CaravanControlsPanel = () => {
  const actions = useCaravans({ controls: true });
  const { timeDiff } = useRequiredUserData();
  const data = actions.operations.data;
  if (!data) return <p className="text-sm">Loading caravan intelligence…</p>;
  const now = Date.now() - timeDiff;
  const running = data.operations.find((op) => op.status === "ACTIVE");
  const canScout = !data.isOutlaw || data.bandit.enabled;
  return (
    <div className="@container grid gap-4 text-sm">
      <RoleSummary data={data} actions={actions} />
      <section>
        <h3 className="mb-1 font-semibold">Scouting</h3>
        {running ? (
          <p className="flex items-center gap-2">
            <Hourglass className="size-4" aria-hidden />
            {OPERATION_LABELS[running.type]} finishes at{" "}
            {new Date(new Date(running.finishesAt).getTime()).toLocaleTimeString()}
          </p>
        ) : (
          <div className="grid gap-2 @md:grid-cols-2">
            <Button
              variant="outline"
              disabled={!canScout || actions.startOperation.isPending}
              onClick={() => actions.startOperation.mutate({ type: "INVESTIGATE" })}
            >
              <Binoculars className="mr-2 size-4" aria-hidden />
              Investigate trade activity
            </Button>
            <Button
              variant="outline"
              disabled={!canScout || actions.startOperation.isPending}
              onClick={() => actions.startOperation.mutate({ type: "SEARCH" })}
            >
              <Search className="mr-2 size-4" aria-hidden />
              Search sector {data.sector}
            </Button>
          </div>
        )}
        {data.operations.filter((op) => op.status !== "ACTIVE").length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1">
            {data.operations
              .filter((op) => op.status !== "ACTIVE")
              .map((op) => (
                <li key={op.id}>
                  <Badge variant={op.succeeds ? "default" : "outline"}>
                    {OPERATION_LABELS[op.type]}:{" "}
                    {op.status === "INTERRUPTED"
                      ? "stopped by escorts"
                      : op.succeeds
                        ? "succeeded"
                        : "failed"}{" "}
                    · {new Date(op.finishesAt).toLocaleTimeString()}
                  </Badge>
                </li>
              ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="mb-1 font-semibold">Known caravans</h3>
        {data.caravans.length === 0 ? (
          <p className="text-muted-foreground">
            Investigate trade activity or search sectors to find caravans.
          </p>
        ) : (
          <ul
            className={cn("grid gap-2", data.caravans.length > 1 && "@2xl:grid-cols-2")}
          >
            {data.caravans.map((row) => (
              <KnownCaravan
                key={row.id}
                row={row}
                data={data}
                actions={actions}
                running={!!running}
                now={now}
              />
            ))}
          </ul>
        )}
      </section>
      {data.loot.length > 0 && (
        <section>
          <h3 className="mb-1 font-semibold">Stolen goods</h3>
          <ul className="grid gap-2">
            {data.loot.map((row) => (
              <li
                key={row.caravanId}
                className="flex flex-wrap items-center gap-2 rounded-md border p-2"
              >
                <span className="grow">
                  {row.lines.map((line) => `${line.quantity} ${line.name}`).join(", ")}
                </span>
                <Button
                  size="sm"
                  disabled={actions.claimLoot.isPending}
                  onClick={() => actions.claimLoot.mutate({ caravanId: row.caravanId })}
                >
                  <Gift className="mr-1 size-4" aria-hidden />
                  Claim
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className="mb-1 font-semibold">
          Trade route markers in sector {data.sector}
        </h3>
        {data.markers.length === 0 ? (
          <p className="text-muted-foreground">
            No known markers here. Village shinobi reveal hidden markers by searching a
            sector.
          </p>
        ) : (
          <ul className="grid gap-2 @md:grid-cols-2">
            {data.markers.map((marker) => (
              <li key={marker.id} className="rounded-md border p-2">
                <p className="flex items-center gap-1 font-semibold">
                  <MapPin className="size-4" aria-hidden />
                  {marker.route}
                </p>
                <p className="text-muted-foreground">
                  {marker.controller
                    ? `Held by ${marker.controller}`
                    : "Held by the route"}
                </p>
                <Progress
                  className="my-1"
                  value={(marker.control / TRADE_ROUTE_MARKER_MAX_CONTROL) * 100}
                />
                <Button
                  size="sm"
                  className="mt-1 w-full"
                  variant="destructive"
                  disabled={!marker.canAssault || actions.assaultMarker.isPending}
                  onClick={() => actions.assaultMarker.mutate({ markerId: marker.id })}
                >
                  <Swords className="mr-1 size-4" aria-hidden />
                  Assault marker
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

/** The player's side: bandit rank for outlaws, covert chance for village shinobi. */
const RoleSummary = ({ data, actions }: { data: Controls; actions: Actions }) => {
  if (!data.isOutlaw)
    return (
      <p className="bg-muted rounded-md p-2">
        Shinobi of villages hostile to a caravan's owners can scout and sabotage it.
        Your covert success chance is {Math.round(data.stealthChance)}%, from your
        stealth.
      </p>
    );
  const { bandit } = data;
  return (
    <section className="bg-muted rounded-md p-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="grow font-semibold">Bandit profession</h3>
        <div className="flex items-center gap-2">
          <Switch
            id="bandit-profession"
            checked={bandit.enabled}
            disabled={actions.setBandit.isPending}
            onCheckedChange={(enabled) => actions.setBandit.mutate({ enabled })}
          />
          <label htmlFor="bandit-profession">
            {bandit.enabled ? "Active" : "Inactive"}
          </label>
        </div>
      </div>
      <p>
        {bandit.rank} · {bandit.experience.toLocaleString()} XP · {bandit.chance}%
        success · scouting takes {bandit.scoutMinutes} min · robberies steal{" "}
        {bandit.stealPercent}%
      </p>
      <Progress className="mt-1" value={bandit.progress} />
      <p className="text-muted-foreground mt-1 text-xs">
        Each successful operation or robbery earns {BANDIT_OPERATION_EXP} XP
        {bandit.nextRank
          ? ` · next rank at ${bandit.nextRankExperience?.toLocaleString()} XP`
          : ""}
      </p>
    </section>
  );
};

/** A caravan the player knows of, with tracking, sabotage and interception controls. */
const KnownCaravan = ({
  row,
  data,
  actions,
  running,
  now,
}: {
  row: Controls["caravans"][number];
  data: Controls;
  actions: Actions;
  running: boolean;
  now: number;
}) => {
  const committedHere = data.commitment?.caravanId === row.id;
  const myLeaderId = committedHere ? data.commitment?.groupLeaderId : undefined;
  const leading = !!myLeaderId && myLeaderId === data.commitment?.userId;
  const travelling = row.status === "TRAVELLING";
  const arrivesFirst =
    !row.arrivesAt ||
    new Date(row.arrivesAt).getTime() <= now + CARAVAN_SABOTAGE_MINUTES * 60_000;
  const canSabotage = row.inSector && !arrivesFirst && !running;
  const arrived = !row.arrivesAt || new Date(row.arrivesAt).getTime() <= now;
  return (
    <li className="rounded-md border p-2">
      <p className="font-semibold">
        {row.origin} → {row.destination}
      </p>
      <p className="text-muted-foreground">
        {travelling
          ? `Departed ${row.departedAt ? new Date(row.departedAt).toLocaleTimeString() : ""}, arrives ${row.arrivesAt ? new Date(row.arrivesAt).toLocaleTimeString() : ""}`
          : "Preparing to depart"}
        {row.lastSector !== null
          ? ` · seen in sector ${row.lastSector} ${row.seenAt ? `${Math.max(0, Math.round((now - new Date(row.seenAt).getTime()) / 60_000))} min ago` : ""}`
          : ""}
      </p>
      <div className="mt-1 flex flex-wrap gap-1">
        {row.inSector && <Badge variant="destructive">In your sector</Badge>}
        <Badge variant="outline">
          {row.guards} escort{row.guards === 1 ? "" : "s"}
        </Badge>
        {row.role && (
          <Badge variant="secondary">
            {row.role === "BANDIT" ? "Robbery" : "Hostile"}
          </Badge>
        )}
      </div>
      {row.role && travelling && (
        <div className="mt-2 grid gap-1 @md:grid-cols-2">
          <Button
            size="sm"
            variant="outline"
            title={
              row.lastSector === null
                ? "Search the caravan's sector to sight it first"
                : undefined
            }
            disabled={row.lastSector === null || actions.track.isPending}
            onClick={() => actions.track.mutate({ caravanId: row.id })}
          >
            <Footprints className="mr-1 size-4" aria-hidden />
            Track
          </Button>
          {row.role === "ENEMY" && (
            <>
              <Button
                size="sm"
                variant="outline"
                title={
                  arrivesFirst
                    ? "The caravan arrives before sabotage could finish"
                    : `Removes an NPC guard from fights for ${CARAVAN_DISRUPTION_MINUTES} minutes`
                }
                disabled={!canSabotage || actions.startOperation.isPending}
                onClick={() =>
                  actions.startOperation.mutate({ type: "DISRUPT", caravanId: row.id })
                }
              >
                <Zap className="mr-1 size-4" aria-hidden />
                Disrupt
              </Button>
              <Button
                size="sm"
                variant="outline"
                title={
                  arrivesFirst
                    ? "The caravan arrives before sabotage could finish"
                    : `Adds ${CARAVAN_DELAY_MINUTES} minutes of travel`
                }
                disabled={!canSabotage || actions.startOperation.isPending}
                onClick={() =>
                  actions.startOperation.mutate({ type: "DELAY", caravanId: row.id })
                }
              >
                <Hourglass className="mr-1 size-4" aria-hidden />
                Delay
              </Button>
            </>
          )}
          {!committedHere && row.lastSector !== null && (
            <Button
              size="sm"
              variant="outline"
              disabled={!!data.commitment || actions.formGroup.isPending}
              onClick={() => actions.formGroup.mutate({ caravanId: row.id })}
            >
              <Users className="mr-1 size-4" aria-hidden />
              Form group
            </Button>
          )}
        </div>
      )}
      {row.groups.length > 0 && (
        <ul className="mt-2 grid gap-1">
          {row.groups.map((group) => {
            const mine = group.leaderId === myLeaderId;
            return (
              <li
                key={group.leaderId}
                className="bg-muted flex flex-wrap items-center gap-2 rounded p-1"
              >
                <span className="grow">
                  {group.leaderName}'s group · {group.members.length}/
                  {CARAVAN_MAX_GROUP}
                </span>
                {!data.commitment && group.joinable && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={actions.formGroup.isPending}
                    onClick={() =>
                      actions.formGroup.mutate({
                        caravanId: row.id,
                        leaderId: group.leaderId,
                      })
                    }
                  >
                    Join
                  </Button>
                )}
                {mine && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={actions.leaveGroup.isPending}
                    onClick={() => actions.leaveGroup.mutate({ caravanId: row.id })}
                  >
                    Leave
                  </Button>
                )}
                {mine && leading && (
                  <Button
                    size="sm"
                    variant="destructive"
                    title={
                      arrived ? "The caravan has reached its destination" : undefined
                    }
                    disabled={!row.inSector || arrived || actions.attack.isPending}
                    onClick={() => actions.attack.mutate({ caravanId: row.id })}
                  >
                    <Swords className="mr-1 size-4" aria-hidden />
                    Attack
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
};

const OPERATION_LABELS = {
  INVESTIGATE: "Investigation",
  SEARCH: "Sector search",
  DISRUPT: "Disruption",
  DELAY: "Delay",
} as const;
