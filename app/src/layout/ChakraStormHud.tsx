"use client";

import {
  Dices,
  Gem,
  HeartPlus,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  ScrollText,
  SkipForward,
  Skull,
  Sparkles,
  Timer,
  Trophy,
  Unlock,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { CS_ICON_URLS } from "@/drizzle/constants";
import type {
  ChakraStormAnnouncement,
  ChakraStormHud,
  ChakraStormOutcome,
} from "@/hooks/useChakraStormRun";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import { QUEST_LOGBOOK_HREF } from "@/layout/QuestChallenge";
import {
  CS_JUTSU_INFO,
  CS_PASSIVE_INFO,
  CS_RUN_SECONDS,
  CS_SLOTS,
  CS_STAGE_INFO,
  CS_TPS,
  type CsJutsu,
  type CsPassive,
  type CsStage,
  csBossSeconds,
  csUpgradeText,
} from "@/libs/chakraStorm/content";
import type { CsUnlockGoal } from "@/libs/chakraStorm/progress";
import type { CsDraftOption } from "@/libs/chakraStorm/sim";
import { cn } from "@/libs/shadui";

/** Passive arts share one gold accent; jutsu carry their element's colour. */
export const CS_PASSIVE_COLOR = "#d97706";

/** mm:ss for a count of seconds, or h:mm:ss from an hour on. */
export const formatClock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  const pad = (value: number) => String(value).padStart(2, "0");
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${pad(minutes)}:${pad(whole % 60)}`;
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}:${pad(whole % 60)}`;
};

/** A jutsu's or passive art's painted icon, framed in its colour. */
export const ChakraStormIcon = (props: {
  id: CsJutsu | CsPassive;
  color: string;
  className?: string;
  /** Awakened jutsu wear a gold frame and glow. */
  awakened?: boolean;
}) => (
  <span
    className={cn(
      "relative block shrink-0 overflow-hidden rounded-lg border-2 bg-black",
      props.awakened && "shadow-[0_0_10px_rgba(255,211,107,0.9)]",
      props.className ?? "h-10 w-10",
    )}
    style={{ borderColor: props.awakened ? "#ffd36b" : props.color }}
  >
    <Image
      src={CS_ICON_URLS[props.id]}
      alt=""
      width={128}
      height={128}
      className="h-full w-full object-cover"
    />
  </span>
);

/** The meters, banners and buttons laid over the battlefield while a run is on. */
export const ChakraStormOverlay = (props: {
  hud: ChakraStormHud;
  paused: boolean;
  soundOn: boolean;
  isFullscreen: boolean;
  announcement: ChakraStormAnnouncement | null;
  /** The region this run opens once it lasts long enough. */
  goal: CsUnlockGoal | null;
  /** The region's longest run before this one, in seconds. */
  record: number | null;
  onPause: (paused: boolean) => void;
  onSound?: (on: boolean) => void;
  onFullscreen?: () => void;
}) => {
  const { hud } = props;
  const seconds = hud.tick / CS_TPS;
  const hpShare = Math.max(0, hud.hero.hp / hud.hero.maxHp);
  const nextBoss = nextBossSeconds(hud.config.stage, seconds);
  const bossIn = nextBoss === null ? null : nextBoss - seconds;
  return (
    <>
      {/* Low health darkens the field's edge in red. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[6] transition-opacity duration-300"
        style={{
          opacity: hpShare < 0.35 ? (0.35 - hpShare) / 0.35 : 0,
          boxShadow: "inset 0 0 70px 18px rgba(200,0,0,0.75)",
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 space-y-1 p-1.5 text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
        {/* Experience */}
        <div className="relative h-4 overflow-hidden rounded-full border border-white/25 bg-black/55">
          <div
            className="h-full bg-gradient-to-r from-sky-500 to-cyan-300 transition-[width] duration-150"
            style={{
              width: `${Math.min(100, (100 * hud.hero.experience) / hud.hero.next)}%`,
            }}
          />
          <span className="absolute inset-0 flex items-center justify-center text-sm leading-none font-bold">
            Level {hud.hero.level}
          </span>
        </div>
        {/* Health | report timer and tally | controls: the middle column stays centred and
            the sides share what is left, so nothing pushes past the edge on narrow screens. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2">
          <div className="min-w-0">
            <div className="relative h-5 max-w-64 overflow-hidden rounded-md border border-white/25 bg-black/55">
              <div
                className={cn(
                  "h-full transition-[width] duration-150",
                  hpShare > 0.5
                    ? "bg-emerald-500"
                    : hpShare > 0.25
                      ? "bg-amber-500"
                      : "bg-red-600",
                )}
                style={{ width: `${hpShare * 100}%` }}
              />
              <span className="absolute inset-0 flex items-center justify-center text-sm leading-none font-bold tabular-nums">
                {Math.ceil(hud.hero.hp)}/{hud.hero.maxHp}
              </span>
            </div>
            {hud.hero.revives > 0 && (
              <span className="block text-sm leading-tight font-semibold text-amber-200">
                Second Wind ready
              </span>
            )}
          </div>
          <div className="flex flex-col items-center leading-tight">
            <span
              className="flex items-center gap-1 text-xl font-black tabular-nums"
              title="Time scouted"
            >
              <Timer className="h-5 w-5 shrink-0 text-white/85" />
              {formatClock(seconds)}
            </span>
            {CS_STAGE_INFO[hud.config.stage].endless ? (
              <CoverProgress seconds={seconds} record={props.record} />
            ) : (
              <RunProgress
                seconds={seconds}
                goal={props.goal}
                survive={hud.config.challenge?.seconds}
              />
            )}
            <span className="flex items-center gap-1 text-sm font-bold text-white/90 tabular-nums">
              <Skull className="h-3.5 w-3.5 shrink-0" />
              {hud.kills.toLocaleString()}
            </span>
            {bossIn !== null && bossIn <= 30 && (
              <span className="text-sm font-bold whitespace-nowrap text-red-300">
                Hunter in {Math.ceil(bossIn)}s
              </span>
            )}
          </div>
          <div className="pointer-events-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
            {props.onSound && (
              <OverlayButton
                label={props.soundOn ? "Mute sound" : "Turn sound on"}
                onClick={() => props.onSound?.(!props.soundOn)}
              >
                {props.soundOn ? <Volume2 /> : <VolumeX />}
              </OverlayButton>
            )}
            <OverlayButton
              label={props.paused ? "Resume" : "Pause (P)"}
              onClick={() => props.onPause(!props.paused)}
            >
              {props.paused ? <Play /> : <Pause />}
            </OverlayButton>
            {props.onFullscreen && (
              <OverlayButton
                label={props.isFullscreen ? "Leave full screen" : "Full screen"}
                onClick={props.onFullscreen}
              >
                {props.isFullscreen ? <Minimize /> : <Maximize />}
              </OverlayButton>
            )}
          </div>
        </div>
        {hud.boss && (
          <div className="mx-auto w-[min(72%,28rem)]">
            <div className="text-center text-sm font-bold text-red-200">
              {hud.boss.name}
            </div>
            <div className="h-3 overflow-hidden rounded-full border border-red-300/40 bg-black/60">
              <div
                className="h-full bg-red-600 transition-[width] duration-150"
                style={{ width: `${(100 * hud.boss.hp) / hud.boss.maxHp}%` }}
              />
            </div>
          </div>
        )}
        {props.announcement && <Announcement announcement={props.announcement} />}
      </div>
    </>
  );
};

/**
 * The run's path to the reinforcements' arrival: a bar with a flag where the next
 * region opens, and one line
 * naming the next goal and how long is left to reach it.
 */
const RunProgress = (props: {
  seconds: number;
  goal: CsUnlockGoal | null;
  /** A quest challenge's survival time, which ends the run in place of reinforcements. */
  survive?: number;
}) => {
  const { seconds, goal } = props;
  const pending = goal && seconds < goal.seconds ? goal : null;
  const end = props.survive ?? CS_RUN_SECONDS;
  return (
    <>
      <div className="relative my-0.5 h-1.5 w-28 rounded-full border border-white/25 bg-black/55">
        <div
          className="h-full rounded-full bg-amber-300"
          style={{ width: `${Math.min(100, (100 * seconds) / end)}%` }}
        />
        {pending && (
          <span
            aria-hidden
            className="absolute -top-1 h-3 w-0.5 rounded-full bg-emerald-300"
            style={{ left: `${(100 * pending.seconds) / end}%` }}
          />
        )}
      </div>
      {pending ? (
        <span
          className="flex items-center gap-1 text-sm font-bold whitespace-nowrap text-emerald-300 tabular-nums"
          title={`Hold out until ${formatClock(pending.seconds)} to open ${CS_STAGE_INFO[pending.stage].name}`}
        >
          <Unlock className="h-3.5 w-3.5 shrink-0" />
          Next region in {formatClock(pending.seconds - seconds)}
        </span>
      ) : props.survive ? (
        <span
          className="flex items-center gap-1 text-sm font-bold whitespace-nowrap text-amber-200 tabular-nums"
          title={`Survive until ${formatClock(props.survive)} to weather the storm`}
        >
          <Timer className="h-3.5 w-3.5 shrink-0" />
          Survive {formatClock(Math.max(0, props.survive - seconds))} more
        </span>
      ) : (
        <span
          className="flex items-center gap-1 text-sm font-bold whitespace-nowrap text-amber-200 tabular-nums"
          title={`Reinforcements arrive at ${formatClock(CS_RUN_SECONDS)} to bring your report home`}
        >
          <Users className="h-3.5 w-3.5 shrink-0" />
          Reinforcements in {formatClock(CS_RUN_SECONDS - seconds)}
        </span>
      )}
    </>
  );
};

/** Undercover has no end to count down to: the line measures the run against the best one. */
const CoverProgress = (props: { seconds: number; record: number | null }) => {
  const { seconds, record } = props;
  if (!record)
    return (
      <span className="text-sm font-bold whitespace-nowrap text-white/85">
        No reinforcements are coming
      </span>
    );
  return seconds > record ? (
    <span className="flex items-center gap-1 text-sm font-bold whitespace-nowrap text-emerald-300">
      <Trophy className="h-3.5 w-3.5 shrink-0" />
      New best
    </span>
  ) : (
    <span
      className="flex items-center gap-1 text-sm font-bold whitespace-nowrap text-amber-200 tabular-nums"
      title="Your longest Undercover run"
    >
      <Trophy className="h-3.5 w-3.5 shrink-0" />
      Best {formatClock(record)}
    </span>
  );
};

/** When the next hunter arrives after `seconds`, or null when none is left to come. */
const nextBossSeconds = (stage: CsStage, seconds: number) => {
  for (let index = 0; ; index++) {
    const at = csBossSeconds(stage, index);
    if (at === null || at > seconds) return at;
  }
};

/** A banner across the field for captains, ambushes, awakenings and treasure. */
const Announcement = (props: { announcement: ChakraStormAnnouncement }) => {
  const { announcement } = props;
  return (
    <div
      key={announcement.id}
      role="status"
      className={cn(
        "animate-in fade-in zoom-in-95 slide-in-from-top-2 mx-auto mt-2 w-fit max-w-[92%] rounded-lg border px-4 py-1.5 text-center duration-300",
        announcement.tone === "danger" && "border-red-400/60 bg-red-950/80",
        announcement.tone === "reward" && "border-amber-300/70 bg-amber-950/80",
        announcement.tone === "info" && "border-sky-300/60 bg-sky-950/80",
      )}
    >
      <div className="text-xl leading-tight font-black tracking-wide uppercase">
        {announcement.title}
      </div>
      {announcement.detail && (
        <div className="text-sm font-semibold text-white/85">{announcement.detail}</div>
      )}
    </div>
  );
};

const OverlayButton = (props: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <Button
    size="icon"
    variant="ghost"
    aria-label={props.label}
    title={props.label}
    className="h-9 w-9 rounded-full bg-black/45 text-white hover:bg-black/70 hover:text-white [&_svg]:h-5 [&_svg]:w-5"
    onClick={props.onClick}
  >
    {props.children}
  </Button>
);

/** The level-up choice: three cards, picked by click or the keys 1 to 3. */
export const ChakraStormDraft = (props: {
  hud: ChakraStormHud;
  onPick: (index: number) => void;
  onReroll: () => void;
  onSkip: () => void;
}) => {
  const { draft } = props.hud;
  const { onPick, onReroll, onSkip } = props;
  const canReroll = props.hud.hero.rerolls > 0;
  useEffect(() => {
    if (!draft) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const key = event.key.toLowerCase();
      const index = Number(key) - 1;
      if (index >= 0 && index < draft.length) onPick(index);
      else if (key === "r" && canReroll) onReroll();
      else if (key === "x") onSkip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canReroll, draft, onPick, onReroll, onSkip]);
  if (!draft) return null;
  return (
    <div className="@container absolute inset-0 z-20 flex items-center justify-center overflow-y-auto bg-black/65 p-2 backdrop-blur-[2px]">
      <div className="animate-in fade-in zoom-in-95 w-full max-w-4xl space-y-2 duration-200">
        <h3 className="text-center text-xl font-black text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.8)] @[45rem]:text-2xl">
          Level {props.hud.hero.level}: choose an art
        </h3>
        <div className="grid gap-2 @[45rem]:grid-cols-3">
          {draft.map((option, index) => (
            <DraftCard
              key={optionKey(option)}
              option={option}
              hotkey={index + 1}
              hud={props.hud}
              onPick={() => onPick(index)}
            />
          ))}
        </div>
        <div className="flex justify-center gap-2">
          <Button
            variant="secondary"
            disabled={!canReroll}
            onClick={onReroll}
            title="Reroll (R)"
          >
            <Dices className="mr-1.5 h-4 w-4" />
            Reroll ({props.hud.hero.rerolls})
          </Button>
          <Button variant="secondary" onClick={onSkip} title="Skip (X)">
            <SkipForward className="mr-1.5 h-4 w-4" />
            Skip
          </Button>
        </div>
      </div>
    </div>
  );
};

const DraftCard = (props: {
  option: CsDraftOption;
  hotkey: number;
  hud: ChakraStormHud;
  onPick: () => void;
}) => {
  const look = describeOption(props.option, props.hud);
  return (
    <button
      type="button"
      onClick={props.onPick}
      className="bg-card group flex min-w-0 flex-col gap-1.5 rounded-xl border-2 p-2.5 text-left shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none @[45rem]:gap-2 @[45rem]:p-3"
      style={{ borderColor: look.color }}
    >
      {/* What kind of card it is, on its own line so the title never shares a row. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span
          className="rounded px-1.5 py-0.5 text-sm leading-none font-bold"
          style={{ backgroundColor: `${look.color}33` }}
        >
          {look.badge}
        </span>
        <span className="text-muted-foreground text-sm">{look.kind}</span>
        <kbd className="text-muted-foreground ml-auto hidden rounded border px-1 text-sm leading-tight sm:inline [@media(pointer:coarse)]:hidden">
          {props.hotkey}
        </kbd>
      </div>
      <div className="flex items-center gap-2.5">
        {look.icon ? (
          <ChakraStormIcon id={look.icon} color={look.color} className="h-12 w-12" />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-600">
            <HeartPlus className="h-7 w-7" />
          </span>
        )}
        <span className="min-w-0 text-lg leading-tight font-bold [overflow-wrap:anywhere]">
          {look.name}
        </span>
      </div>
      <div className="space-y-0.5">
        <p className="text-base leading-snug font-semibold">{look.effect}</p>
        {/* Stacked cards keep to what changes, so all three fit a phone's field. */}
        <p className="text-muted-foreground hidden text-sm leading-snug @[45rem]:block">
          {look.summary}
        </p>
        {look.awakening && (
          <p className="flex items-start gap-1 text-sm leading-snug font-semibold text-amber-600">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            {look.awakening}
          </p>
        )}
      </div>
    </button>
  );
};

/** The hero's jutsu and passive arts, each with its level, awakening and what it does. */
export const ChakraStormBuild = (props: {
  hud: ChakraStormHud;
  className?: string;
}) => {
  const { hud } = props;
  return (
    <div className={cn("@container", props.className)}>
      <div className="grid gap-2 @lg:grid-cols-2">
        <section className="space-y-1">
          <h4 className="text-base font-bold">
            Jutsu {hud.jutsu.length}/{CS_SLOTS}
          </h4>
          {hud.jutsu.map((entry) => {
            const info = CS_JUTSU_INFO[entry.id];
            const ready = hud.awakenable.some((jutsu) => jutsu.id === entry.id);
            return (
              <BuildRow
                key={entry.id}
                icon={entry.id}
                color={info.color}
                name={entry.awakened ? info.awakening.name : info.name}
                level={entry.awakened ? info.levels.length : entry.level}
                maxLevel={info.levels.length}
                awakened={entry.awakened}
                detail={
                  entry.awakened
                    ? info.awakening.summary
                    : ready
                      ? "Mastered: the next scroll awakens it"
                      : entry.level >= info.levels.length
                        ? `Mastered: awakens with ${CS_PASSIVE_INFO[info.awakening.partner].name} and a scroll`
                        : info.summary
                }
              />
            );
          })}
          <EmptySlots count={CS_SLOTS - hud.jutsu.length} label="jutsu" />
        </section>
        <section className="space-y-1">
          <h4 className="text-base font-bold">
            Passive arts {hud.passives.length}/{CS_SLOTS}
          </h4>
          {hud.passives.map((entry) => {
            const info = CS_PASSIVE_INFO[entry.id];
            return (
              <BuildRow
                key={entry.id}
                icon={entry.id}
                color={CS_PASSIVE_COLOR}
                name={info.name}
                level={entry.level}
                maxLevel={info.maxLevel}
                detail={info.perLevel}
              />
            );
          })}
          <EmptySlots count={CS_SLOTS - hud.passives.length} label="passive" />
        </section>
      </div>
    </div>
  );
};

export const BuildRow = (props: {
  icon: CsJutsu | CsPassive;
  color: string;
  name: string;
  level: number;
  maxLevel: number;
  detail: string;
  awakened?: boolean;
}) => (
  <div
    className={cn(
      "bg-card flex items-center gap-2 rounded-lg border p-1.5",
      props.awakened && "border-amber-400 bg-amber-500/10",
    )}
  >
    <ChakraStormIcon
      id={props.icon}
      color={props.color}
      awakened={props.awakened}
      className="h-10 w-10"
    />
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-base leading-tight font-semibold">{props.name}</span>
        {props.awakened ? (
          <span className="flex shrink-0 items-center gap-1 text-sm font-bold text-amber-600">
            <Sparkles className="h-4 w-4" />
            Awakened
          </span>
        ) : (
          props.maxLevel > 0 && (
            <span
              className="flex shrink-0 gap-0.5"
              role="img"
              aria-label={`Level ${props.level} of ${props.maxLevel}`}
            >
              {Array.from({ length: props.maxLevel }, (_, index) => (
                <span
                  key={index}
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: index < props.level ? props.color : "transparent",
                    border: `1px solid ${props.color}`,
                  }}
                />
              ))}
            </span>
          )
        )}
      </div>
      <p className="text-muted-foreground text-sm leading-tight">{props.detail}</p>
    </div>
  </div>
);

const EmptySlots = (props: { count: number; label: string }) =>
  props.count > 0 ? (
    <div className="text-muted-foreground rounded-lg border border-dashed p-1.5 text-center text-sm">
      {props.count} open {props.label} slot{props.count === 1 ? "" : "s"}
    </div>
  ) : null;

/**
 * The pause menu, which leaving mid-run also opens: what holding out longer would still
 * earn, so giving up is a choice made knowingly.
 */
export const ChakraStormPaused = (props: {
  hud: ChakraStormHud;
  goal: CsUnlockGoal | null;
  record: number | null;
  onGiveUp: () => void;
  onResume: () => void;
}) => {
  const seconds = props.hud.tick / CS_TPS;
  const endless = !!CS_STAGE_INFO[props.hud.config.stage].endless;
  const pending = props.goal && seconds < props.goal.seconds ? props.goal : null;
  const survive = props.hud.config.challenge?.seconds;
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/70 p-4 text-center text-white">
      <span className="text-3xl font-black">Paused</span>
      <div className="space-y-1 text-base font-semibold">
        {pending && (
          <p className="text-balance text-emerald-300">
            <Unlock className="mr-1.5 inline h-4 w-4 align-[-0.15em]" />
            {formatClock(pending.seconds - seconds)} more opens{" "}
            {CS_STAGE_INFO[pending.stage].name}
          </p>
        )}
        {endless ? (
          props.record !== null &&
          props.record > seconds && (
            <p className="text-balance text-amber-200">
              <Trophy className="mr-1.5 inline h-4 w-4 align-[-0.15em]" />
              {formatClock(props.record - seconds)} more beats your best of{" "}
              {formatClock(props.record)}
            </p>
          )
        ) : survive ? (
          <p className="text-balance text-amber-200">
            <Timer className="mr-1.5 inline h-4 w-4 align-[-0.15em]" />
            Survive {formatClock(Math.max(0, survive - seconds))} more to weather the
            storm
          </p>
        ) : (
          <p className="text-balance text-amber-200">
            <Users className="mr-1.5 inline h-4 w-4 align-[-0.15em]" />
            Reinforcements arrive in {formatClock(CS_RUN_SECONDS - seconds)} to bring
            your report home
          </p>
        )}
        <p className="text-sm font-normal text-white/75">
          {survive
            ? "Giving up abandons the storm without surviving it."
            : "Giving up ends the run and banks the intel scouted so far."}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" className="text-foreground" onClick={props.onGiveUp}>
          Give up
        </Button>
        <Button onClick={props.onResume}>Resume</Button>
      </div>
    </div>
  );
};

/** The end of a scouting run: how long the hero held out, the intel it brought and records. */
export const ChakraStormResults = (props: {
  outcome: ChakraStormOutcome;
  /** The region the run could have opened, to say how close it came. */
  goal: CsUnlockGoal | null;
  footer?: React.ReactNode;
  onAgain: () => void;
  /** Start a run in the region this one opened. */
  onScout: (stage: CsStage) => void;
  onLeave: () => void;
  onRetry: () => void;
}) => {
  const { outcome } = props;
  const verifying = outcome.claim === "pending";
  const stage = CS_STAGE_INFO[outcome.stage];
  const opened = outcome.unlocked;
  const shortOf =
    !opened && props.goal && outcome.seconds < props.goal.seconds ? props.goal : null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/70 p-2">
      <div className="bg-background animate-in fade-in zoom-in-95 w-full max-w-md space-y-3 rounded-xl border p-5 text-center shadow-xl duration-300">
        <div>
          <p className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
            {stage.name}
          </p>
          <h3 className="text-2xl font-black">
            {stage.endless
              ? outcome.won
                ? `Extracted with your report after ${formatClock(outcome.seconds)}`
                : `Cover blown at ${formatClock(outcome.seconds)}`
              : outcome.won
                ? outcome.challenge
                  ? "You survived the storm!"
                  : "Scouting complete: report delivered!"
                : `Forced to retreat at ${formatClock(outcome.seconds)}`}
          </h3>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Scouted" value={formatClock(outcome.seconds)} />
          <Stat label="Defeated" value={outcome.kills.toLocaleString()} />
          <Stat label="Level" value={String(outcome.level)} />
        </div>
        {verifying ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border p-2 text-base font-semibold">
            <Loader2 className="h-5 w-5 animate-spin" />
            Verifying your report...
          </div>
        ) : outcome.claim === "failed" ? (
          <div className="space-y-2 rounded-lg border border-red-400/60 bg-red-500/10 p-2 text-base">
            <p className="font-semibold">{outcome.message}</p>
            {outcome.retryable && (
              <Button size="sm" variant="outline" onClick={props.onRetry}>
                <RotateCcw className="mr-1.5 h-4 w-4" />
                Try again
              </Button>
            )}
          </div>
        ) : outcome.challenge ? (
          <p className="text-base">{outcome.message}</p>
        ) : (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-violet-400/50 bg-violet-500/10 p-2 text-base font-bold">
            <Gem className="h-5 w-5 shrink-0 text-violet-500" />+
            {outcome.intel.toLocaleString()} intel for the Training Hall
          </div>
        )}
        {outcome.dailyReward && (
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg border border-amber-400/70 bg-amber-500/10 p-2 text-base font-bold">
            <ScrollText className="h-5 w-5 shrink-0 text-amber-600" />
            Daily report delivered: +{outcome.dailyReward.ryo.toLocaleString()} ryo, +
            {outcome.dailyReward.prestige} prestige
          </div>
        )}
        {opened && (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-emerald-400/60 bg-emerald-500/10 p-2 text-base font-bold">
            <Unlock className="h-5 w-5 text-emerald-600" />
            {CS_STAGE_INFO[opened].name} is open
          </div>
        )}
        {shortOf && (
          <p className="text-muted-foreground text-base text-balance">
            <Unlock className="mr-1.5 inline h-4 w-4 align-[-0.15em]" />
            Hold out until {formatClock(shortOf.seconds)} to open{" "}
            {CS_STAGE_INFO[shortOf.stage].name}
          </p>
        )}
        {outcome.isBest && (
          <p className="flex items-center justify-center gap-1.5 text-base font-semibold text-amber-600">
            <Trophy className="h-4 w-4" />
            Your best run in this region
          </p>
        )}
        {outcome.challenge ? (
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" disabled={verifying} onClick={props.onLeave}>
              Back
            </Button>
            {outcome.won ? (
              // The link opens once the win is recorded: leaving earlier would drop the
              // run a failed claim retries.
              outcome.claim === "paid" ? (
                <Button asChild>
                  <Link href={QUEST_LOGBOOK_HREF}>
                    <ScrollText className="mr-1.5 h-4 w-4" />
                    Open logbook
                  </Link>
                </Button>
              ) : (
                <Button disabled>
                  <ScrollText className="mr-1.5 h-4 w-4" />
                  Open logbook
                </Button>
              )
            ) : (
              <Button disabled={verifying} onClick={props.onAgain}>
                Try again
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" disabled={verifying} onClick={props.onLeave}>
                Train and choose region
              </Button>
              <Button
                variant={opened ? "outline" : "default"}
                disabled={verifying}
                onClick={props.onAgain}
              >
                Scout again
              </Button>
              {opened && (
                <Button disabled={verifying} onClick={() => props.onScout(opened)}>
                  Scout {CS_STAGE_INFO[opened].name}
                </Button>
              )}
              {stage.endless && <LeaderboardButton />}
            </div>
            {stage.endless && outcome.claim === "local" && (
              <p className="text-muted-foreground text-sm">
                Sign in to rank your Undercover runs on the monthly leaderboard.
              </p>
            )}
          </>
        )}
        {props.footer}
      </div>
    </div>
  );
};

const Stat = (props: { label: string; value: string }) => (
  <div className="bg-muted rounded-lg p-2">
    <div className="text-xl font-black tabular-nums">{props.value}</div>
    <div className="text-muted-foreground text-sm">{props.label}</div>
  </div>
);

const optionKey = (option: CsDraftOption) =>
  option.type === "heal" ? "heal" : `${option.type}-${option.id}`;

const describeOption = (option: CsDraftOption, hud: ChakraStormHud) => {
  if (option.type === "heal")
    return {
      icon: null,
      color: "#16a34a",
      name: "Ration Pill",
      kind: "Supplies",
      badge: "Heal",
      effect: "Restore 40 health",
      summary: "Every art is mastered; mend and fight on.",
      awakening: null,
    };
  if (option.type === "jutsu") {
    const info = CS_JUTSU_INFO[option.id];
    const partner = CS_PASSIVE_INFO[info.awakening.partner];
    const mastering = option.level === info.levels.length;
    return {
      icon: option.id,
      color: info.color,
      name: info.name,
      kind: info.elementName.endsWith("jutsu")
        ? info.elementName
        : `${info.elementName} jutsu`,
      badge: option.level === 1 ? "New" : `Lv ${option.level}`,
      // A new jutsu leads with what it does; an upgrade with what it adds.
      effect:
        option.level === 1 ? info.summary : csUpgradeText(option.id, option.level),
      summary: option.level === 1 ? "Learn this jutsu" : info.summary,
      awakening: mastering
        ? `Mastery: awakens into ${info.awakening.name} with ${partner.name} and a scroll`
        : null,
    };
  }
  const info = CS_PASSIVE_INFO[option.id];
  // A passive that completes a held jutsu's awakening pair says so.
  const pair = hud.jutsu.find(
    (entry) => CS_JUTSU_INFO[entry.id].awakening.partner === option.id,
  );
  return {
    icon: option.id,
    color: CS_PASSIVE_COLOR,
    name: info.name,
    kind: "Passive art",
    badge: option.level === 1 ? "New" : `Lv ${option.level}`,
    effect: info.perLevel,
    summary: info.summary,
    awakening:
      option.level === 1 && pair
        ? `Pairs with ${CS_JUTSU_INFO[pair.id].name} to awaken ${CS_JUTSU_INFO[pair.id].awakening.name}`
        : null,
  };
};

/** The way to the monthly Undercover leaderboard. */
export const LeaderboardButton = (props: { size?: "sm" | "default" }) => (
  <Button asChild variant="outline" size={props.size}>
    <Link href="/chakraStorm/leaderboard">
      <Trophy className="mr-1.5 h-4 w-4" />
      Leaderboard
    </Link>
  </Button>
);
