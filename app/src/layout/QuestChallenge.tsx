"use client";

import { MapPin } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { Button } from "@/components/ui/button";
import Link from "@/layout/Link";
import { cn } from "@/libs/shadui";
import type { QuestChallengeRequest } from "@/validators/questChallenge";

/** The logbook section on the profile dashboard, where challenge rewards are collected. */
export const QUEST_LOGBOOK_HREF = "/profile?tab=dashboard#progress-heading";

/**
 * A minigame page's lobby, or the quest challenge its `?quest=&objective=` query names.
 * The prerendered page and visitors without the query see the lobby.
 */
export const QuestChallengeRoute = (props: {
  lobby: ReactNode;
  render: (request: QuestChallengeRequest) => ReactNode;
}) => (
  <Suspense fallback={props.lobby}>
    <ChallengeQuery {...props} />
  </Suspense>
);

/** A one-line status banner with an optional action: amber by default, green on success. */
export const ChallengeNotice = (props: {
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

/** A challenge's briefing away from its position: only the way there. */
export const ChallengeElsewhere = (props: {
  questName: string;
  objective: { sector: number; longitude: number; latitude: number };
  /** What the player does once there, e.g. "hold your ground there". */
  purpose: string;
}) => {
  const { sector, longitude, latitude } = props.objective;
  return (
    <div className="space-y-2 p-3 text-sm">
      <p className="text-muted-foreground">Quest: {props.questName}</p>
      <ChallengeNotice icon={<MapPin className="h-5 w-5 text-amber-500" />}>
        Travel to{" "}
        <Link
          className="font-semibold underline"
          href={`/travel?sector=${sector}&longitude=${longitude}&latitude=${latitude}`}
        >
          sector {sector} at [{longitude}, {latitude}]
        </Link>{" "}
        to {props.purpose}.
      </ChallengeNotice>
    </div>
  );
};

/** A challenge the player's active quests no longer hold. */
export const ChallengeGone = (props: { noun: string }) => (
  <div className="space-y-3 p-3 text-sm">
    <p>This {props.noun} is no longer part of your active quests.</p>
    <Button asChild>
      <Link href={QUEST_LOGBOOK_HREF}>Open logbook</Link>
    </Button>
  </div>
);

const ChallengeQuery = (props: {
  lobby: ReactNode;
  render: (request: QuestChallengeRequest) => ReactNode;
}) => {
  const searchParams = useSearchParams();
  const questId = searchParams.get("quest");
  const objectiveId = searchParams.get("objective");
  return questId && objectiveId ? props.render({ questId, objectiveId }) : props.lobby;
};
