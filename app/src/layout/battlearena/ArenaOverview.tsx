"use client";

import {
  ChevronRight,
  SlidersHorizontal,
  Swords,
  Target,
  Triangle,
  Trophy,
  Users,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useAutoCombatSetting } from "@/hooks/combat";
import { useLoadoutNames } from "@/hooks/useLoadoutNames";
import { BattleSetupControls } from "@/layout/battlearena/BattleSetupPanel";
import { type ArenaMode, rankedProgress, sparExamProgress } from "@/libs/battleArena";
import { cn } from "@/libs/shadui";
import { useRequiredUserData } from "@/utils/UserContext";

interface ArenaOverviewProps {
  onOpen: (mode: ArenaMode) => void;
}

/** Every arena mode as a card with its current status and a way in. */
export function ArenaOverview({ onOpen }: ArenaOverviewProps) {
  const { data: userData } = useRequiredUserData();
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [isAutoCombat] = useAutoCombatSetting();
  const loadoutNames = useLoadoutNames();
  const enabled = !!userData;
  const { data: opponents } = api.profile.getAllAiNames.useQuery(
    { arenaOnly: true },
    { enabled },
  );
  const { data: challenges } = api.sparring.getUserChallenges.useQuery(undefined, {
    staleTime: 5000,
    enabled,
  });
  const { data: towers } = api.quests.specificQuests.useQuery(
    { level: userData?.level ?? 0, questType: "battlepyramid" },
    { enabled },
  );
  const { data: season } = api.pvpRank.getCurrentSeason.useQuery(undefined, {
    enabled,
  });
  const { data: queueCount } = api.pvpRank.getRankedQueueCount.useQuery(undefined, {
    enabled,
  });

  if (!userData) return null;

  const level = userData.level;
  const bestMatch = opponents?.reduce<(typeof opponents)[number] | undefined>(
    (best, ai) =>
      !best || Math.abs(ai.level - level) < Math.abs(best.level - level) ? ai : best,
    undefined,
  );
  const waiting =
    challenges?.filter(
      (c) => c.receiverId === userData.userId && c.status === "PENDING",
    ).length ?? 0;
  const exam = sparExamProgress(userData);
  const climbing = userData.userQuests?.find(
    (uq) => !uq.endAt && uq.quest?.questType === "battlepyramid",
  );
  const ranked = rankedProgress(userData.rankedLp);
  const setupSummary = [
    loadoutNames.jutsu && `Jutsu: ${loadoutNames.jutsu}`,
    loadoutNames.item && `Items: ${loadoutNames.item}`,
    `Auto combat ${isAutoCombat ? "on" : "off"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const cards: OverviewCard[] = [
    {
      mode: "Arena",
      title: "Arena",
      icon: Swords,
      description: "Fight creatures picked for your level.",
      status: bestMatch
        ? `Best match: ${bestMatch.username} · Lv ${bestMatch.level}`
        : null,
      detail: `Fights today: ${userData.dailyArenaFights}`,
      action: "Choose opponent",
      wide: true,
    },
    {
      mode: "Sparring",
      title: "Sparring",
      icon: Users,
      description: "Challenge other ninja. Wins count for exams and badges.",
      status:
        waiting > 0
          ? `${waiting} ${waiting === 1 ? "challenge" : "challenges"} waiting`
          : null,
      detail: exam
        ? `${exam.questName}: ${exam.done} / ${exam.target} spars won`
        : null,
      action: "Find opponents",
    },
    {
      mode: "Battle Pyramid",
      title: "Battle Pyramid",
      icon: Triangle,
      description: "Climb a tower floor by floor, one tower at a time.",
      status: climbing
        ? `Climbing ${climbing.quest.name}`
        : towers
          ? `${towers.length} ${towers.length === 1 ? "tower" : "towers"} open to you`
          : null,
      detail: null,
      action: "See towers",
    },
    {
      mode: "PVP Rank",
      title: "Ranked PvP",
      icon: Trophy,
      description: "Equal stats and a ranked loadout. Climb the divisions.",
      status: !season
        ? "No season running"
        : season.paused
          ? "Season paused"
          : userData.rankedLp === 0
            ? "Not entered this season"
            : `${ranked.division} · ${userData.rankedLp} LP · ${queueCount ?? 0} in queue`,
      detail: null,
      action: "Open ranked",
    },
    {
      mode: "Training",
      title: "Training dummy",
      icon: Target,
      description: "Set the dummy's stats and test your jutsu with no risk.",
      status: "Practice, no rewards",
      detail: null,
      action: "Set up dummy",
      quiet: true,
    },
  ];

  return (
    <div className="@container flex flex-col gap-3 p-3">
      <div className="grid gap-3 @min-[600px]:grid-cols-2">
        {cards.map((card) => (
          <ModeCard key={card.mode} card={card} onOpen={onOpen} />
        ))}
      </div>
      <div className="bg-muted/50 flex items-center gap-3 rounded-xl border px-3 py-2 text-sm">
        <b className="shrink-0 @max-[600px]:sr-only">Your setup</b>
        <span className="text-muted-foreground min-w-0 flex-1">{setupSummary}</span>
        <Button variant="outline" className="h-11" onClick={() => setIsSetupOpen(true)}>
          <SlidersHorizontal className="mr-2 h-4 w-4" aria-hidden /> Change
        </Button>
      </div>
      <Sheet open={isSetupOpen} onOpenChange={setIsSetupOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
          // Strict containment would ignore the content's height; keep it content-sized.
          style={{ contain: "layout paint" }}
        >
          <SheetTitle className="mb-3">Your setup</SheetTitle>
          <div className="flex flex-col gap-3">
            <BattleSetupControls autoCombat />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ModeCard({
  card,
  onOpen,
}: {
  card: OverviewCard;
  onOpen: (mode: ArenaMode) => void;
}) {
  const Icon = card.icon;
  return (
    <article
      className={cn(
        // On phones the card is one compact row and its button covers the whole card.
        "bg-card relative flex items-center gap-3 rounded-xl border p-3 @min-[600px]:items-stretch",
        card.wide ? "@min-[600px]:col-span-2" : "",
        "flex-row @min-[600px]:flex-col",
        card.wide && "@min-[600px]:flex-row",
      )}
    >
      <div
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-100 to-amber-300 text-amber-900 dark:from-amber-900 dark:to-amber-700 dark:text-amber-100",
          "h-14 w-14 @min-[600px]:h-20 @min-[600px]:w-full",
          card.wide && "@min-[600px]:h-auto @min-[600px]:w-56",
        )}
      >
        <Icon className="h-7 w-7 @min-[600px]:h-8 @min-[600px]:w-8" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 @min-[600px]:gap-1">
        <h2 className="text-base font-bold @min-[600px]:text-lg">{card.title}</h2>
        <p className="text-muted-foreground @min-[600px]:text-foreground text-xs @min-[600px]:text-sm">
          {card.description}
        </p>
        {card.status && (
          <p
            className={cn(
              "text-xs font-semibold @min-[600px]:text-sm",
              card.quiet ? "text-muted-foreground" : "text-primary",
            )}
          >
            {card.status}
          </p>
        )}
        {card.detail && <p className="text-muted-foreground text-xs">{card.detail}</p>}
        <span className="flex-1" />
        <Button
          variant={card.quiet ? "outline" : "default"}
          className="mt-2 h-11 @max-[600px]:absolute @max-[600px]:inset-0 @max-[600px]:z-10 @max-[600px]:mt-0 @max-[600px]:h-auto @max-[600px]:rounded-xl @max-[600px]:border-0 @max-[600px]:bg-transparent @max-[600px]:text-transparent @max-[600px]:shadow-none @max-[600px]:hover:bg-black/5"
          onClick={() => onOpen(card.mode)}
        >
          {card.action}
        </Button>
      </div>
      <ChevronRight
        aria-hidden
        className="text-muted-foreground h-5 w-5 shrink-0 @min-[600px]:hidden"
      />
    </article>
  );
}

type OverviewCard = {
  mode: ArenaMode;
  title: string;
  icon: typeof Swords;
  description: string;
  status: string | null;
  detail: string | null;
  action: string;
  wide?: boolean;
  quiet?: boolean;
};
