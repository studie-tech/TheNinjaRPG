"use client";

import {
  Coins,
  Crosshair,
  Crown,
  Footprints,
  Keyboard,
  Lock,
  Map as MapIcon,
  Play,
  RotateCcw,
  ScrollText,
  Sparkles,
  Swords,
  Trash2,
  Wind,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Confirm from "@/layout/Confirm";
import Link from "@/layout/Link";
import { SEAL_GLYPHS, SEAL_HOTKEYS } from "@/layout/TowerDefenseHud";
import { cn } from "@/libs/shadui";
import {
  TD_BOSS_INTERVAL,
  TD_CHECKPOINT_SHARE,
  TD_DOJO,
  TD_DOJO_CATEGORIES,
  TD_DOJO_INFO,
  TD_ERA_INTERVAL,
  TD_ERA_START_WAVE,
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
  tdCheckpoints,
  tdStageForWave,
} from "@/libs/towerDefense/content";
import { formatTdNumber } from "@/libs/towerDefense/format";
import { tdDojoCost } from "@/libs/towerDefense/sim";
import { capitalizeFirstLetter } from "@/utils/string";

const CATEGORY_LABELS: Record<TdDojoCategory, string> = {
  offense: "Offense",
  defense: "Defense",
  economy: "Economy",
  jutsu: "Jutsu & Sentries",
  arts: "Ninja Arts",
  ultimate: "Ultimates",
};

/** Start or resume a run, spend scrolls in the Dojo and learn how the game works. */
export const TowerDefenseLobby = (props: {
  isGuest: boolean;
  progress: { points: number; bestWave: number; dojo: TdDojoLevels } | undefined;
  saved: { wave: number; over: boolean } | null;
  isStarting: boolean;
  isResuming: boolean;
  isPurchasing: boolean;
  /** `replaceSaved` confirms that the saved run may be discarded. */
  onStart: (startWave: number, replaceSaved: boolean) => void;
  onResume: () => void;
  onDiscard: () => void;
  onBuy: (upgradeId: TdDojoUpgrade) => void;
}) => {
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
      disabled={props.isStarting || props.isResuming}
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
        <div className="rounded-lg border border-blue-500/50 bg-blue-500/10 p-3 text-sm">
          Playing as a guest: runs are not saved and earn no scrolls.{" "}
          <Link className="font-semibold underline" href="/login">
            Log in
          </Link>{" "}
          to train in the Dojo and climb the leaderboard.
        </div>
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
                <Button size="sm" disabled={props.isResuming} onClick={props.onResume}>
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
                    <Button size="sm" variant="outline" disabled={props.isResuming}>
                      <Trash2 className="mr-1 h-4 w-4" /> Discard
                    </Button>
                  }
                  disabled={props.isResuming}
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
              <div className="grid grid-cols-2 gap-2">
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
                  Checkpoints follow each boss, up to{" "}
                  {Math.round(TD_CHECKPOINT_SHARE * 100)}% of your best wave. Scrolls
                  come only from waves you clear.
                </p>
              </div>
            )}
            {props.saved ? (
              <Confirm
                title="Start a new run?"
                button={startButton}
                disabled={props.isStarting || props.isResuming}
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
      <HowToPlay bestWave={bestWave} />
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

/** The road from Dawn to the Infinite Dream, with the player's best wave marked. */
const Journey = ({ bestWave }: { bestWave: number }) => {
  const current = tdStageForWave(Math.max(1, bestWave));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <MapIcon className="h-5 w-5" /> The road to wave {TD_STAGES.at(-1)?.wave}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-4 gap-1.5">
          {TD_STAGES.map((stage) => {
            const reached = bestWave >= stage.wave;
            const here = stage === current;
            return (
              <div
                key={stage.name}
                className={cn(
                  "relative flex aspect-[4/3] flex-col justify-end overflow-hidden rounded-lg border-2 p-1 text-white",
                  here ? "border-amber-400" : "border-transparent",
                  !reached && "opacity-45 grayscale",
                )}
                style={{ background: stageGradient(stage.sky, stage.ground) }}
                title={`${stage.name}: from wave ${stage.wave}`}
              >
                {!reached && (
                  <Lock className="absolute top-1 right-1 h-3.5 w-3.5 opacity-80" />
                )}
                <span className="text-[0.8rem] leading-tight font-bold drop-shadow">
                  {stage.name}
                </span>
                <span className="text-[0.75rem] leading-tight opacity-90 drop-shadow">
                  {stage.wave}+
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-muted-foreground">
          The sky darkens and the battlefield grows wilder with every stage: new enemy
          families, elite affixes, era rules stacking two and three at a time, and a
          titan every {TD_TITAN_INTERVAL} waves. Each run pushes a little further as the
          Dojo makes you stronger.
        </p>
      </CardContent>
    </Card>
  );
};

/** Illustrated rules, hand-seal recipes and controls. */
const HowToPlay = ({ bestWave }: { bestWave: number }) => (
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
          Every cleared wave earns scrolls. Train in the Dojo between runs to go
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
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-1 font-semibold">
          <Keyboard className="h-4 w-4" /> Keys
        </span>
        <KeyHint keys={TD_SEALS.map((seal) => SEAL_HOTKEYS[seal])} label="seals" />
        <KeyHint keys={["Space"]} label="substitution" />
        <KeyHint keys={["B"]} label="blink" />
        <KeyHint keys={["T"]} label="tag" />
        <KeyHint keys={["1", "–", `${TD_ULTIMATES.length}`]} label="ultimates" />
        <KeyHint keys={["N"]} label="next wave" />
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

const KeyHint = ({ keys, label }: { keys: string[]; label: string }) => (
  <span className="flex items-center gap-1">
    {keys.map((key) =>
      key === "–" ? (
        <span key={key}>–</span>
      ) : (
        <kbd key={key} className="bg-secondary rounded border px-1.5 py-0.5 font-mono">
          {key}
        </kbd>
      ),
    )}
    <span className="text-muted-foreground">{label}</span>
  </span>
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

const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;
/** A stage's sky over its ground light, as a small landscape swatch. */
const stageGradient = (sky: number, ground: number) =>
  `linear-gradient(to bottom, ${hex(sky)} 0%, ${hex(sky)} 55%, color-mix(in srgb, ${hex(ground)} 35%, #2f5d2f) 100%)`;

const Dojo = (props: {
  progress: { points: number; bestWave: number; dojo: TdDojoLevels };
  isPurchasing: boolean;
  onBuy: (upgradeId: TdDojoUpgrade) => void;
}) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center justify-between gap-2 text-lg">
        <span className="flex items-center gap-2">
          <ScrollText className="h-5 w-5" /> Dojo
        </span>
        <Badge variant="secondary" className="text-sm">
          {formatTdNumber(props.progress.points)} scrolls
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
