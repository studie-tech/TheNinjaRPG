"use client";

import { Pencil, Trophy } from "lucide-react";
import { useEffect, useRef } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  MAX_PLAYER_LEVEL,
  RANKED_DIVISIONS,
  RANKED_ENTRY_COST,
  RANKED_LEGEND_LP_REQUIREMENT,
  RANKED_LOADOUT_MAX_CONSUMABLES,
  RANKED_LOADOUT_MAX_JUTSUS,
  RANKED_LOADOUT_MAX_WEAPONS,
} from "@/drizzle/constants";
import { useRankedQueueCountCache } from "@/hooks/useRankedQueueCount";
import { QueueTimer } from "@/layout/Countdown";
import Loader from "@/layout/Loader";
import { RankedLoadoutSelector } from "@/layout/PvpRank";
import { rankedProgress } from "@/libs/battleArena";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

/** Ranked PvP: your division, the queue and the ranked loadout. */
export function RankedMode() {
  const {
    data: userData,
    prepareUserUpdate,
    updateUser,
  } = useRequiredUserDataSelector((u) => ({
    rankedLp: u.rankedLp,
    status: u.status,
    villagePrestige: u.villagePrestige,
  }));
  const utils = api.useUtils();
  const { refreshRankedQueueCount } = useRankedQueueCountCache();

  const { data: queueData } = api.pvpRank.getRankedPvpQueue.useQuery(undefined, {
    enabled: !!userData,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });
  const { data: currentSeason, isPending: isLoadingSeason } =
    api.pvpRank.getCurrentSeason.useQuery();
  const { data: topPlayersLP } = api.pvpRank.getCurrentTopPlayers.useQuery(undefined, {
    enabled: !!userData && userData.rankedLp >= RANKED_LEGEND_LP_REQUIREMENT,
    staleTime: 300_000,
  });
  const { data: rankedLoadout } = api.pvpRank.getRankedLoadout.useQuery();

  const { mutate: enterSeason, isPending: isEntering } =
    api.pvpRank.enterRankedSeason.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) {
          void updateUser(data, { revision, delta: data.userDelta });
        }
      },
    });

  const { mutate: queue, isPending: isQueuing } =
    api.pvpRank.queueForRankedPvp.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        if (data.success || data.userRecovery)
          void updateUser(data, { revision, refetch: false });
        showMutationToast(data);
        if (data.success) {
          // Awaited so the button stays pending until the queued state arrives
          await Promise.all([
            utils.pvpRank.getRankedPvpQueue.invalidate(),
            refreshRankedQueueCount(),
            data.removedJutsuIds?.length || data.removedItemIds?.length
              ? utils.pvpRank.getRankedLoadout.invalidate()
              : undefined,
          ]);
        }
      },
    });

  const { mutate: leaveQueue, isPending: isLeaving } =
    api.pvpRank.leaveRankedPvpQueue.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.pvpRank.getRankedPvpQueue.invalidate(),
            refreshRankedQueueCount(),
          ]);
        }
      },
    });

  // One match check at a time while queued
  const isCheckingRef = useRef(false);
  const { mutate: checkForMatches } = api.pvpRank.checkRankedPvpMatches.useMutation({
    onMutate: () => {
      isCheckingRef.current = true;
    },
    onSettled: () => {
      isCheckingRef.current = false;
    },
    onSuccess: (data) => {
      if (data.message) {
        showMutationToast(data);
      }
      if (data.success) {
        void utils.pvpRank.getRankedPvpQueue.invalidate();
        void refreshRankedQueueCount();
      }
    },
  });

  useEffect(() => {
    if (!queueData?.inQueue) return;
    const intervalId = setInterval(() => {
      if (!isCheckingRef.current) {
        checkForMatches();
      }
    }, 5000);
    return () => clearInterval(intervalId);
  }, [queueData?.inQueue, checkForMatches]);

  if (!userData) return <Loader explanation="Loading user" />;
  if (isLoadingSeason) return <Loader explanation="Searching for Season to Start" />;
  const progress = rankedProgress(userData.rankedLp, topPlayersLP);
  const hasEntered = userData.rankedLp > 0;
  const hasEnoughPrestige = userData.villagePrestige >= RANKED_ENTRY_COST;

  return (
    <div className="flex flex-col gap-3">
      {currentSeason ? (
        <>
          <section
            aria-label="Season"
            className="bg-card flex flex-col gap-3 rounded-xl border p-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-base font-bold">{currentSeason.name}</p>
              <p className="text-muted-foreground text-xs">
                Level {MAX_PLAYER_LEVEL} characters with max stats
              </p>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-primary text-3xl font-extrabold">
                {progress.division}
              </h2>
              <span className="font-bold">{userData.rankedLp} LP</span>
              {progress.toNext !== null && progress.nextDivision && (
                <span className="text-muted-foreground text-sm">
                  {progress.toNext} LP to {progress.nextDivision}
                </span>
              )}
            </div>
            <ol aria-label="Divisions" className="grid grid-cols-5 gap-1.5">
              {RANKED_DIVISIONS.filter((division) => division.key !== "UNRANKED").map(
                (division) => {
                  const reached =
                    division.name === progress.division ||
                    userData.rankedLp >= division.rankedLp;
                  return (
                    <li key={division.key} className="flex flex-col items-center gap-1">
                      <span
                        aria-hidden
                        className={cn(
                          "h-1.5 w-full rounded-full",
                          reached ? "bg-primary" : "bg-muted",
                        )}
                      />
                      <span className="text-muted-foreground text-center text-[11px]">
                        {division.name}{" "}
                        {Number.isFinite(division.rankedLp)
                          ? division.rankedLp.toLocaleString()
                          : "· top 10"}
                      </span>
                    </li>
                  );
                },
              )}
            </ol>
          </section>

          <section
            aria-label="Queue"
            className="bg-card flex flex-col items-center gap-3 rounded-xl border p-4 text-center"
          >
            {currentSeason.paused ? (
              <>
                <p className="text-destructive font-semibold">Ranked season paused</p>
                <p className="text-muted-foreground text-sm">
                  The &quot;{currentSeason.name}&quot; season is paused. Ranked battles
                  are temporarily unavailable.
                </p>
              </>
            ) : !hasEntered ? (
              <>
                <p className="font-semibold">Join this season to play ranked</p>
                <p className="text-muted-foreground text-sm">
                  Your village prestige:{" "}
                  <b>{userData.villagePrestige.toLocaleString()}</b>
                </p>
                {!hasEnoughPrestige && (
                  <p className="text-destructive text-sm">
                    You need {RANKED_ENTRY_COST.toLocaleString()} village prestige to
                    enter.
                  </p>
                )}
                <Button
                  className="h-11 w-full max-w-sm"
                  onClick={() => enterSeason()}
                  disabled={isEntering || !hasEnoughPrestige}
                >
                  {isEntering
                    ? "Entering"
                    : `Enter season · ${RANKED_ENTRY_COST.toLocaleString()} village prestige`}
                </Button>
              </>
            ) : queueData?.inQueue ? (
              <>
                <p className="font-semibold text-orange-600">
                  Waiting for an opponent
                  {queueData.createdAt && (
                    <>
                      {" · "}
                      <QueueTimer createdAt={queueData.createdAt} />
                    </>
                  )}
                </p>
                <Button
                  variant="outline"
                  className="h-11 w-full max-w-sm"
                  onClick={() => leaveQueue()}
                  disabled={isLeaving}
                >
                  {isLeaving ? "Leaving" : "Leave queue"}
                </Button>
              </>
            ) : (
              <>
                <p className="text-muted-foreground text-sm">
                  {queueData?.queueCount ?? 0} players in queue · matched by similar LP
                </p>
                <Button
                  size="xl"
                  decoration="gold"
                  animation="pulse"
                  className="w-full max-w-sm text-xl italic"
                  disabled={isQueuing}
                  onClick={() => {
                    if (userData.status === "BATTLE") {
                      showMutationToast({
                        success: false,
                        message:
                          "You cannot queue while in battle. Please finish your current battle first.",
                      });
                      return;
                    }
                    queue();
                  }}
                >
                  <Trophy className="mr-3 h-7 w-7" aria-hidden />
                  {isQueuing ? "Queuing" : "Find ranked match"}
                </Button>
              </>
            )}
          </section>
        </>
      ) : (
        <p className="bg-card rounded-xl border p-4 text-center text-sm">
          No ranked season is running right now.
        </p>
      )}

      {/* Ranked-rule spars use these loadouts even when no season is running. */}
      <Dialog>
        <section
          aria-label="Ranked loadout"
          className="bg-card flex flex-wrap items-center gap-3 rounded-xl border p-3"
        >
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold">Ranked loadout</h2>
            <p className="text-muted-foreground text-sm">
              Jutsu {rankedLoadout?.loadout.jutsuIds.length ?? 0} /{" "}
              {RANKED_LOADOUT_MAX_JUTSUS} · Weapons{" "}
              {rankedLoadout?.loadout.weaponIds.length ?? 0} /{" "}
              {RANKED_LOADOUT_MAX_WEAPONS} · Consumables{" "}
              {rankedLoadout?.loadout.consumableIds.length ?? 0} /{" "}
              {RANKED_LOADOUT_MAX_CONSUMABLES}
            </p>
          </div>
          <DialogTrigger asChild>
            <Button variant="outline" className="h-11">
              <Pencil className="mr-2 h-4 w-4" aria-hidden /> Edit loadout
            </Button>
          </DialogTrigger>
        </section>

        <DialogContent
          // Bound the centered editor so long catalogs scroll inside the viewport.
          className="max-h-[90dvh] overflow-y-auto rounded-xl p-4 md:max-w-3xl"
        >
          <DialogTitle className="sr-only">Ranked loadout</DialogTitle>
          <RankedLoadoutSelector />
        </DialogContent>
      </Dialog>
    </div>
  );
}
