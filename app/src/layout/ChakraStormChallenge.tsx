"use client";

import {
  CheckCircle2,
  Map as MapIcon,
  Play,
  ScrollText,
  Skull,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CS_STAGE_IMAGE_URLS } from "@/drizzle/constants";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import { Reward } from "@/layout/Objective";
import {
  ChallengeElsewhere,
  ChallengeGone,
  ChallengeNotice,
  QUEST_LOGBOOK_HREF,
} from "@/layout/QuestChallenge";
import { TowerDefenseStat } from "@/layout/TowerDefenseLobby";
import { CS_BOSS_MINUTES, CS_STAGE_INFO } from "@/libs/chakraStorm/content";
import type { findQuestChallenge } from "@/libs/quest/challenge";
import { parseHtml } from "@/utils/parse";
import { hasReward } from "@/validators/rewards";

/**
 * The briefing of a quest's Survive the Storm challenge, shown in full only at the
 * objective's position: the region, how long to hold out, and the start. Elsewhere it only
 * points the way there.
 */
export const ChakraStormChallenge = (props: {
  challenge: FoundChallenge | null;
  isStarting: boolean;
  onStart: () => void;
}) => {
  const { challenge } = props;
  if (!challenge) return <ChallengeGone noun="storm" />;
  const { objective, quest } = challenge;
  const isHere = challenge.atLocation || objective.hideLocation;
  if (!challenge.done && !isHere)
    return (
      <ChallengeElsewhere
        questName={quest.name}
        objective={objective}
        purpose="face the storm there"
      />
    );
  const region = CS_STAGE_INFO[objective.stage];
  const hunters = CS_BOSS_MINUTES.filter(
    (minute) => minute < objective.surviveMinutes,
  ).length;
  return (
    <div className="@container space-y-4 p-3">
      <div className="flex flex-col gap-3 @lg:flex-row">
        <Image
          src={CS_STAGE_IMAGE_URLS[objective.stage]}
          alt={region.name}
          width={320}
          height={180}
          className="aspect-video w-full rounded-lg object-cover @lg:w-64"
        />
        <div className="flex-1">
          <p className="text-muted-foreground text-sm">Quest: {quest.name}</p>
          {objective.description && (
            <div className="mt-1">{parseHtml(objective.description)}</div>
          )}
          <Reward info={objective} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm @lg:grid-cols-3">
        {/* The region's name is the longest value, so it takes a row of its own on phones. */}
        <div className="col-span-2 @lg:col-span-1">
          <TowerDefenseStat
            icon={<MapIcon className="h-5 w-5 text-sky-500" />}
            label="Region"
            value={region.name}
          />
        </div>
        <TowerDefenseStat
          icon={<Timer className="h-5 w-5 text-amber-500" />}
          label="Survive"
          value={`${objective.surviveMinutes} min`}
        />
        <TowerDefenseStat
          icon={<Skull className="h-5 w-5 text-red-500" />}
          label="Hunters"
          value={`${hunters}`}
        />
      </div>
      <p className="text-muted-foreground text-sm">
        You win once you have survived the time. Your Training Hall levels count as in
        any run; this scouting earns no intel and does not count for region records or
        the daily report.
      </p>
      {challenge.done ? (
        <ChallengeNotice
          tone="success"
          icon={<CheckCircle2 className="h-5 w-5 text-green-500" />}
        >
          {hasReward(objective)
            ? "You survived the storm. Collect the objective's reward in your logbook."
            : "You survived the storm. Continue the quest in your logbook."}
        </ChallengeNotice>
      ) : (
        !challenge.available && (
          <ChallengeNotice icon={<ScrollText className="h-5 w-5 text-amber-500" />}>
            Finish the earlier objectives of {quest.name} first.
          </ChallengeNotice>
        )
      )}
      <div className="flex flex-col gap-2 @md:flex-row @md:justify-end">
        {challenge.done ? (
          <Button asChild size="lg">
            <Link href={QUEST_LOGBOOK_HREF}>
              <ScrollText className="mr-2 h-5 w-5" />
              Open logbook
            </Link>
          </Button>
        ) : (
          <Button
            size="lg"
            className="w-full @md:w-auto"
            disabled={props.isStarting || !challenge.available}
            onClick={props.onStart}
          >
            <Play className="mr-2 h-5 w-5" />
            {props.isStarting ? "Preparing..." : "Enter the storm"}
          </Button>
        )}
      </div>
    </div>
  );
};

type FoundChallenge = NonNullable<
  ReturnType<typeof findQuestChallenge<"win_chakra_storm">>
>;
