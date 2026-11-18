"use client";

import {
  CheckCircle2,
  Coins,
  Crosshair,
  Crown,
  Footprints,
  Info,
  Keyboard,
  Lock,
  Map as MapIcon,
  Play,
  RotateCcw,
  ScrollText,
  Shield,
  Sparkles,
  Swords,
  Trash2,
  Wind,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TD_DAILY_WAVES, TD_STAGE_IMAGE_URLS } from "@/drizzle/constants";
import Confirm from "@/layout/Confirm";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import { SEAL_GLYPHS, SEAL_HOTKEYS } from "@/layout/TowerDefenseHud";
import { TowerDefenseLanding } from "@/layout/TowerDefenseLanding";
import { cn } from "@/libs/shadui";
import {
  TD_HERO_BASE,
  TD_LEVEL_BONUS_MAX,
  TD_LEVEL_BONUS_MAX_LEVEL,
  TD_PIERCING_AFTER_WAVE,
  TD_SEAL_GAP_TICKS,
  TD_TICK_SECONDS,
  tdDailyReward,
  tdLevelDamageBonus,
} from "@/libs/towerDefense/balance";
import {
  TD_BOSS_INTERVAL,
  TD_CHECKPOINT_PERCENT,
  TD_DOJO,
  TD_DOJO_CATEGORIES,
  TD_DOJO_INFO,
  TD_ENEMIES,
  TD_ERA_INFO,
  TD_ERA_INTERVAL,
  TD_ERA_START_WAVE,
  TD_ERAS,
  TD_FOCUS_DAMAGE,
  TD_SEAL_ART_INFO,
  TD_SEAL_ARTS,
  TD_SEALS,
  TD_STAGES,
  TD_TITAN_INTERVAL,
  TD_ULTIMATES,
  type TdDojoCategory,
  type TdDojoLevels,
  type TdDojoUpgrade,
  type TdEnemyKind,
  tdCheckpoints,
  tdStageForWave,
} from "@/libs/towerDefense/content";
import { formatTdNumber } from "@/libs/towerDefense/format";
import { tdDojoCost } from "@/libs/towerDefense/sim";
import { capitalizeFirstLetter } from "@/utils/string";

/** Bosses, titans and mini-bosses are milestones rather than new families. */
const STAGE_SKIPPED_ENEMIES = new Set<TdEnemyKind>(["boss", "titan", "mini"]);

const CATEGORY_LABELS: Record<TdDojoCategory, string> = {
  offense: "Offense",
  defense: "Defense",
  economy: "Economy",
  jutsu: "Jutsu & Sentries",
  arts: "Ninja Arts",
  ultimate: "Ultimates",
};

/** Start or resume a run, spend scrolls in the Guard Hall and learn how the game works. */
export const TowerDefenseLobby = (props: {
  isGuest: boolean;
  /** The character's level, which raises damage in every run it starts; absent without one. */
  level?: number;
  /** Whether today's Guard Hall duty is done; absent for guests. */
  dailyDutyDone?: boolean;
  /** The village the player defends, when they belong to one. */
  villageName?: string;
  progress: { points: number; bestWave: number; dojo: TdDojoLevels } | undefined;
  saved: { wave: number; over: boolean } | null;
  isStarting: boolean;
  isResuming: boolean;
  isPurchasing: boolean;
  /** Sign-in is still being confirmed, so no run may start yet. */
  isLoading?: boolean;
  /** `replaceSaved` confirms that the saved run may be discarded. */
  onStart: (startWave: number, replaceSaved: boolean) => void;
  onResume: () => void;
  onDiscard: () => void;
  onBuy: (upgradeId: TdDojoUpgrade) => void;
}) => {
  const busy = props.isStarting || props.isResuming || !!props.isLoading;
  const bestWave = props.progress?.bestWave ?? 0;
  const checkpoints = tdCheckpoints(bestWave);
  const [startWave, setStartWave] = useState<number | null>(null);
  const chosen = props.isGuest
    ? 1
    : (startWave ?? checkpoints[checkpoints.length - 1] ?? 1);
  // Wave 1 and the four furthest checkpoints; the rest sit in a dropdown.
  const quickCheckpoints = [
    ...new Set([1, ...checkpoints.slice(Math.max(1, checkpoints.length - 4))]),
  ];
  const startButton = (
    <Button
      className="w-full"
      size="lg"
      disabled={busy}
      onClick={props.saved ? undefined : () => props.onStart(chosen, false)}
    >
      <Play className="mr-2 h-5 w-5" />
      {props.isStarting ? "Preparing..." : `Start at wave ${chosen}`}
    </Button>
  );
  const nextUnlock = TD_DOJO.map((id) => TD_DOJO_INFO[id])
    .filter((info) => info.unlockWave > bestWave)
    .sort((a, b) => a.unlockWave - b.unlockWave)[0];
  return (
    <div className="space-y-4">
      {props.isGuest && (
        <TowerDefenseLanding
          isStarting={props.isStarting}
          disabled={busy}
          onPlay={() => props.onStart(1, false)}
        />
      )}
      {props.isGuest && (
        <div className="rounded-lg border border-blue-500/50 bg-blue-500/10 p-3 text-sm">
          Playing as a guest: runs are not saved and earn no scrolls.{" "}
          <Link className="font-semibold underline" href="/login">
            Log in
          </Link>{" "}
          to train in the Guard Hall and climb the leaderboard.
        </div>
      )}
      {props.dailyDutyDone !== undefined && (
        <DailyDuty
          done={props.dailyDutyDone}
          level={props.level ?? 1}
          villageName={props.villageName}
        />
      )}
      <div className="grid gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Swords className="h-5 w-5" /> Defend the Village
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {props.saved && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-2">
                <span className="flex-1">
                  {props.saved.over ? "Unclaimed run" : "Unfinished run"} at wave{" "}
                  <strong>{props.saved.wave}</strong>
                </span>
                <Button size="sm" disabled={busy} onClick={props.onResume}>
                  {props.saved.over ? (
                    <ScrollText className="mr-1 h-4 w-4" />
                  ) : (
                    <RotateCcw className="mr-1 h-4 w-4" />
                  )}{" "}
                  {props.isResuming
                    ? "Restoring..."
                    : props.saved.over
                      ? "Claim"
                      : "Resume"}
                </Button>
                <Confirm
                  title="Discard this run?"
                  button={
                    <Button size="sm" variant="outline" disabled={busy}>
                      <Trash2 className="mr-1 h-4 w-4" /> Discard
                    </Button>
                  }
                  disabled={busy}
                  confirmDisabled={busy}
                  tone="destructive"
                  proceed_label="Discard"
                  onAccept={props.onDiscard}
                >
                  {props.saved.over
                    ? `Your run at wave ${props.saved.wave} has not been claimed yet. Discarding it loses the scrolls it earned.`
                    : `Discarding your unfinished run at wave ${props.saved.wave} loses it and the scrolls it would earn.`}
                </Confirm>
              </div>
            )}
            {!props.isGuest && (
              <div
                className={cn(
                  "grid gap-2",
                  props.level === undefined ? "grid-cols-2" : "grid-cols-3",
                )}
              >
                <Stat
                  icon={<ScrollText className="h-5 w-5 text-purple-500" />}
                  label="Scrolls"
                  value={formatTdNumber(props.progress?.points ?? 0)}
                />
                <Stat
                  icon={<Crown className="h-5 w-5 text-amber-500" />}
                  label="Best wave"
                  value={`${bestWave}`}
                />
                {props.level !== undefined && (
                  <Stat
                    icon={<Swords className="h-5 w-5 text-red-500" />}
                    label={`Level ${props.level}`}
                    value={`+${Math.round(tdLevelDamageBonus(props.level) * 100)}% dmg`}
                  />
                )}
              </div>
            )}
            {!props.isGuest && checkpoints.length > 1 && (
              <div>
                <p className="mb-1 font-semibold">Start from</p>
                <div className="flex flex-wrap items-center gap-1">
                  {quickCheckpoints.map((wave) => (
                    <Button
                      key={wave}
                      size="sm"
                      className="h-7 px-2"
                      variant={wave === chosen ? "default" : "outline"}
                      onClick={() => setStartWave(wave)}
                    >
                      {wave}
                    </Button>
                  ))}
                  {checkpoints.length > quickCheckpoints.length && (
                    <select
                      className="bg-background h-7 rounded-md border px-1 text-sm"
                      value={quickCheckpoints.includes(chosen) ? "" : chosen}
                      onChange={(event) => setStartWave(Number(event.target.value))}
                      aria-label="Other checkpoints"
                    >
                      <option value="" disabled>
                        Other…
                      </option>
                      {checkpoints.map((wave) => (
                        <option key={wave} value={wave}>
                          Wave {wave}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <p className="text-muted-foreground mt-1">
                  Checkpoints follow each boss, up to {TD_CHECKPOINT_PERCENT}% of your
                  best wave. Scrolls come only from waves you clear.
                </p>
              </div>
            )}
            {props.saved ? (
              <Confirm
                title="Start a new run?"
                button={startButton}
                disabled={busy}
                tone="destructive"
                proceed_label="Discard and start"
                proceed_loading_label="Preparing"
                isLoading={props.isStarting}
                onAccept={(event) => {
                  event.preventDefault();
                  props.onStart(chosen, true);
                }}
              >
                {props.saved.over
                  ? `Your run at wave ${props.saved.wave} has not been claimed yet. Starting a new run discards it and the scrolls it earned.`
                  : `Starting a new run discards your unfinished run at wave ${props.saved.wave} and the scrolls it would earn.`}
              </Confirm>
            ) : (
              startButton
            )}
            {nextUnlock && !props.isGuest && (
              <p className="text-muted-foreground">
                Next unlock: <strong>{nextUnlock.name}</strong> at wave{" "}
                {nextUnlock.unlockWave}
              </p>
            )}
          </CardContent>
        </Card>
        <Journey bestWave={bestWave} />
      </div>
      <HowToPlay bestWave={bestWave} hasLevel={props.level !== undefined} />
      {!props.isGuest && props.progress && (
        <Dojo
          progress={props.progress}
          isPurchasing={props.isPurchasing}
          onBuy={props.onBuy}
        />
      )}
    </div>
  );
};

/** Today's Guard Hall duty: what one long enough run pays the player and their village. */
const DailyDuty = (props: { done: boolean; level: number; villageName?: string }) => {
  const reward = tdDailyReward(props.level);
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3 text-sm",
        props.done
          ? "border-green-600/40 bg-green-600/10"
          : "border-amber-500/50 bg-amber-500/10",
      )}
    >
      {props.done ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
      ) : (
        <Shield className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      )}
      <div className="space-y-0.5">
        <p className="font-semibold">
          {props.done ? "Guard Hall duty done for today" : "Daily Guard Hall duty"}
        </p>
        <p>
          {props.done
            ? `${props.villageName ?? "Your village"} rests easy. A new duty comes with tomorrow's raiders.`
            : `Raiders march on ${props.villageName ?? "the village"} every day. Clear ${TD_DAILY_WAVES} waves in one run to earn ${reward.ryo.toLocaleString()} ryo${props.villageName ? `, ${reward.prestige} prestige and ${reward.villageTokens} tokens for ${props.villageName}` : ` and ${reward.prestige} prestige`}.`}
        </p>
      </div>
    </div>
  );
};

/** The road from Dawn to the Infinite Dream, with the player's best wave marked. */
const Journey = ({ bestWave }: { bestWave: number }) => {
  const best = Math.max(1, bestWave);
  const current = tdStageForWave(best);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <MapIcon className="h-5 w-5" /> The road to wave {TD_STAGES.at(-1)?.wave}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-4 gap-1.5">
          {TD_STAGES.map((stage, index) => {
            const reached = best >= stage.wave;
            const here = stage === current;
            const until = TD_STAGES[index + 1]?.wave;
            return (
              <Popover key={stage.name}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${stage.name}, from wave ${stage.wave}`}
                    className={cn(
                      "relative flex aspect-[4/3] flex-col items-start justify-end overflow-hidden rounded-lg border-2 p-1 text-left text-white",
                      here ? "border-amber-400" : "border-transparent",
                    )}
                  >
                    <span
                      className="absolute inset-0"
                      style={{ background: stageGradient(stage.sky, stage.ground) }}
                    />
                    <Image
                      src={TD_STAGE_IMAGE_URLS[stage.name]}
                      alt=""
                      width={320}
                      height={213}
                      className={cn(
                        "absolute inset-0 h-full w-full object-cover",
                        !reached && "brightness-75 saturate-[.35]",
                      )}
                    />
                    <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
                    {!reached && (
                      <Lock className="absolute top-1 right-1 h-3.5 w-3.5 drop-shadow" />
                    )}
                    {here && (
                      <span className="absolute top-1 left-1 rounded bg-amber-400 px-1 text-[0.7rem] font-bold text-black">
                        You are here
                      </span>
                    )}
                    <span className="relative text-[0.8rem] leading-tight font-bold drop-shadow">
                      {stage.name}
                    </span>
                    <span className="relative text-[0.75rem] leading-tight opacity-90 drop-shadow">
                      {until
                        ? `Waves ${stage.wave}–${until - 1}`
                        : `Wave ${stage.wave}+`}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 space-y-2 p-3 text-sm">
                  <div>
                    <p className="font-semibold">{stage.name}</p>
                    <p className="text-muted-foreground">
                      {here
                        ? `Your best run reached wave ${bestWave}.`
                        : reached
                          ? "Already behind you."
                          : `Reach wave ${stage.wave} to see it.`}
                    </p>
                  </div>
                  <StageNews from={stage.wave} until={until} />
                </PopoverContent>
              </Popover>
            );
          })}
        </div>
        <p className="text-muted-foreground">
          Tap a stage to see what it brings. The sky darkens and the battlefield grows
          wilder with every stage: new enemy families, elite affixes, era rules stacking
          two and three at a time, and a titan every {TD_TITAN_INTERVAL} waves. Each run
          pushes a little further as the Guard Hall makes you stronger.
        </p>
      </CardContent>
    </Card>
  );
};

/** What first appears between two waves: enemies, era rules, seal arts and milestones. */
const StageNews = ({ from, until }: { from: number; until?: number }) => {
  const within = (wave: number) =>
    wave >= from && (until === undefined || wave < until);
  const enemies = (Object.keys(TD_ENEMIES) as TdEnemyKind[])
    .filter(
      (kind) => !STAGE_SKIPPED_ENEMIES.has(kind) && within(TD_ENEMIES[kind].firstWave),
    )
    .map(capitalizeFirstLetter);
  const eras = TD_ERAS.filter(
    (era) => era !== "calm" && within(TD_ERA_INFO[era].firstWave),
  ).map((era) => TD_ERA_INFO[era].name);
  const arts = TD_SEAL_ARTS.filter((art) =>
    within(TD_SEAL_ART_INFO[art].firstWave),
  ).map((art) => TD_SEAL_ART_INFO[art].name);
  const milestones = [
    within(TD_BOSS_INTERVAL) && `A boss every ${TD_BOSS_INTERVAL} waves, then a perk`,
    within(TD_ERA_START_WAVE) &&
      `Era rules from wave ${TD_ERA_START_WAVE}, changing every ${TD_ERA_INTERVAL} waves`,
    within(TD_TITAN_INTERVAL) && `A titan every ${TD_TITAN_INTERVAL} waves`,
    within(TD_PIERCING_AFTER_WAVE + 1) &&
      `From wave ${TD_PIERCING_AFTER_WAVE + 1}, elite and boss hits pierce part of your max health`,
  ].filter((line): line is string => !!line);
  const sections: [string, string[]][] = [
    ["New enemies", enemies],
    ["New era rules", eras],
    ["Seal arts unlocked", arts],
    ["Milestones", milestones],
  ];
  const shown = sections.filter(([, items]) => items.length > 0);
  if (shown.length === 0)
    return (
      <p className="text-muted-foreground">
        Familiar foes, but tougher, faster and more often elite.
      </p>
    );
  return (
    <>
      {shown.map(([title, items]) => (
        <div key={title}>
          <p className="text-muted-foreground text-xs font-semibold uppercase">
            {title}
          </p>
          <p>{items.join(" · ")}</p>
        </div>
      ))}
    </>
  );
};

/** Illustrated rules, hand-seal recipes and controls. */
const HowToPlay = ({ bestWave, hasLevel }: { bestWave: number; hasLevel: boolean }) => (
  <Card>
    <CardHeader className="pb-2">
      <CardTitle className="flex items-center gap-2 text-lg">
        <Sparkles className="h-5 w-5" /> How to play
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-4 text-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <Rule
          icon={<Swords className="h-5 w-5" />}
          tone="bg-red-500/15 text-red-600 dark:text-red-400"
          title="Your ninja fights on its own"
        >
          Shuriken fly at the nearest enemy. Jutsu, sentries and ultimates join in as
          you unlock them.
          {hasLevel &&
            ` Your character level adds damage, up to +${TD_LEVEL_BONUS_MAX * 100}% at level ${TD_LEVEL_BONUS_MAX_LEVEL}.`}
        </Rule>
        <Rule
          icon={<Coins className="h-5 w-5" />}
          tone="bg-amber-500/15 text-amber-600 dark:text-amber-400"
          title="Ryo buys power for this run"
        >
          Kills pay ryo. Spend it on upgrades and sentry posts, or press{" "}
          <strong>Spend all</strong>.
        </Rule>
        <Rule
          icon={<ScrollText className="h-5 w-5" />}
          tone="bg-purple-500/15 text-purple-600 dark:text-purple-400"
          title="Scrolls make you stronger forever"
        >
          Every cleared wave earns scrolls. Train in the Guard Hall between runs to go
          further.
        </Rule>
        <Rule
          icon={<Crosshair className="h-5 w-5" />}
          tone="bg-sky-500/15 text-sky-600 dark:text-sky-400"
          title="Tap to mark and loot"
        >
          A marked enemy takes +{Math.round((TD_FOCUS_DAMAGE - 1) * 100)}% damage and
          loses its camouflage. Grab loot orbs before they fade.
        </Rule>
        <Rule
          icon={<Wind className="h-5 w-5" />}
          tone="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          title="Dodge the big hits"
        >
          <strong>Blink</strong> out of red circles, or time{" "}
          <strong>Substitution</strong> just before a boss strikes for a perfect
          counter.
        </Rule>
        <Rule
          icon={<Crown className="h-5 w-5" />}
          tone="bg-orange-500/15 text-orange-600 dark:text-orange-400"
          title="Bosses, perks and eras"
        >
          A boss every {TD_BOSS_INTERVAL} waves, then pick a perk. From wave{" "}
          {TD_ERA_START_WAVE} an era bends the rules every {TD_ERA_INTERVAL} waves:
          adapt your build.
        </Rule>
      </div>
      <div>
        <p className="mb-2 flex items-center gap-2 font-semibold">
          <Footprints className="h-4 w-4" /> Hand seals: form three to cast at the
          reticle
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {TD_SEAL_ARTS.map((art) => {
            const info = TD_SEAL_ART_INFO[art];
            const open = Math.max(1, bestWave) >= info.firstWave;
            return (
              <div
                key={art}
                className={cn(
                  "flex items-center gap-2 rounded-lg border p-2",
                  !open && "opacity-50",
                )}
                title={info.description}
              >
                <div className="flex gap-0.5">
                  {info.seals.map((seal, index) => (
                    <span
                      key={`${seal}-${index}`}
                      title={`${capitalizeFirstLetter(seal)} seal`}
                      className="bg-secondary flex h-8 w-8 items-center justify-center rounded-md text-base font-bold"
                    >
                      {SEAL_GLYPHS[seal]}
                    </span>
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{info.name}</p>
                  <p className="text-muted-foreground truncate">
                    {open
                      ? `${info.chakra} chakra`
                      : `Unlocks at wave ${info.firstWave}`}
                  </p>
                </div>
                {!open && <Lock className="h-4 w-4 shrink-0" />}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={`About ${info.name}`}
                      className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1"
                    >
                      <Info className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64 space-y-1.5 p-3 text-sm">
                    <p className="font-semibold">{info.name}</p>
                    <p>{info.description}</p>
                    <p className="text-muted-foreground">
                      Keys {info.seals.map((seal) => SEAL_HOTKEYS[seal]).join(" ")} ·{" "}
                      {info.chakra} chakra · from wave {info.firstWave}
                    </p>
                  </PopoverContent>
                </Popover>
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <p className="mb-2 flex items-center gap-2 font-semibold">
          <Keyboard className="h-4 w-4" /> Controls
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Control
            keys={TD_SEALS.map((seal) => SEAL_HOTKEYS[seal])}
            name="Hand seals"
            description={`Press three within ${seconds(TD_SEAL_GAP_TICKS)}s of each other to cast the matching art at the reticle.`}
          />
          <Control
            keys={["Space"]}
            name="Substitution"
            description={`For ${seconds(TD_HERO_BASE.substitutionWindow)}s the next hit strikes a log instead of you. Time it on a boss or telegraphed attack to counter with a huge critical blow and 1.5× damage for 3s. Recharges in ${seconds(TD_HERO_BASE.substitutionTicks)}s.`}
          />
          <Control
            keys={["B"]}
            name="Blink"
            description={`Then tap a spot near the centre to teleport there, out of a crowd or an incoming strike. Recharges in ${seconds(TD_HERO_BASE.blinkTicks)}s.`}
          />
          <Control
            keys={["T"]}
            name="Explosive tag"
            description={`Then tap where to plant it. The first enemy to step on it sets off a fiery blast that burns everything nearby. Holds ${TD_HERO_BASE.trapCharges} charges, one returning every ${seconds(TD_HERO_BASE.trapRechargeTicks)}s.`}
          />
          <Control
            keys={["1", "–", `${TD_ULTIMATES.length}`]}
            name="Ultimates"
            description="Your strongest techniques, unlocked in the Guard Hall, each on a long cooldown."
          />
          <Control
            keys={["N"]}
            name="Next wave"
            description="Once a wave is cleared, call the next one early for bonus ryo."
          />
        </div>
        <p className="text-muted-foreground mt-2">
          The Guard Hall shortens these cooldowns and adds tag charges.
        </p>
      </div>
    </CardContent>
  </Card>
);

const Rule = (props: {
  icon: ReactNode;
  tone: string;
  title: string;
  children: ReactNode;
}) => (
  <div className="flex gap-3 rounded-lg border p-3">
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
        props.tone,
      )}
    >
      {props.icon}
    </div>
    <div className="min-w-0">
      <p className="font-semibold">{props.title}</p>
      <p className="text-muted-foreground">{props.children}</p>
    </div>
  </div>
);

const Control = (props: { keys: string[]; name: string; description: string }) => (
  <div className="flex gap-2 rounded-lg border p-2">
    <span className="flex shrink-0 items-start gap-1 pt-0.5">
      {props.keys.map((key) =>
        key === "–" ? (
          <span key={key}>–</span>
        ) : (
          <kbd
            key={key}
            className="bg-secondary rounded border px-1.5 py-0.5 font-mono"
          >
            {key}
          </kbd>
        ),
      )}
    </span>
    <div className="min-w-0">
      <p className="font-semibold">{props.name}</p>
      <p className="text-muted-foreground">{props.description}</p>
    </div>
  </div>
);

const Stat = (props: { icon: ReactNode; label: string; value: string }) => (
  <div className="flex items-center gap-2 rounded-lg border p-2">
    {props.icon}
    <div>
      <p className="text-muted-foreground leading-tight">{props.label}</p>
      <p className="text-lg leading-tight font-bold">{props.value}</p>
    </div>
  </div>
);

const Dojo = (props: {
  progress: { points: number; bestWave: number; dojo: TdDojoLevels };
  isPurchasing: boolean;
  onBuy: (upgradeId: TdDojoUpgrade) => void;
}) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center justify-between gap-2 text-lg">
        <span className="flex items-center gap-2">
          <ScrollText className="h-5 w-5" /> Guard Hall
        </span>
        <Badge variant="secondary" className="text-sm">
          {`${formatTdNumber(props.progress.points)} scroll${props.progress.points === 1 ? "" : "s"}`}
        </Badge>
      </CardTitle>
    </CardHeader>
    <CardContent>
      <Tabs defaultValue="offense">
        <TabsList className="flex h-auto flex-wrap">
          {TD_DOJO_CATEGORIES.map((category) => (
            <TabsTrigger key={category} value={category} className="text-sm">
              {CATEGORY_LABELS[category]}
            </TabsTrigger>
          ))}
        </TabsList>
        {TD_DOJO_CATEGORIES.map((category) => (
          <TabsContent key={category} value={category}>
            <div className="grid gap-2 sm:grid-cols-2">
              {TD_DOJO.filter((id) => TD_DOJO_INFO[id].category === category).map(
                (id) => {
                  const info = TD_DOJO_INFO[id];
                  const level = props.progress.dojo[id] ?? 0;
                  const maxed = level >= info.max;
                  const locked = props.progress.bestWave < info.unlockWave;
                  const cost = tdDojoCost(id, level);
                  const affordable = props.progress.points >= cost;
                  return (
                    <div
                      key={id}
                      className="flex items-center gap-3 rounded-lg border p-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 font-semibold">
                          {info.name}
                          <Badge variant="outline">
                            {level}/{info.max}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground text-sm">
                          {info.description}
                        </p>
                      </div>
                      {locked ? (
                        <Badge variant="secondary" className="shrink-0">
                          <Lock className="mr-1 h-3 w-3" /> Wave {info.unlockWave}
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          className="shrink-0"
                          disabled={maxed || !affordable || props.isPurchasing}
                          onClick={() => props.onBuy(id)}
                        >
                          {maxed ? "Max" : formatTdNumber(cost)}
                        </Button>
                      )}
                    </div>
                  );
                },
              )}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </CardContent>
  </Card>
);

/** Ticks as seconds, without a trailing ".0". */
const seconds = (ticks: number) => `${Number((ticks * TD_TICK_SECONDS).toFixed(1))}`;

const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;
/** A stage's sky over its ground light, as a small landscape swatch. */
const stageGradient = (sky: number, ground: number) =>
  `linear-gradient(to bottom, ${hex(sky)} 0%, ${hex(sky)} 55%, color-mix(in srgb, ${hex(ground)} 35%, #2f5d2f) 100%)`;
