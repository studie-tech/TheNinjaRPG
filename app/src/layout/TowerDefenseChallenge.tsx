"use client";

import {
  CheckCircle2,
  Flag,
  Heart,
  MapPin,
  Play,
  RotateCcw,
  ScrollText,
  Swords,
  Waves,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import Confirm from "@/layout/Confirm";
import Link from "@/layout/Link";
import { Reward } from "@/layout/Objective";
import { TowerDefenseStat } from "@/layout/TowerDefenseLobby";
import { cn } from "@/libs/shadui";
import type { findTowerDefenseChallenge } from "@/libs/towerDefense/challenge";
import type { TdSavedRunHead } from "@/libs/towerDefense/savedRun";
import { parseHtml } from "@/utils/parse";
import { hasReward } from "@/validators/rewards";

type FoundChallenge = NonNullable<ReturnType<typeof findTowerDefenseChallenge>>;

/**
 * The briefing of a quest's tower defense challenge: what it asks for, whether the player
 * can take it on from where they stand, and the start. A saved challenge run can be resumed
 * or claimed from here; a Guard Hall run resumes from the lobby. A challenge run replaces
 * either, so the start asks first when one is kept.
 */
export const TowerDefenseChallenge = (props: {
  challenge: FoundChallenge | null;
  saved: Pick<TdSavedRunHead, "wave" | "over" | "config"> | null;
  isStarting: boolean;
  isResuming: boolean;
  onStart: (replaceSaved: boolean) => void;
  onResume: () => void;
}) => {
  const { challenge, saved } = props;
  if (!challenge)
    return (
      <div className="space-y-3 p-3 text-sm">
        <p>This challenge is not part of your active quests any more.</p>
        <Button asChild>
          <Link href="/towerDefense">Guard Hall</Link>
        </Button>
      </div>
    );
  const { objective, quest } = challenge;
  const finalWave = objective.startWave + objective.waves - 1;
  const busy = props.isStarting || props.isResuming;
  const isHere = challenge.atLocation || objective.hideLocation;
  const canStart = !challenge.done && challenge.available && isHere;
  const isSavedChallenge = !!saved?.config.challenge;
  const savedRun = isSavedChallenge ? "challenge run" : "Guard Hall run";
  const startButton = (
    <Button
      size="lg"
      className="w-full @md:w-auto"
      disabled={busy || !canStart}
      onClick={saved ? undefined : () => props.onStart(false)}
    >
      <Play className="mr-2 h-5 w-5" />
      {props.isStarting ? "Preparing..." : "Start challenge"}
    </Button>
  );
  return (
    <div className="@container space-y-4 p-3">
      <div>
        <p className="text-muted-foreground text-sm">Quest: {quest.name}</p>
        {objective.description && (
          <div className="mt-1">{parseHtml(objective.description)}</div>
        )}
        <Reward info={objective} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm @lg:grid-cols-4">
        <TowerDefenseStat
          icon={<Flag className="h-5 w-5 text-sky-500" />}
          label="Start wave"
          value={`${objective.startWave}`}
        />
        <TowerDefenseStat
          icon={<Waves className="h-5 w-5 text-amber-500" />}
          label="Clear"
          value={
            objective.waves === 1
              ? `Wave ${finalWave}`
              : `${objective.waves} waves, to ${finalWave}`
          }
        />
        <TowerDefenseStat
          icon={<Heart className="h-5 w-5 text-red-500" />}
          label="Enemy health"
          value={`${objective.enemyHealth}%`}
        />
        <TowerDefenseStat
          icon={<Swords className="h-5 w-5 text-orange-500" />}
          label="Enemy damage"
          value={`${objective.enemyDamage}%`}
        />
      </div>
      <p className="text-muted-foreground text-sm">
        The challenge is won once the last wave is cleared. Your Guard Hall upgrades and
        level count as in any run; challenge runs earn no scrolls and do not count for
        the leaderboard or the daily duty.
      </p>
      {saved && isSavedChallenge && (
        <Notice
          icon={<RotateCcw className="h-5 w-5 text-amber-500" />}
          action={
            <Button size="sm" disabled={busy} onClick={props.onResume}>
              {saved.over ? (
                <ScrollText className="mr-1 h-4 w-4" />
              ) : (
                <RotateCcw className="mr-1 h-4 w-4" />
              )}{" "}
              {props.isResuming ? "Restoring..." : saved.over ? "Claim" : "Resume"}
            </Button>
          }
        >
          {saved.over ? "Unclaimed" : "Unfinished"} challenge run at wave{" "}
          <strong>{saved.wave}</strong>
        </Notice>
      )}
      {challenge.done ? (
        <Notice
          tone="success"
          icon={<CheckCircle2 className="h-5 w-5 text-green-500" />}
        >
          {hasReward(objective)
            ? "Challenge complete. Collect the objective's reward in your logbook."
            : "Challenge complete. Continue the quest in your logbook."}
        </Notice>
      ) : !challenge.available ? (
        <Notice icon={<ScrollText className="h-5 w-5 text-amber-500" />}>
          Finish the earlier objectives of {quest.name} first.
        </Notice>
      ) : (
        !isHere && (
          <Notice icon={<MapPin className="h-5 w-5 text-amber-500" />}>
            Travel to{" "}
            <Link
              className="font-semibold underline"
              href={`/travel?sector=${objective.sector}&longitude=${objective.longitude}&latitude=${objective.latitude}`}
            >
              sector {objective.sector} at [{objective.longitude}, {objective.latitude}]
            </Link>{" "}
            to take on this challenge.
          </Notice>
        )
      )}
      <div className="flex flex-col-reverse gap-2 @md:flex-row @md:items-center @md:justify-end">
        <Button asChild variant="outline" size="lg">
          <Link href="/towerDefense">Guard Hall</Link>
        </Button>
        {challenge.done ? (
          <Button asChild size="lg">
            <Link href="/profile?tab=dashboard#progress-heading">
              <ScrollText className="mr-2 h-5 w-5" />
              Open logbook
            </Link>
          </Button>
        ) : saved && canStart ? (
          <Confirm
            title="Replace your saved run?"
            button={startButton}
            disabled={busy}
            tone="destructive"
            proceed_label="Discard and start"
            proceed_loading_label="Preparing"
            isLoading={props.isStarting}
            onAccept={(event) => {
              event.preventDefault();
              props.onStart(true);
            }}
          >
            {saved.over
              ? `Your ${savedRun} at wave ${saved.wave} has not been claimed yet. Starting the challenge discards it${isSavedChallenge ? "" : " and the scrolls it earned"}.`
              : `Starting the challenge discards your unfinished ${savedRun} at wave ${saved.wave}${isSavedChallenge ? "" : " and the scrolls it would earn"}.`}
          </Confirm>
        ) : (
          startButton
        )}
      </div>
    </div>
  );
};

const Notice = (props: {
  icon: ReactNode;
  tone?: "success";
  action?: ReactNode;
  children: ReactNode;
}) => (
  <div
    className={cn(
      "flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm",
      props.tone === "success"
        ? "border-green-500/50 bg-green-500/10"
        : "border-amber-500/50 bg-amber-500/10",
    )}
  >
    {props.icon}
    <p className="flex-1">{props.children}</p>
    {props.action}
  </div>
);
