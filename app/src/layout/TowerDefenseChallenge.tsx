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

/**
 * The briefing of a quest's Hold Your Ground defense, shown in full only at the objective's
 * position: what it asks for and the start. Elsewhere it only points the way there. A saved
 * defense can be resumed or claimed from here; a Guard Hall run resumes from the lobby. A new
 * defense replaces either, so the start asks first when one is kept.
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
        <p>This defense is no longer part of your active quests.</p>
        <Button asChild>
          <Link href={LOGBOOK_HREF}>Open logbook</Link>
        </Button>
      </div>
    );
  const { objective, quest } = challenge;
  const finalWave = objective.startWave + objective.waves - 1;
  const busy = props.isStarting || props.isResuming;
  const isHere = challenge.atLocation || objective.hideLocation;
  const canStart = !challenge.done && challenge.available && isHere;
  const isSavedChallenge = !!saved?.config.challenge;
  const savedRun = isSavedChallenge ? "defense" : "Guard Hall run";
  const startButton = (
    <Button
      size="lg"
      className="w-full @md:w-auto"
      disabled={busy || !canStart}
      onClick={saved ? undefined : () => props.onStart(false)}
    >
      <Play className="mr-2 h-5 w-5" />
      {props.isStarting ? "Preparing..." : "Hold your ground"}
    </Button>
  );
  // The defense belongs to its position: elsewhere the briefing only points the way there.
  if (!challenge.done && !isHere)
    return (
      <div className="space-y-2 p-3 text-sm">
        <p className="text-muted-foreground">Quest: {quest.name}</p>
        <Notice icon={<MapPin className="h-5 w-5 text-amber-500" />}>
          Travel to{" "}
          <Link
            className="font-semibold underline"
            href={`/travel?sector=${objective.sector}&longitude=${objective.longitude}&latitude=${objective.latitude}`}
          >
            sector {objective.sector} at [{objective.longitude}, {objective.latitude}]
          </Link>{" "}
          to hold your ground there.
        </Notice>
      </div>
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
        The position holds once the last wave is cleared. Your Guard Hall upgrades and
        level count as in any run; this defense earns no scrolls and does not count for
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
          {saved.over ? "Unclaimed" : "Unfinished"} defense at wave{" "}
          <strong>{saved.wave}</strong>
        </Notice>
      )}
      {challenge.done ? (
        <Notice
          tone="success"
          icon={<CheckCircle2 className="h-5 w-5 text-green-500" />}
        >
          {hasReward(objective)
            ? "You held your ground. Collect the objective's reward in your logbook."
            : "You held your ground. Continue the quest in your logbook."}
        </Notice>
      ) : (
        !challenge.available && (
          <Notice icon={<ScrollText className="h-5 w-5 text-amber-500" />}>
            Finish the earlier objectives of {quest.name} first.
          </Notice>
        )
      )}
      <div className="flex flex-col gap-2 @md:flex-row @md:justify-end">
        {challenge.done ? (
          <Button asChild size="lg">
            <Link href={LOGBOOK_HREF}>
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
              ? `Your ${savedRun} at wave ${saved.wave} has not been claimed yet. Starting this defense discards it${isSavedChallenge ? "" : " and the scrolls it earned"}.`
              : `Starting this defense discards your unfinished ${savedRun} at wave ${saved.wave}${isSavedChallenge ? "" : " and the scrolls it would earn"}.`}
          </Confirm>
        ) : (
          startButton
        )}
      </div>
    </div>
  );
};

/** A one-line status banner with an optional action: amber by default, green on success. */
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

/** The logbook section on the profile dashboard. */
const LOGBOOK_HREF = "/profile?tab=dashboard#progress-heading";

type FoundChallenge = NonNullable<ReturnType<typeof findTowerDefenseChallenge>>;
