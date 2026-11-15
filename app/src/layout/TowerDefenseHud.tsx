"use client";

import {
  Coins,
  Crosshair,
  FastForward,
  Flag,
  ScrollText,
  Skull,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Confirm from "@/layout/Confirm";
import { cn } from "@/libs/shadui";
import {
  TD_GAME_SPEEDS,
  TD_HERO_BASE,
  TD_SEAL_GAP_TICKS,
  TD_TICK_SECONDS,
  TD_WAVE_TICKS,
  tdMaxSpeed,
} from "@/libs/towerDefense/balance";
import {
  TD_ERA_INFO,
  TD_ERA_INTERVAL,
  TD_JUTSU_INFO,
  TD_PERK_INFO,
  TD_SEAL_ART_INFO,
  TD_SEAL_ARTS,
  TD_SEALS,
  TD_SENTRIES,
  TD_SENTRY_INFO,
  TD_SHOP,
  TD_SHOP_INFO,
  TD_ULTIMATE_INFO,
  TD_ULTIMATES,
  type TdSeal,
  type TdSentry,
  type TdShopItem,
  type TdUltimate,
  tdStageForWave,
} from "@/libs/towerDefense/content";
import { formatTdNumber } from "@/libs/towerDefense/format";
import {
  TD_TARGET_MODES,
  type TdCommand,
  type TdState,
  type TdTargetMode,
  tdCanCallWave,
  tdErasForWave,
  tdJutsuUnlocked,
  tdSealArtUnlocked,
  tdSentryCost,
  tdShopCost,
  tdUltimateCooldown,
  tdUltimateCooldownTicks,
  tdUltimateUnlocked,
} from "@/libs/towerDefense/sim";

export type TowerDefenseInputMode = "aim" | "blink" | "trap";

export const SEAL_KEYS: Record<string, TdSeal> = {
  a: "tiger",
  s: "snake",
  d: "dog",
  f: "bird",
};
export const SEAL_GLYPHS: Record<TdSeal, string> = {
  tiger: "寅",
  snake: "巳",
  dog: "戌",
  bird: "酉",
};
const TARGET_LABELS: Record<TdTargetMode, string> = {
  near: "Nearest",
  strong: "Strongest",
  weak: "Weakest",
  fast: "Fastest",
  support: "Support",
};
const ULTIMATE_SHORT: Record<TdUltimate, string> = {
  clones: "Clones",
  tempest: "Tempest",
  amaterasu: "Amaterasu",
  tsukuyomi: "Tsukuyomi",
  cataclysm: "Cataclysm",
};

/** Run status drawn over the top and bottom edges of the arena. */
export const TowerDefenseOverlay = (props: {
  state: TdState;
  speed: number;
  soundOn: boolean;
  mode: TowerDefenseInputMode;
  onSpeed: (speed: number) => void;
  onSound: (enabled: boolean) => void;
  onQuit: () => void;
  act: (command: TdCommand) => void;
}) => {
  const { state } = props;
  const stage = tdStageForWave(state.wave);
  const speeds: number[] = TD_GAME_SPEEDS.filter(
    (speed) => speed <= tdMaxSpeed(state.config.dojo.speed ?? 0),
  );
  const nextSpeed = speeds[(speeds.indexOf(props.speed) + 1) % speeds.length] ?? 1;
  const nextBlock =
    (Math.floor((state.wave - 1) / TD_ERA_INTERVAL) + 1) * TD_ERA_INTERVAL + 1;
  const nextEras = tdErasForWave(state.config.seed, nextBlock).filter(
    (era) => era !== "calm",
  );
  const waveLeft = Math.max(
    0,
    Math.ceil((TD_WAVE_TICKS - state.waveTick) * TD_TICK_SECONDS),
  );
  const opening = state.waveTick < 0;
  const canCall = tdCanCallWave(state);
  const sealCount =
    state.tick - state.hero.lastSealAt <= TD_SEAL_GAP_TICKS
      ? state.hero.seals.length
      : 0;
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[5] flex items-start gap-2 bg-gradient-to-b from-black/70 to-transparent p-1.5 pb-6 text-white">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <span className="rounded bg-black/50 px-1.5 font-bold">
              Wave {state.wave}
            </span>
            <span className="opacity-80">{stage.name}</span>
            {state.eras
              .filter((era) => era !== "calm")
              .map((era) => (
                <span
                  key={era}
                  title={TD_ERA_INFO[era].description}
                  className="pointer-events-auto rounded bg-red-600/80 px-1.5"
                >
                  {TD_ERA_INFO[era].name}
                </span>
              ))}
          </div>
          <Meter value={state.hero.hp} max={state.stats.maxHp} color="bg-red-500" />
          <Meter
            value={state.hero.chakra}
            max={state.stats.maxChakra}
            color="bg-sky-500"
          />
        </div>
        <div className="pointer-events-auto flex shrink-0 gap-1">
          <OverlayButton
            label={`Game speed ${props.speed}x`}
            onClick={() => props.onSpeed(nextSpeed)}
            disabled={speeds.length < 2}
          >
            <FastForward className="h-4 w-4" />
            <span className="text-xs">{props.speed}x</span>
          </OverlayButton>
          <OverlayButton
            label={props.soundOn ? "Mute combat sounds" : "Unmute combat sounds"}
            onClick={() => props.onSound(!props.soundOn)}
          >
            {props.soundOn ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </OverlayButton>
          <Confirm
            title="Retreat?"
            button={
              <button
                type="button"
                title="Retreat and bank your scrolls"
                className={OVERLAY_BUTTON_CLASS}
              >
                <Flag className="h-4 w-4" />
              </button>
            }
            triggerLabel="Retreat and bank your scrolls"
            tone="destructive"
            proceed_label="Retreat"
            onAccept={props.onQuit}
          >
            Retreating ends this run at wave {state.wave} and banks the scrolls it
            earned.
          </Confirm>
        </div>
      </div>
      {sealCount > 0 && props.mode === "aim" && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-[5] text-center">
          <span
            className="inline-flex items-center gap-1 rounded bg-black/70 px-2 py-0.5 text-lg leading-tight text-white"
            title="Seals formed so far"
          >
            {[0, 1, 2].map((index) => (
              <span key={index} className={cn(index < sealCount ? "" : "opacity-30")}>
                {index < sealCount
                  ? SEAL_GLYPHS[state.hero.seals[index] ?? "tiger"]
                  : "·"}
              </span>
            ))}
          </span>
        </div>
      )}
      {props.mode !== "aim" && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-[5] text-center">
          <span className="rounded bg-black/70 px-2 py-0.5 text-sm text-white">
            {props.mode === "blink" ? "Tap where to blink" : "Tap where to place a tag"}{" "}
            · Esc to cancel
          </span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] flex items-end gap-2 bg-gradient-to-t from-black/70 to-transparent p-1.5 pt-6 text-sm text-white">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="flex items-center gap-1 font-semibold">
            <Coins className="h-4 w-4 text-amber-400" />
            {formatTdNumber(state.ryo)}
          </span>
          <span className="flex items-center gap-1 font-semibold">
            <ScrollText className="h-4 w-4 text-purple-300" />
            {formatTdNumber(state.scrolls)}
          </span>
          <span className="flex items-center gap-1">
            <Skull className="h-4 w-4" />
            {formatTdNumber(state.kills)}
          </span>
          {nextEras.length > 0 && nextBlock > state.wave && (
            <span className="opacity-75">
              Wave {nextBlock}:{" "}
              {nextEras.map((era) => TD_ERA_INFO[era].name).join(" + ")}
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={!canCall}
          onClick={() => props.act(["call"])}
          title={
            opening
              ? "Skip the preparation and start the first wave"
              : "Call the next wave early for bonus ryo (N)"
          }
          className="pointer-events-auto flex shrink-0 items-center gap-1 rounded-md bg-amber-500 px-2 py-1 font-semibold text-black disabled:bg-black/50 disabled:text-white/80"
        >
          <Zap className="h-4 w-4" />
          {canCall
            ? opening
              ? "Start now"
              : "Next wave"
            : `${opening ? "Starts" : "Next"} in ${waveLeft}s`}
        </button>
      </div>
    </>
  );
};

/** Hand seals, defensive moves and ultimates in one row beneath the arena. */
export const TowerDefenseActionBar = (props: {
  state: TdState;
  mode: TowerDefenseInputMode;
  onMode: (mode: TowerDefenseInputMode) => void;
  act: (command: TdCommand) => void;
  aim: () => [number, number];
}) => {
  const { state, act } = props;
  const tick = state.tick;
  const hero = state.hero;
  const ultimates = TD_ULTIMATES.filter((ultimate) =>
    tdUltimateUnlocked(state.config, ultimate),
  );
  return (
    <div className="flex w-full flex-wrap gap-1">
      {TD_SEALS.map((seal, index) => (
        <ActionButton
          key={seal}
          title={`${seal} seal (${"ASDF"[index]})`}
          onClick={() => act(["seal", seal, ...props.aim()])}
          hotkey={"ASDF"[index]}
        >
          <span className="text-lg leading-none">{SEAL_GLYPHS[seal]}</span>
        </ActionButton>
      ))}
      <ActionButton
        title="Substitution: dodge the next hit; time it on a boss attack to counter (Space)"
        onClick={() => act(["sub"])}
        hotkey="Space"
        remaining={hero.subReadyAt - tick}
        total={TD_HERO_BASE.substitutionTicks}
        wide
      >
        <span className="text-xs font-semibold">Sub</span>
      </ActionButton>
      <ActionButton
        title="Blink: tap a spot near the centre to teleport (B)"
        onClick={() => props.onMode(props.mode === "blink" ? "aim" : "blink")}
        hotkey="B"
        active={props.mode === "blink"}
        remaining={hero.blinkReadyAt - tick}
        total={state.stats.blinkTicks}
        wide
      >
        <span className="text-xs font-semibold">Blink</span>
      </ActionButton>
      <ActionButton
        title="Explosive tag: tap where to place it (T)"
        onClick={() => props.onMode(props.mode === "trap" ? "aim" : "trap")}
        hotkey="T"
        active={props.mode === "trap"}
        disabled={hero.trapCharges <= 0}
        wide
      >
        <span className="text-xs font-semibold">Tag ×{hero.trapCharges}</span>
      </ActionButton>
      {ultimates.map((ultimate) => {
        const info = TD_ULTIMATE_INFO[ultimate];
        const remaining = tdUltimateCooldown(state, ultimate);
        return (
          <ActionButton
            key={ultimate}
            title={`${info.name}: ${info.description}${info.aimed ? " Lands on the reticle." : ""}`}
            onClick={() => act(["ult", ultimate, ...props.aim()])}
            hotkey={`${TD_ULTIMATES.indexOf(ultimate) + 1}`}
            remaining={remaining}
            total={tdUltimateCooldownTicks(state, ultimate)}
            highlight={remaining <= 0}
            wide
          >
            <span className="text-xs font-semibold">{ULTIMATE_SHORT[ultimate]}</span>
          </ActionButton>
        );
      })}
      {(state.config.dojo.ul_auto ?? 0) > 0 && (
        <ActionButton
          title="Let ultimates cast themselves when ready"
          onClick={() => act(["auto", state.autoUlt ? 0 : 1])}
          active={state.autoUlt}
          wide
        >
          <span className="text-xs font-semibold">
            Auto {state.autoUlt ? "on" : "off"}
          </span>
        </ActionButton>
      )}
      <label className="flex h-11 min-w-28 flex-1 items-center gap-1 rounded-md border px-1.5 text-sm">
        <Crosshair className="h-4 w-4 shrink-0" />
        <select
          className="bg-background h-full min-w-0 flex-1 text-sm outline-none"
          value={state.aim}
          onChange={(event) => act(["aim", event.target.value as TdTargetMode])}
          aria-label="Shuriken targeting"
        >
          {TD_TARGET_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {TARGET_LABELS[mode]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
};

/** Shop, sentry posts and seal-art recipes, one tab at a time. */
export const TowerDefensePanel = (props: {
  state: TdState;
  act: (command: TdCommand) => void;
}) => {
  const { state, act } = props;
  const [buyMax, setBuyMax] = useState(false);
  return (
    <Tabs defaultValue="shop" className="rounded-lg border p-1">
      <div className="flex flex-wrap items-center gap-1">
        <TabsList className="h-8 w-auto">
          <TabsTrigger value="shop" className="px-2 text-sm">
            Upgrades
          </TabsTrigger>
          {state.stats.sentrySlots > 0 && (
            <TabsTrigger value="sentries" className="px-2 text-sm">
              Sentries
            </TabsTrigger>
          )}
          <TabsTrigger value="arts" className="px-2 text-sm">
            Seal arts
          </TabsTrigger>
        </TabsList>
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2"
            onClick={() => setBuyMax((value) => !value)}
            title="Buy one level per tap, or as many as you can afford"
          >
            Buy {buyMax ? "max" : "×1"}
          </Button>
          <Button
            size="sm"
            className="h-8 px-2"
            disabled={state.ryo <= 0}
            onClick={() => act(["spend"])}
            title="Spread all ryo over your upgrades"
          >
            <Coins className="mr-1 h-4 w-4" /> Spend all
          </Button>
        </div>
      </div>
      <TabsContent value="shop" className="mt-1">
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {TD_SHOP.filter((item) => {
            const jutsu = TD_SHOP_INFO[item].jutsu;
            return !jutsu || tdJutsuUnlocked(state.config, jutsu);
          }).map((item: TdShopItem) => {
            const info = TD_SHOP_INFO[item];
            const level = state.shop[item] ?? 0;
            const cost = tdShopCost(state, item);
            const maxed = level >= info.max;
            return (
              <button
                type="button"
                key={item}
                disabled={maxed || state.ryo < cost}
                onClick={(event) =>
                  act(buyMax || event.shiftKey ? ["max", item] : ["buy", item])
                }
                title={`${info.description}${info.jutsu ? `. ${TD_JUTSU_INFO[info.jutsu].description}` : ""}`}
                className="hover:bg-muted flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-left text-sm disabled:opacity-50"
              >
                <span className="min-w-0 truncate">
                  {info.name} <span className="text-muted-foreground">{level}</span>
                </span>
                <span className="shrink-0 font-semibold text-amber-600 dark:text-amber-400">
                  {maxed ? "Max" : formatTdNumber(cost)}
                </span>
              </button>
            );
          })}
        </div>
      </TabsContent>
      <TabsContent value="sentries" className="mt-1">
        <Sentries state={state} act={act} />
      </TabsContent>
      <TabsContent value="arts" className="mt-1">
        <div className="grid gap-1 text-sm sm:grid-cols-2">
          {TD_SEAL_ARTS.map((art) => {
            const info = TD_SEAL_ART_INFO[art];
            const open = tdSealArtUnlocked(state.config, art);
            return (
              <div
                key={art}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2 py-1",
                  !open && "opacity-40",
                  open && state.hero.chakra >= info.chakra && "border-sky-500",
                )}
                title={info.description}
              >
                <span className="text-base tracking-widest">
                  {info.seals.map((seal) => SEAL_GLYPHS[seal]).join("")}
                </span>
                <span className="min-w-0 flex-1 truncate">{info.name}</span>
                <span className="text-muted-foreground shrink-0">
                  {open ? `${info.chakra} chakra` : `wave ${info.firstWave}`}
                </span>
              </div>
            );
          })}
        </div>
      </TabsContent>
    </Tabs>
  );
};

const Sentries = ({
  state,
  act,
}: {
  state: TdState;
  act: (command: TdCommand) => void;
}) => (
  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: state.stats.sentrySlots }, (_, slot) => {
      const sentry = state.sentries[slot];
      if (!sentry)
        return (
          <div
            key={slot}
            className="flex flex-wrap items-center gap-1 rounded-md border p-1 text-sm"
          >
            <span className="text-muted-foreground w-12 shrink-0">Post {slot + 1}</span>
            {TD_SENTRIES.map((type: TdSentry) => {
              const cost = tdSentryCost(type);
              return (
                <Button
                  key={type}
                  size="sm"
                  variant="secondary"
                  className="h-7 px-1.5"
                  disabled={state.ryo < cost}
                  title={`${TD_SENTRY_INFO[type].name}: ${TD_SENTRY_INFO[type].description} ${formatTdNumber(cost)} ryo`}
                  onClick={() => act(["build", slot, type])}
                >
                  {TD_SENTRY_INFO[type].name.split(" ")[0]}
                </Button>
              );
            })}
          </div>
        );
      const cost = tdSentryCost(sentry.type, sentry.level + 1);
      return (
        <div
          key={slot}
          className="flex items-center gap-1 rounded-md border p-1 text-sm"
        >
          <span className="min-w-0 flex-1 truncate">
            {TD_SENTRY_INFO[sentry.type].name}{" "}
            <span className="text-muted-foreground">Lv {sentry.level}</span>
          </span>
          <Button
            size="sm"
            className="h-7 px-2"
            disabled={state.ryo < cost}
            onClick={() => act(["upgrade", slot])}
          >
            ↑ {formatTdNumber(cost)}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2"
            onClick={() => act(["sell", slot])}
          >
            Sell
          </Button>
        </div>
      );
    })}
  </div>
);

/** The perk draft that pauses the run after each boss. */
export const TowerDefenseDraft = ({
  state,
  act,
  onAutoPick,
}: {
  state: TdState;
  act: (command: TdCommand) => void;
  /** Take the first offer of every waiting draft. */
  onAutoPick: () => void;
}) => {
  if (!state.offer) return null;
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 p-2">
      <div className="bg-background max-h-full w-full max-w-3xl space-y-3 overflow-y-auto rounded-xl border p-4 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-bold">Choose a perk</h3>
          {state.drafts > 1 && <Badge>{state.drafts} drafts waiting</Badge>}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {state.offer.map((perk, index) => {
            const info = TD_PERK_INFO[perk];
            return (
              <button
                type="button"
                key={perk}
                onClick={() => act(["perk", index])}
                className={cn(
                  "rounded-lg border-2 p-3 text-left transition hover:scale-[1.02] hover:shadow-lg",
                  info.kind === "evolution" && "border-amber-400 bg-amber-400/10",
                  info.kind === "tradeoff" && "border-rose-400 bg-rose-400/10",
                  info.kind === "mechanic" && "border-sky-400 bg-sky-400/10",
                )}
              >
                <p className="font-bold">{info.name}</p>
                <p className="text-sm">{info.description}</p>
                <p className="text-muted-foreground mt-1 text-sm capitalize">
                  {info.kind}
                  {(state.perks[perk] ?? 0) > 0 ? ` · owned ×${state.perks[perk]}` : ""}
                </p>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          {state.rerolls > 0 && (
            <Button variant="outline" onClick={() => act(["reroll"])}>
              Reroll ({state.rerolls} left)
            </Button>
          )}
          {state.drafts > 1 && (
            <Button variant="outline" onClick={onAutoPick}>
              Pick for me ({state.drafts})
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

const Meter = (props: { value: number; max: number; color: string }) => (
  <div className="relative h-3 max-w-72 overflow-hidden rounded bg-black/50">
    <div
      className={cn("h-full transition-[width] duration-150", props.color)}
      style={{
        width: `${Math.max(0, Math.min(100, (props.value / Math.max(1, props.max)) * 100))}%`,
      }}
    />
    <span className="absolute inset-0 text-center text-[0.75rem] leading-3 font-semibold">
      {formatTdNumber(props.value)} / {formatTdNumber(props.max)}
    </span>
  </div>
);

const OVERLAY_BUTTON_CLASS =
  "flex h-8 min-w-8 items-center justify-center gap-0.5 rounded-md bg-black/50 px-1.5 text-white hover:bg-black/70 disabled:opacity-50";

const OverlayButton = (props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) => (
  <button
    type="button"
    aria-label={props.label}
    title={props.label}
    disabled={props.disabled}
    onClick={props.onClick}
    className={OVERLAY_BUTTON_CLASS}
  >
    {props.children}
  </button>
);

/** A square action with an optional cooldown fill and hotkey hint. */
const ActionButton = (props: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  hotkey?: string;
  remaining?: number;
  total?: number;
  active?: boolean;
  highlight?: boolean;
  disabled?: boolean;
  wide?: boolean;
}) => {
  const cooling = (props.remaining ?? 0) > 0;
  const fraction = cooling
    ? Math.min(1, (props.remaining ?? 0) / Math.max(1, props.total ?? 1))
    : 0;
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.title}
      disabled={props.disabled || (cooling && !props.active)}
      onClick={props.onClick}
      className={cn(
        "relative flex h-11 flex-1 flex-col items-center justify-center overflow-hidden rounded-md border px-1 transition-colors disabled:opacity-60",
        props.wide ? "min-w-14" : "min-w-10",
        props.active
          ? "bg-primary text-primary-foreground"
          : props.highlight
            ? "border-amber-500 bg-amber-500/15"
            : "bg-secondary hover:bg-secondary/80",
      )}
    >
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 bg-black/30"
        style={{ height: `${fraction * 100}%` }}
      />
      <span className="relative">{props.children}</span>
      {cooling ? (
        <span className="relative text-[0.7rem] leading-none">
          {Math.ceil((props.remaining ?? 0) * TD_TICK_SECONDS)}s
        </span>
      ) : (
        props.hotkey && (
          <span className="relative text-[0.7rem] leading-none opacity-60">
            {props.hotkey}
          </span>
        )
      )}
    </button>
  );
};
