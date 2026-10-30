"use client";

import { Check, Coins, RotateCcw } from "lucide-react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  VILLAGE_MAINTAINED_STRUCTURE_ROUTES,
  VILLAGE_MISSION_RANK_POINTS,
  VILLAGE_STRUCTURE_MONTHLY_COST,
} from "@/drizzle/constants";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { parseHtml } from "@/utils/parse";
import { useRequiredUserData } from "@/utils/UserContext";
import { objectiveImageMap } from "@/validators/objectives";
import type { UserDeltaResponse } from "@/validators/userCache";

export const VillageMission = ({
  villageId,
  navTabs,
}: {
  villageId: string;
  navTabs: React.ReactNode;
}) => {
  const utils = api.useUtils();
  const { updateUser, prepareUserUpdate } = useRequiredUserData();
  const [message, setMessage] = useState("");
  const { data, isPending, isError, refetch } = api.villageMission.get.useQuery(
    { id: villageId },
    { enabled: !!villageId, refetchInterval: 15000 },
  );
  const onSuccess = async (
    result: UserDeltaResponse,
    _variables: unknown,
    revision: number | undefined,
  ) => {
    if (result.success || result.userPatch)
      await updateUser(result.userPatch, {
        revision,
        ...(result.userDelta ? { delta: result.userDelta } : {}),
      });
    setMessage(result.message ?? "");
    showMutationToast(result);
    if (result.success) await Promise.all([refetch(), utils.village.get.invalidate()]);
  };
  const onError = (error: { message: string }) => setMessage(error.message);
  const select = api.villageMission.select.useMutation({
    onSuccess,
    onError,
    onMutate: prepareUserUpdate,
  });
  const claim = api.villageMission.claim.useMutation({
    onSuccess,
    onError,
    onMutate: prepareUserUpdate,
  });
  const cancel = api.villageMission.cancel.useMutation({
    onSuccess,
    onError,
    onMutate: prepareUserUpdate,
  });
  const mission = data?.mission;
  const isBusy = select.isPending || claim.isPending || cancel.isPending;

  return (
    <ContentBox
      title="Town Hall"
      subtitle="Village Mission"
      defaultBackHref="/village"
      topRightContent={navTabs}
      topRightCorntentBreakpoint="sm"
    >
      <p className="mb-4 text-muted-foreground text-sm">
        Complete objectives together to earn tokens for your village. Your Kage selects
        the mission and claims the reward. Staff can cancel and select a new mission
        without a village penalty.
      </p>
      {isPending ? (
        <Loader explanation="Loading Village Mission" />
      ) : isError ? (
        <div>
          <p>Could not load the Village Mission.</p>
          <Button onClick={() => void refetch()}>Try again</Button>
        </div>
      ) : !data ? (
        <p>Village Missions are available to members of a village.</p>
      ) : !mission ? (
        <div className="space-y-3">
          <p>No Village Mission is active.</p>
          {data.isKage || data.isStaff ? (
            <Button disabled={isBusy} onClick={() => select.mutate({ villageId })}>
              {isBusy ? "Selecting..." : "Select random mission"}
            </Button>
          ) : (
            <p className="text-muted-foreground">
              Your Kage can select the village&apos;s next mission.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="min-w-0 font-bold text-lg">{mission.name}</h3>
              <Badge variant="secondary">
                {mission.completed ? "Ready to claim" : "In progress"}
              </Badge>
            </div>
            <div data-reading-text className="text-sm">
              {parseHtml(mission.description ?? "")}
            </div>
            <p className="inline-flex items-center gap-2 font-semibold text-sm">
              <Coins className="size-4 shrink-0" aria-hidden="true" />
              {mission.rewardTokens.toLocaleString()} village tokens
            </p>
          </div>
          {mission.objectives.map((objective) => (
            <div key={objective.id} className="space-y-1 rounded border p-3">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="min-w-0 font-semibold">
                  {objectiveImageMap[objective.task].title}
                </span>
                <span className="shrink-0 whitespace-nowrap text-sm tabular-nums">
                  {objective.current.toLocaleString()} /{" "}
                  {objective.value.toLocaleString()}
                </span>
              </div>
              {objective.description && (
                <div data-reading-text className="text-sm">
                  {parseHtml(objective.description)}
                </div>
              )}
              <Progress
                value={(100 * objective.current) / objective.value}
                aria-label={objectiveImageMap[objective.task].title}
              />
              {objective.task === "combined_mission_effort" && (
                <p className="text-muted-foreground text-sm">
                  Points per mission:{" "}
                  {Object.entries(VILLAGE_MISSION_RANK_POINTS)
                    .map(([rank, points]) => `${rank}-rank ${points}`)
                    .join(" · ")}
                  .
                </p>
              )}
              {objective.task === "siege_operation" && (
                <p className="text-muted-foreground text-sm">
                  Damage dealt to enemy shrines by villagers during war.
                </p>
              )}
            </div>
          ))}
          {(data.isKage || data.isStaff) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3">
              {data.isKage && (
                <Button
                  disabled={isBusy || !mission.completed}
                  onClick={() => claim.mutate({ villageId, missionId: mission.id })}
                >
                  {claim.isPending ? "Claiming..." : "Claim village tokens"}
                </Button>
              )}
              {data.isKage && !mission.rerolled && !isBusy && (
                <Confirm
                  title="Reroll Village Mission"
                  proceed_label="Reroll"
                  onAccept={() => select.mutate({ villageId, missionId: mission.id })}
                  button={
                    <Button variant="outline" className="gap-2">
                      <RotateCcw className="size-4" aria-hidden="true" />
                      Reroll once
                    </Button>
                  }
                >
                  <p>
                    This replaces the current mission with a different random mission
                    and resets shared progress. Each mission can only be rerolled once.
                  </p>
                </Confirm>
              )}
              {mission.rerolled && (
                <p className="inline-flex min-h-9 items-center gap-1.5 text-muted-foreground text-sm">
                  <Check className="size-4 shrink-0" aria-hidden="true" />
                  Reroll used
                </p>
              )}
              {data.isStaff && (
                <Confirm
                  title="Cancel Village Mission"
                  proceed_label="Cancel mission"
                  disabled={isBusy}
                  confirmDisabled={isBusy}
                  onAccept={() => cancel.mutate({ villageId, missionId: mission.id })}
                  button={
                    <Button variant="outline" disabled={isBusy}>
                      Cancel mission (staff)
                    </Button>
                  }
                >
                  <p>
                    This discards the current mission and its progress without charging
                    village tokens or applying a cooldown. A new mission can be selected
                    immediately.
                  </p>
                </Confirm>
              )}
            </div>
          )}
          {mission.completed && (
            <p className="font-semibold text-green-600">
              Every objective is complete.{" "}
              {data.isKage
                ? "Claim the village's reward."
                : "Your Kage can claim the village's reward."}
            </p>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      )}
    </ContentBox>
  );
};

export const VillageStructureMaintenance = ({ villageId }: { villageId: string }) => {
  const utils = api.useUtils();
  const [message, setMessage] = useState("");
  const { data, isPending, isError, refetch } = api.village.get.useQuery(
    { id: villageId },
    { enabled: !!villageId },
  );
  const pay = api.kage.payStructureMaintenance.useMutation({
    onSuccess: async (data) => {
      if (data.success) await utils.profile.getUser.invalidate();
      const result = data;
      setMessage(result.message ?? "");
      showMutationToast(result);
      if (result.success) await utils.village.get.invalidate();
    },
    onError: (error) => setMessage(error.message),
  });
  const village = data?.villageData;
  const count =
    village?.structures.filter(
      (structure) =>
        structure.level > 0 &&
        (VILLAGE_MAINTAINED_STRUCTURE_ROUTES as readonly string[]).includes(
          structure.route,
        ),
    ).length ?? 0;
  const monthlyCost = count * VILLAGE_STRUCTURE_MONTHLY_COST;
  return (
    <ContentBox title="Structure Maintenance" initialBreak>
      {isPending ? (
        <Loader explanation="Loading maintenance" />
      ) : isError ? (
        <Button onClick={() => void refetch()}>Retry maintenance details</Button>
      ) : (
        village && (
          <div className="space-y-4">
            <dl className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-3">
              <div className="rounded border p-3">
                <dt className="text-muted-foreground text-xs">Monthly upkeep</dt>
                <dd className="font-semibold tabular-nums">
                  {monthlyCost.toLocaleString()}
                </dd>
                <p className="mt-1 text-muted-foreground text-xs">
                  {count} structures × {VILLAGE_STRUCTURE_MONTHLY_COST.toLocaleString()}
                </p>
              </div>
              <div className="rounded border p-3">
                <dt className="text-muted-foreground text-xs">Village tokens</dt>
                <dd className="font-semibold tabular-nums">
                  {village.tokens.toLocaleString()}
                </dd>
              </div>
              <div className="rounded border p-3">
                <dt className="text-muted-foreground text-xs">Maintenance due</dt>
                <dd className="font-semibold tabular-nums">
                  {village.structureMaintenanceDue.toLocaleString()}
                </dd>
              </div>
            </dl>
            <p className="text-muted-foreground text-sm">
              Billed at the start of each UTC calendar month and paid automatically when
              the village has enough tokens. Unpaid maintenance accumulates and must be
              paid before upgrading structures.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {village.structureMaintenanceDue > 0 ? (
                <>
                  <Button
                    disabled={
                      pay.isPending || village.tokens < village.structureMaintenanceDue
                    }
                    onClick={() => pay.mutate({ villageId })}
                  >
                    {pay.isPending ? "Paying..." : "Pay maintenance"}
                  </Button>
                  {village.tokens < village.structureMaintenanceDue && (
                    <p className="text-muted-foreground text-sm">
                      {(
                        village.structureMaintenanceDue - village.tokens
                      ).toLocaleString()}{" "}
                      more tokens needed.
                    </p>
                  )}
                </>
              ) : (
                <p className="inline-flex items-center gap-1.5 text-muted-foreground text-sm">
                  <Check className="size-4 shrink-0" aria-hidden="true" />
                  Maintenance is up to date
                </p>
              )}
            </div>
            {message && (
              <p role="status" className="text-sm">
                {message}
              </p>
            )}
          </div>
        )
      )}
    </ContentBox>
  );
};
