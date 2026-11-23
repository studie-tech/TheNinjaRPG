"use client";

import {
  ArrowRight,
  ChevronDown,
  Clover,
  Dices,
  Footprints,
  Gem,
  Heart,
  HeartPulse,
  Lock,
  type LucideIcon,
  Magnet,
  Play,
  Skull,
  Sparkles,
  Sunrise,
  Swords,
  Timer,
  Trophy,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CS_KEYART_URL, CS_LOGO_URL, CS_STAGE_IMAGE_URLS } from "@/drizzle/constants";
import {
  BuildRow,
  ChakraStormIcon,
  CS_PASSIVE_COLOR,
  formatClock,
  LeaderboardButton,
} from "@/layout/ChakraStormHud";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import { MiniGameDailyDuty } from "@/layout/MiniGameDailyDuty";
import { MiniGameGuestHero } from "@/layout/MiniGameGuestHero";
import {
  CS_DAILY_SECONDS,
  CS_JUTSU,
  CS_JUTSU_INFO,
  CS_LEADERBOARD_STAGE,
  CS_PASSIVE_INFO,
  CS_PASSIVES,
  CS_RUN_SECONDS,
  CS_STAGE_INFO,
  CS_STAGES,
  CS_TRAINING,
  CS_TRAINING_INFO,
  type CsStage,
  type CsTraining,
  csTrainingCost,
} from "@/libs/chakraStorm/content";
import { CS_LANDING_FAQ, CS_LANDING_STATS } from "@/libs/chakraStorm/landing";
import { type CsProgress, csStageUnlocked } from "@/libs/chakraStorm/progress";
import { cn } from "@/libs/shadui";

const TRAINING_ICONS: Record<CsTraining, LucideIcon> = {
  might: Swords,
  vitality: Heart,
  recovery: HeartPulse,
  haste: Timer,
  swiftness: Footprints,
  reach: Magnet,
  luck: Clover,
  revival: Sunrise,
  reroll: Dices,
};

/**
 * Chakra Storm between runs: the title and a button into the selected region, the
 * stages of Seichi, the Training Hall and every jutsu with its awakening, then the
 * questions a new player asks. It renders in the prerendered page, so search engines
 * read the same text players do.
 */
export const ChakraStormLobby = (props: {
  progress: CsProgress;
  stage: CsStage;
  isGuest: boolean;
  /** The signed-in player's progress is still loading. */
  isLoading?: boolean;
  isStarting?: boolean;
  isTraining?: boolean;
  /** The daily scouting report for a signed-in player; null for a guest. */
  daily: {
    reward: { ryo: number; prestige: number; villageTokens: number };
    done: boolean;
    hasVillage: boolean;
  } | null;
  onStage: (stage: CsStage) => void;
  onStart: () => void;
  onTrain: (id: CsTraining) => void;
}) => {
  const stage = CS_STAGE_INFO[props.stage];
  return (
    <div className="@container space-y-5">
      {!props.isGuest && <DailyReport daily={props.daily} />}
      {/* A visitor meets the landing; a signed-in scout goes straight to the run. */}
      {props.isGuest ? (
        <MiniGameGuestHero
          id="cs"
          name="Chakra Storm"
          logo={{ src: CS_LOGO_URL, width: 480, height: 308 }}
          background={CS_KEYART_URL}
          title="Survive the storm"
          description={`Scout ${stage.name} while hostiles close in from every side. Your jutsu cast themselves; you choose the path, gather chakra and learn new arts. Hold out ${CS_LANDING_STATS.minutes} minutes until reinforcements arrive.`}
          stats={[
            { value: `${CS_LANDING_STATS.jutsu}`, label: "jutsu" },
            { value: `${CS_LANDING_STATS.stages}`, label: "regions" },
            { value: `${CS_LANDING_STATS.minutes}`, label: "minutes" },
          ]}
          benefit={{
            title: "Daily scouting report",
            description: `Signed-in scouts earn ryo, prestige and village tokens once a day for a run of ${CS_DAILY_SECONDS / 60} minutes or more. Every run is verified by the server.`,
          }}
          disabled={!!props.isStarting || !!props.isLoading}
          isStarting={props.isStarting}
          onPlay={props.onStart}
        />
      ) : (
        <ScoutingCard
          stage={props.stage}
          progress={props.progress}
          disabled={props.isStarting || props.isLoading}
          isStarting={props.isStarting}
          onStart={props.onStart}
        />
      )}

      {/* Stages */}
      <section aria-labelledby="cs-stages" className="space-y-2">
        <h2 id="cs-stages" className="text-xl font-bold">
          Regions of Seichi
        </h2>
        {/* Five regions and Undercover fill the rows: two by three, or three by two. */}
        <div className="grid grid-cols-1 gap-2 @[34rem]:grid-cols-2 @[56rem]:grid-cols-3">
          {CS_REGIONS.map((id, index) => (
            <StageCard
              key={id}
              id={id}
              index={index}
              progress={props.progress}
              selected={id === props.stage}
              onSelect={() => props.onStage(id)}
            />
          ))}
          <UndercoverCard
            progress={props.progress}
            selected={props.stage === CS_LEADERBOARD_STAGE}
            onSelect={() => props.onStage(CS_LEADERBOARD_STAGE)}
          />
        </div>
      </section>

      {/* Training Hall */}
      <section aria-labelledby="cs-training" className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="cs-training" className="text-xl font-bold">
              Training Hall
            </h2>
            <p className="text-muted-foreground text-sm">
              Every run brings home intel. Your village trains you with it; each lesson
              raises the price of the next.
            </p>
          </div>
          <span className="flex items-center gap-1.5 rounded-lg border border-violet-400/60 bg-violet-500/10 px-3 py-1.5 text-lg font-black tabular-nums">
            <Gem className="h-5 w-5 text-violet-500" />
            {props.isLoading ? "…" : props.progress.intel.toLocaleString()}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 @[34rem]:grid-cols-2 @[56rem]:grid-cols-3">
          {CS_TRAINING.map((id) => (
            <TrainingCard
              key={id}
              id={id}
              busy={!!props.isTraining || !!props.isLoading}
              progress={props.progress}
              onTrain={() => props.onTrain(id)}
            />
          ))}
        </div>
      </section>

      {/* Codex */}
      <section aria-labelledby="cs-jutsu" className="space-y-2">
        <h2 id="cs-jutsu" className="text-xl font-bold">
          Jutsu and their awakenings
        </h2>
        <p className="text-muted-foreground text-sm">
          Master a jutsu, learn its partner art, then open a scroll from an elite or a
          hunter to awaken it.
        </p>
        <div className="grid grid-cols-1 gap-2 @[40rem]:grid-cols-2">
          {CS_JUTSU.map((id) => {
            const info = CS_JUTSU_INFO[id];
            const partner = info.awakening.partner;
            return (
              <div key={id} className="bg-card space-y-1.5 rounded-lg border p-2">
                <div className="flex items-center gap-2">
                  <ChakraStormIcon id={id} color={info.color} className="h-12 w-12" />
                  <div className="min-w-0">
                    <h3 className="text-base leading-tight font-bold">{info.name}</h3>
                    <p className="text-muted-foreground text-sm">
                      {info.elementName} · {info.summary}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 rounded-md bg-amber-500/10 p-1.5 text-sm">
                  <ChakraStormIcon
                    id={partner}
                    color={CS_PASSIVE_COLOR}
                    className="h-7 w-7"
                  />
                  <ArrowRight className="h-4 w-4 shrink-0 text-amber-600" />
                  <Sparkles className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>
                    <span className="font-bold">{info.awakening.name}</span>{" "}
                    <span className="text-muted-foreground">
                      with {CS_PASSIVE_INFO[partner].name}: {info.awakening.summary}
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <h3 className="pt-1 text-lg font-bold">Passive arts</h3>
        <div className="grid grid-cols-1 gap-1.5 @[34rem]:grid-cols-2 @[56rem]:grid-cols-3">
          {CS_PASSIVES.map((id) => {
            const info = CS_PASSIVE_INFO[id];
            return (
              <BuildRow
                key={id}
                icon={id}
                color={CS_PASSIVE_COLOR}
                name={info.name}
                level={0}
                maxLevel={info.maxLevel}
                detail={`${info.perLevel} per level`}
              />
            );
          })}
        </div>
      </section>

      {/* Questions, for visitors deciding whether to play */}
      {props.isGuest && (
        <section aria-labelledby="cs-faq" className="space-y-2">
          <h2 id="cs-faq" className="text-xl font-bold">
            Frequently asked questions
          </h2>
          <div className="bg-card divide-y rounded-lg border">
            {CS_LANDING_FAQ.map((entry) => (
              <details key={entry.question} className="group px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-base font-semibold [&::-webkit-details-marker]:hidden">
                  {entry.question}
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <p className="text-muted-foreground mt-2 text-sm">{entry.answer}</p>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

const StageCard = (props: {
  id: CsStage;
  index: number;
  progress: CsProgress;
  selected: boolean;
  className?: string;
  onSelect: () => void;
}) => {
  const info = CS_STAGE_INFO[props.id];
  const open = csStageUnlocked(props.progress, props.id);
  const record = props.progress.stages[props.id];
  const previous = CS_STAGES[props.index - 1];
  return (
    <button
      type="button"
      disabled={!open}
      onClick={props.onSelect}
      aria-pressed={props.selected}
      className={cn(
        "group bg-card relative flex flex-col overflow-hidden rounded-xl border-2 text-left transition focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none",
        props.selected
          ? "border-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.35)]"
          : "border-border hover:border-amber-500/60",
        !open && "cursor-not-allowed",
        props.className,
      )}
    >
      <div className="relative h-28 w-full overflow-hidden">
        <Image
          src={CS_STAGE_IMAGE_URLS[props.id]}
          alt=""
          width={480}
          height={320}
          className={cn(
            "h-full w-full object-cover transition-transform duration-500 group-hover:scale-105",
            !open && "brightness-75 grayscale",
          )}
        />
        <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
        <span className="absolute right-2 bottom-1.5 left-2 text-white">
          <span className="block text-sm font-semibold text-white/80">
            Region {props.index + 1} · {info.region}
          </span>
          <span className="block text-lg leading-tight font-black">{info.name}</span>
        </span>
        <span
          className="absolute top-1.5 right-1.5 flex gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5"
          role="img"
          aria-label={`Danger ${props.index + 1} of ${CS_REGIONS.length}`}
        >
          {CS_REGIONS.map((stage, danger) => (
            <Skull
              key={stage}
              className={cn(
                "h-3.5 w-3.5",
                danger <= props.index ? "text-red-400" : "text-white/25",
              )}
            />
          ))}
        </span>
        {!open && (
          <span className="absolute top-1.5 left-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white">
            <Lock className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2">
        <p className="text-muted-foreground text-sm leading-snug">{info.summary}</p>
        <p className="mt-auto flex items-center gap-1.5 text-sm font-semibold">
          {record?.won ? (
            <>
              <Sunrise className="h-4 w-4 text-amber-500" />
              Report delivered · {record.kills.toLocaleString()} defeated
            </>
          ) : record ? (
            <>
              <Trophy className="h-4 w-4 text-amber-600" />
              Best {formatClock(record.seconds)} · level {record.level}
            </>
          ) : !open ? (
            <>
              <Lock className="text-muted-foreground h-4 w-4" />
              Scout {formatClock(info.unlockSeconds)} in{" "}
              {previous ? CS_STAGE_INFO[previous].name : "the previous stage"}
            </>
          ) : (
            <span className="text-muted-foreground font-normal">Not yet fought</span>
          )}
        </p>
      </div>
    </button>
  );
};

/**
 * The signed-in scout's way into a run: the chosen region, its record and the start
 * button, in place of the visitor's landing.
 */
const ScoutingCard = (props: {
  stage: CsStage;
  progress: CsProgress;
  disabled?: boolean;
  isStarting?: boolean;
  onStart: () => void;
}) => {
  const info = CS_STAGE_INFO[props.stage];
  const record = props.progress.stages[props.stage];
  const number = CS_REGIONS.indexOf(props.stage) + 1;
  return (
    <section
      aria-label="Start scouting"
      className="bg-card flex flex-col gap-3 rounded-xl border-2 border-amber-500/70 p-3 @[34rem]:flex-row @[34rem]:items-center"
    >
      <Image
        src={CS_STAGE_IMAGE_URLS[props.stage]}
        alt=""
        width={480}
        height={320}
        className="h-24 w-full rounded-lg object-cover @[34rem]:h-20 @[34rem]:w-32"
      />
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground text-sm font-semibold">
          {info.endless ? "Endless" : `Region ${number}`} · {info.region}
        </p>
        <p className="text-xl leading-tight font-black">{info.name}</p>
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <Trophy className="h-4 w-4 shrink-0 text-amber-600" />
          {record
            ? info.endless
              ? `Best ${formatClock(record.seconds)} · level ${record.level}`
              : record.won
                ? `Report delivered · ${record.kills.toLocaleString()} defeated`
                : `Best ${formatClock(record.seconds)} · level ${record.level}`
            : info.endless
              ? "Hold out as long as your cover lasts"
              : `Hold out ${formatClock(CS_RUN_SECONDS)} until reinforcements arrive`}
        </p>
      </div>
      <Button
        size="lg"
        className="bg-amber-500 text-lg font-bold text-black hover:bg-amber-400"
        disabled={props.disabled}
        onClick={props.onStart}
      >
        <Play className="mr-2 h-5 w-5" />
        {props.isStarting ? "Preparing..." : "Begin scouting"}
      </Button>
    </section>
  );
};

/**
 * Undercover, the endless region, as a card in the region grid: its painting, its record
 * and the way to the monthly leaderboard its runs rank on.
 */
const UndercoverCard = (props: {
  progress: CsProgress;
  selected: boolean;
  onSelect: () => void;
}) => {
  const id = CS_LEADERBOARD_STAGE;
  const info = CS_STAGE_INFO[id];
  const record = props.progress.stages[id];
  return (
    <div
      className={cn(
        "bg-card flex flex-col overflow-hidden rounded-xl border-2 transition",
        props.selected
          ? "border-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.35)]"
          : "border-border hover:border-amber-500/60",
      )}
    >
      <button
        type="button"
        onClick={props.onSelect}
        aria-pressed={props.selected}
        className="group flex flex-1 flex-col text-left focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none"
      >
        <div className="relative h-28 w-full overflow-hidden">
          <Image
            src={CS_STAGE_IMAGE_URLS[id]}
            alt=""
            width={480}
            height={320}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
          <span className="absolute top-1.5 right-1.5 rounded-full bg-violet-600 px-2 py-0.5 text-sm font-semibold text-white">
            Endless
          </span>
          <span className="absolute right-2 bottom-1.5 left-2 text-white">
            <span className="block text-sm font-semibold text-white/80">
              {info.region}
            </span>
            <span className="block text-lg leading-tight font-black">{info.name}</span>
          </span>
        </div>
        <p className="text-muted-foreground px-2 pt-2 text-sm leading-snug">
          {info.summary} The longest covers this month top the leaderboard.
        </p>
      </button>
      <div className="flex flex-wrap items-center justify-between gap-2 p-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {record ? (
            <>
              <Trophy className="h-4 w-4 text-amber-600" />
              Best {formatClock(record.seconds)} · level {record.level}
            </>
          ) : (
            <span className="text-muted-foreground font-normal">Not yet attempted</span>
          )}
        </span>
        <LeaderboardButton size="sm" />
      </div>
    </div>
  );
};

/** The scouting regions, which the endless Undercover region follows on its own card. */
const CS_REGIONS = CS_STAGES.filter((id) => !CS_STAGE_INFO[id].endless);

/**
 * The daily scouting report: what a signed-in player's first long enough run of the day
 * pays and whether it has, or for a guest, the reason to sign up.
 */
const DailyReport = (props: {
  daily: {
    reward: { ryo: number; prestige: number; villageTokens: number };
    done: boolean;
    hasVillage: boolean;
  } | null;
}) => {
  const { daily } = props;
  const minutes = CS_DAILY_SECONDS / 60;
  return (
    <MiniGameDailyDuty
      id="cs-daily"
      title="Daily scouting report"
      done={daily?.done ?? false}
      description={
        !daily
          ? `Signed-in scouts earn ryo, prestige and tokens for their village once a day for a run of ${minutes} minutes or more. Every run is verified by the server.`
          : daily.done
            ? "Delivered today. Your village thanks you; the next report is due tomorrow."
            : `Scout ${minutes} minutes or more in any region today.`
      }
      reward={daily?.reward}
      hasVillage={daily?.hasVillage}
      action={
        !daily ? (
          <Button asChild size="sm">
            <Link href="/signup">
              <UserPlus className="mr-1.5 h-4 w-4" />
              Join to earn
            </Link>
          </Button>
        ) : undefined
      }
    />
  );
};

const TrainingCard = (props: {
  id: CsTraining;
  busy: boolean;
  progress: CsProgress;
  onTrain: () => void;
}) => {
  const info = CS_TRAINING_INFO[props.id];
  const level = props.progress.training[props.id];
  const cost = csTrainingCost(props.id, props.progress.training);
  const Icon = TRAINING_ICONS[props.id];
  return (
    <div className="bg-card flex items-center gap-2 rounded-lg border p-2">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600">
        <Icon className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-base leading-tight font-bold">{info.name}</span>
          <span
            className="flex gap-0.5"
            role="img"
            aria-label={`Level ${level} of ${info.maxLevel}`}
          >
            {Array.from({ length: info.maxLevel }, (_, index) => (
              <span
                key={index}
                className={cn(
                  "h-2 w-2 rounded-full border border-violet-500",
                  index < level && "bg-violet-500",
                )}
              />
            ))}
          </span>
        </div>
        <p className="text-muted-foreground text-sm leading-tight">{info.perLevel}</p>
      </div>
      <Button
        size="sm"
        variant={cost !== null && cost <= props.progress.intel ? "default" : "outline"}
        disabled={props.busy || cost === null || cost > props.progress.intel}
        onClick={props.onTrain}
        className="shrink-0 tabular-nums"
        aria-label={
          cost === null
            ? `${info.name} mastered`
            : `Train ${info.name} for ${cost} intel`
        }
      >
        {cost === null ? (
          "Mastered"
        ) : (
          <>
            <Gem className="mr-1 h-3.5 w-3.5" />
            {cost.toLocaleString()}
          </>
        )}
      </Button>
    </div>
  );
};
