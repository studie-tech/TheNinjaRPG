"use client";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  WAR_CAMP_DURATION_HOURS,
  WAR_CAMP_INTERVAL_HOURS,
  WAR_ESPIONAGE_TARGET,
} from "@/drizzle/constants";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import Countdown from "@/layout/Countdown";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Table from "@/layout/Table";
import { WarMercenaries } from "@/layout/WarMercenaries";
import { getWarEspionage, getWarSide } from "@/libs/objectiveWar";
import { pushToCombat } from "@/utils/routing";
import { formatSecondsToTimeDisplay } from "@/utils/time";
import { useRequiredUserData } from "@/utils/UserContext";
import type { UserDeltaResponse } from "@/validators/userCache";

/** Present masked objectives and war actions using the shared game surfaces and controls. */
export const ObjectiveWarPanel = ({
  warId,
  isFieldView = false,
  onNavigate,
}: {
  warId: string;
  /** Travel exposes field actions; the townhall retains the strategic overview. */
  isFieldView?: boolean;
  /** Close the field dialog only when a link performs client-side navigation. */
  onNavigate?: () => void;
}) => {
  const [feedback, setFeedback] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const { data: user, updateUser, prepareUserUpdate, timeDiff } = useRequiredUserData();
  const router = useRouter();
  const utils = api.useUtils();
  const { data, error, isPending, refetch } = api.war.getObjectiveWarInfo.useQuery(
    { warId },
    {
      refetchInterval: (query) =>
        query.state.data?.war.status === "ACTIVE" && !query.state.data.war.endedAt
          ? 10000
          : false,
    },
  );
  /** Refresh eligibility after accepted and rejected responses, retaining feedback by the controls. */
  const refresh = async (
    result: UserDeltaResponse,
    _variables: unknown,
    revision: number | undefined,
  ) => {
    if (result.success || result.userPatch)
      await updateUser(result.userPatch, {
        revision,
        ...(result.userDelta ? { delta: result.userDelta } : {}),
      });
    setFeedback(result);
    void utils.war.getObjectiveWarInfo.invalidate({ warId });
    void utils.war.getActiveWars.invalidate();
  };
  /** Publish the claimed battle locally before navigation so route guards see BATTLE. */
  const onBattleSuccess = async (result: {
    success: boolean;
    message: string;
    battleId?: string;
  }) => {
    setFeedback(result);
    if (result.success && result.battleId) {
      await updateUser({
        status: "BATTLE",
        battleId: result.battleId,
        updatedAt: new Date(),
      });
      pushToCombat(router, result.battleId);
    }
  };
  /** Transport failures leave actions available for retry and remain visible in the panel. */
  const onError = (error: { message: string }) =>
    setFeedback({ success: false, message: error.message });
  const onMutate = () => {
    setFeedback(null);
    return prepareUserUpdate();
  };
  const start = api.war.startWarMission.useMutation({
    onSuccess: refresh,
    onError,
    onMutate,
  });
  const finish = api.war.completeWarMission.useMutation({
    onSuccess: refresh,
    onError,
    onMutate,
  });
  const cancel = api.war.cancelWarMission.useMutation({
    onSuccess: refresh,
    onError,
    onMutate,
  });
  const attack = api.combat.startShrineBattle.useMutation({
    onSuccess: onBattleSuccess,
    onError,
    onMutate,
  });
  const camp = api.war.attackWarCamp.useMutation({
    onSuccess: onBattleSuccess,
    onError,
    onMutate,
  });
  const endsAt =
    data?.war.combatStartedAt && data.war.rules
      ? new Date(
          data.war.combatStartedAt.getTime() + data.war.rules.durationDays * 86400000,
        )
      : undefined;
  // Boundary refreshes unlock actions on server time, without waiting for the next poll.
  useRefreshAt(
    [
      data?.war.combatStartedAt,
      endsAt,
      data?.attempt?.endsAt,
      ...(data?.camps.map((camp) => camp.endsAt) ?? []),
    ],
    () => {
      void refetch();
    },
    timeDiff,
    data?.war.status === "ACTIVE" && !data.war.endedAt,
  );
  if (isPending) return <Loader explanation="Loading war objectives..." />;
  if (!data || !user)
    return error ? (
      <Alert variant="destructive">
        <AlertDescription>
          <p>Unable to load war objectives. {error.message}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    ) : null;
  const w = data.war;
  const side = getWarSide(w, user.villageId, user.userId);
  if (!side || !w.combatStartedAt || !endsAt) return null;
  const now = Date.now() - timeDiff;
  const isNotice = w.combatStartedAt.getTime() > now;
  const isRevealed = getWarEspionage(w, side) >= WAR_ESPIONAGE_TARGET;
  const enemyVillage =
    side === w.attackerVillageId ? w.defenderVillage : w.attackerVillage;
  const hasEnded =
    w.status !== "ACTIVE" ||
    !!w.endedAt ||
    w.attackerWarHealth <= 0 ||
    w.defenderWarHealth <= 0 ||
    !!(endsAt && endsAt.getTime() <= now);
  const busy =
    start.isPending ||
    finish.isPending ||
    cancel.isPending ||
    attack.isPending ||
    camp.isPending;
  const attempt = data.attempt?.warId === warId ? data.attempt : null;
  const isReady = !!attempt && new Date(attempt.endsAt).getTime() <= now;
  const openCamps = data.camps.filter(
    (camp) => camp.startsAt.getTime() <= now && camp.endsAt.getTime() > now,
  );
  return (
    <section
      className="space-y-4 bg-card py-4 text-card-foreground"
      aria-label="War objectives"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant="secondary">
          {hasEnded
            ? w.status === "ACTIVE"
              ? "Settling war"
              : "War ended"
            : isNotice
              ? "Notice period"
              : "Combat active"}
        </Badge>
        {!hasEnded && (
          <p className="text-muted-foreground text-sm">
            {isNotice ? "Combat begins in " : "War ends in "}
            <Countdown
              targetDate={isNotice ? w.combatStartedAt : endsAt}
              timeDiff={timeDiff}
              onEndShow="now"
            />
          </p>
        )}
      </div>
      <p className="text-muted-foreground text-sm">
        {hasEnded
          ? isFieldView
            ? "Combat and missions are closed. Review your village’s contributions in the townhall."
            : "Combat and missions are closed. Review your village’s contributions below."
          : isNotice
            ? "Prepare with your allies and gather intelligence before combat begins."
            : "Destroy enemy shrines and win camp battles to damage the enemy townhall. Destroyed objective shrines are lost for good."}{" "}
        The village with the most townhall health wins.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            Unable to refresh war objectives.{" "}
            <Button variant="link" onClick={() => void refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {feedback && (
        <Alert
          variant={feedback.success ? "default" : "destructive"}
          role={feedback.success ? "status" : "alert"}
        >
          <AlertDescription>
            <p className="text-foreground">{feedback.message}</p>
          </AlertDescription>
        </Alert>
      )}
      {attempt && (
        <div className="space-y-3 rounded-lg border bg-popover p-3">
          <div>
            <h3 className="font-semibold">
              {attempt.task === "espionage" ? "Espionage" : "Sabotage"} in progress
            </h3>
            <p className="text-muted-foreground text-sm">
              Sector {attempt.sector} ·{" "}
              {isReady ? (
                "Ready to complete"
              ) : (
                <>
                  Ready in{" "}
                  <Countdown
                    targetDate={new Date(attempt.endsAt)}
                    timeDiff={timeDiff}
                    onEndShow="a moment"
                  />
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={hasEnded || isNotice || busy || !isReady}
              onClick={() => finish.mutate({ attemptId: attempt.id })}
            >
              {finish.isPending ? "Completing..." : "Complete mission"}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => cancel.mutate({ attemptId: attempt.id })}
            >
              {cancel.isPending ? "Cancelling..." : "Cancel mission"}
            </Button>
          </div>
        </div>
      )}
      {!hasEnded && !isFieldView && <WarMercenaries warId={warId} />}
      <Tabs defaultValue="objectives">
        <TabsList
          className={`grid ${isFieldView ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4"}`}
          aria-label="War activities"
        >
          <TabsTrigger value="objectives">Objectives</TabsTrigger>
          <TabsTrigger value="missions">Missions</TabsTrigger>
          <TabsTrigger value="camps">
            Camps{openCamps.length > 0 ? ` (${openCamps.length})` : ""}
          </TabsTrigger>
          {!isFieldView && (
            <TabsTrigger value="contributions">Contributions</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="objectives" className="space-y-4 pt-2">
          {!isFieldView && (
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  id: w.attackerVillageId,
                  name: w.attackerVillage.name,
                  health: w.attackerWarHealth,
                  maxHealth: w.attackerWarHealthMax,
                },
                {
                  id: w.defenderVillageId,
                  name: w.defenderVillage.name,
                  health: w.defenderWarHealth,
                  maxHealth: w.defenderWarHealthMax,
                },
              ].map((village) => (
                <div
                  key={village.id}
                  className="space-y-3 rounded-lg border bg-popover p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <h3 className="font-semibold">{village.name}</h3>
                    <Badge variant="outline">
                      {village.id === side ? "Your side" : "Enemy side"}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <p className="flex justify-between gap-2 text-sm">
                      <span>Townhall health</span>
                      <span>
                        {village.health.toLocaleString()} /{" "}
                        {village.maxHealth.toLocaleString()}
                      </span>
                    </p>
                    <Progress
                      aria-label={`${village.name} townhall health`}
                      value={(village.health / Math.max(1, village.maxHealth)) * 100}
                      indicatorClassName={
                        village.id === side ? "bg-green-600" : "bg-red-600"
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="flex justify-between gap-2 text-sm">
                      <span>Espionage</span>
                      <span>
                        {getWarEspionage(w, village.id)} / {WAR_ESPIONAGE_TARGET}
                      </span>
                    </p>
                    <Progress
                      aria-label={`${village.name} espionage`}
                      value={
                        (getWarEspionage(w, village.id) / WAR_ESPIONAGE_TARGET) * 100
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!isRevealed && (
            <p className="text-muted-foreground text-sm">
              Complete espionage missions to reveal the shrines to defend and attack.
              Leaders can see locations in advance.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {w.objectiveState?.objectives.map((objective) => (
              <div
                className="space-y-3 rounded-lg border bg-popover p-3"
                key={`${objective.villageId}:${objective.sector}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <h3 className="font-semibold">
                    {objective.villageId === side ? "Defend" : "Attack"} sector{" "}
                    {objective.sector}
                  </h3>
                  <Badge variant="outline">
                    {objective.destroyed
                      ? "Destroyed"
                      : objective.isReserve
                        ? "Reserve shrine"
                        : "Shrine"}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-muted-foreground text-sm">
                    Health: {objective.hp.toLocaleString()} /{" "}
                    {objective.maxHp.toLocaleString()}
                  </p>
                  <Progress
                    aria-label={`Sector ${objective.sector} shrine health`}
                    value={(objective.hp / Math.max(1, objective.maxHp)) * 100}
                  />
                </div>
                {!objective.destroyed && !hasEnded && (
                  <div className="flex flex-wrap items-center gap-2">
                    {user.sector !== objective.sector && (
                      <Button asChild variant="outline" size="sm">
                        <Link
                          href={`/travel?sector=${objective.sector}`}
                          onNavigate={onNavigate}
                        >
                          Travel to sector {objective.sector}
                        </Link>
                      </Button>
                    )}
                    {objective.villageId !== side && isRevealed && !isNotice && (
                      <Button
                        size="sm"
                        disabled={user.sector !== objective.sector || busy}
                        onClick={() => attack.mutate({ sector: objective.sector })}
                      >
                        {attack.isPending &&
                        attack.variables?.sector === objective.sector
                          ? "Starting battle..."
                          : "Attack guardian"}
                      </Button>
                    )}
                    {user.sector === objective.sector && (
                      <span className="text-muted-foreground text-sm">
                        You are here
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="missions" className="space-y-3 pt-2">
          {isNotice && (
            <p role="status" className="text-sm">
              Espionage and sabotage missions unlock when combat begins.
            </p>
          )}
          <p className="text-muted-foreground text-sm">
            War missions run alongside your regular quests.{" "}
            {isRevealed ? (
              "Travel to a revealed enemy shrine to sabotage it."
            ) : (
              <>
                Gather intelligence in{" "}
                <Link
                  className="font-medium underline underline-offset-4"
                  href={`/travel?sector=${enemyVillage.sector}`}
                  onNavigate={onNavigate}
                >
                  {enemyVillage.name} (sector {enemyVillage.sector})
                </Link>{" "}
                to reveal the war’s shrine locations.
              </>
            )}
          </p>
          {data.attempt && !attempt && (
            <p role="status" className="text-sm">
              Finish or cancel your mission in the other war before starting another.
            </p>
          )}
          {!data.missions.length && (
            <p className="rounded-lg border bg-popover p-3 text-muted-foreground text-sm">
              No war missions are currently available to you.
            </p>
          )}
          {data.missions.map((mission) => (
            <div
              key={`${mission.questId}:${mission.objective.id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-popover p-3"
            >
              <div>
                <h3 className="font-semibold">{mission.name}</h3>
                <p className="text-muted-foreground text-sm">
                  {formatSecondsToTimeDisplay(
                    "durationSeconds" in mission.objective
                      ? mission.objective.durationSeconds
                      : 0,
                  )}{" "}
                  ·{" "}
                  {"value" in mission.objective
                    ? mission.objective.value.toLocaleString()
                    : 0}{" "}
                  {mission.objective.task === "espionage"
                    ? "espionage points"
                    : "shrine damage"}
                </p>
              </div>
              <Button
                disabled={hasEnded || isNotice || busy || !!data.attempt}
                onClick={() =>
                  start.mutate({
                    warId,
                    questId: mission.questId,
                    objectiveId: mission.objective.id,
                  })
                }
              >
                {start.isPending &&
                start.variables?.objectiveId === mission.objective.id
                  ? "Starting..."
                  : `Start ${mission.objective.task}`}
              </Button>
            </div>
          ))}
        </TabsContent>
        <TabsContent value="camps" className="space-y-3 pt-2">
          <p className="text-muted-foreground text-sm">
            A camp opens every {WAR_CAMP_INTERVAL_HOURS} hours for{" "}
            {WAR_CAMP_DURATION_HOURS} hour. Win battles to help your side deal townhall
            damage. Ties deal no damage.
          </p>
          {!openCamps.length && (
            <p className="rounded-lg border bg-popover p-3 text-muted-foreground text-sm">
              {hasEnded
                ? "War camps are closed."
                : isNotice
                  ? "War camps open after combat begins."
                  : "No war camps are open. Check back for the next camp."}
            </p>
          )}
          {openCamps.map((c) => (
            <div key={c.id} className="space-y-3 rounded-lg border bg-popover p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">War camp · Sector {c.sector}</h3>
                <p className="text-muted-foreground text-sm">
                  Closes in{" "}
                  <Countdown
                    targetDate={c.endsAt}
                    timeDiff={timeDiff}
                    onEndShow="a moment"
                  />
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { name: w.attackerVillage.name, score: c.attackerScore },
                  { name: w.defenderVillage.name, score: c.defenderScore },
                ].map((village) => (
                  <div key={village.name} className="space-y-1">
                    <p className="flex justify-between gap-2 text-sm">
                      <span>{village.name}</span>
                      <span>{village.score.toLocaleString()} points</span>
                    </p>
                    <Progress
                      aria-label={`${village.name} camp score`}
                      value={
                        (village.score /
                          Math.max(1, c.attackerScore + c.defenderScore)) *
                        100
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {user.sector !== c.sector && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/travel?sector=${c.sector}`} onNavigate={onNavigate}>
                      Travel to sector {c.sector}
                    </Link>
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={hasEnded || isNotice || busy || user.sector !== c.sector}
                  onClick={() => camp.mutate({ campId: c.id })}
                >
                  {camp.isPending && camp.variables?.campId === c.id
                    ? "Starting battle..."
                    : "Attack war camp"}
                </Button>
                {user.sector === c.sector && (
                  <span className="text-muted-foreground text-sm">You are here</span>
                )}
              </div>
            </div>
          ))}
        </TabsContent>
        {!isFieldView && (
          <TabsContent value="contributions" className="space-y-3 pt-2">
            <p className="text-muted-foreground text-sm">
              War points equal actual damage dealt to the enemy townhall. Health
              recovered is tracked separately.
            </p>
            {data.contributions.length ? (
              <Table
                data={[...data.contributions].sort((a, b) => b.damage - a.damage)}
                columns={[
                  { key: "username", header: "Ninja", type: "string" },
                  { key: "damage", header: "Damage / war points", type: "number" },
                  { key: "recovery", header: "Health recovered", type: "number" },
                ]}
                linkColumn="userId"
                linkPrefix="/userid/"
                linkDisabled={(row) => row.isMasked}
                compact
              />
            ) : (
              <p className="rounded-lg border bg-popover p-3 text-muted-foreground text-sm">
                No townhall contributions have been recorded yet.
              </p>
            )}
            <h3 className="font-bold">Kills/Losses</h3>
            <p className="text-muted-foreground text-sm">
              Only PvP wins and losses against opposing war participants count.
            </p>
            {data.combatContributions.length ? (
              <Table
                data={data.combatContributions}
                columns={[
                  { key: "username", header: "Ninja", type: "string" },
                  { key: "kills", header: "Kills", type: "number" },
                  { key: "losses", header: "Losses", type: "number" },
                ]}
                linkColumn="userId"
                linkPrefix="/userid/"
                linkDisabled={(row) => row.isMasked}
                compact
              />
            ) : (
              <p className="rounded-lg border bg-popover p-3 text-muted-foreground text-sm">
                No kills or losses have been recorded yet.
              </p>
            )}
          </TabsContent>
        )}
      </Tabs>
    </section>
  );
};
