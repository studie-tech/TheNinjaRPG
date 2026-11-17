"use client";

import {
  Coins,
  Crosshair,
  FastForward,
  Flag,
  Info,
  Maximize,
  Minimize,
  ScrollText,
  Skull,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import Confirm from "@/layout/Confirm";
import type { TowerDefenseSceneView } from "@/libs/rendering/scenes/towerDefense";
import { cn } from "@/libs/shadui";
import {
  TD_GAME_SPEEDS,
  TD_HERO_BASE,
  TD_SEAL_GAP_TICKS,
  TD_TICK_SECONDS,
  TD_WAVE_TICKS,
  tdLevelDamageBonus,
  tdMaxSpeed,
  tdWaveBonus,
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
  type TdPerk,
  type TdSeal,
  type TdSentry,
  type TdShopItem,
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
import { calculatePercent } from "@/utils/math";
import { capitalizeFirstLetter } from "@/utils/string";

export type TowerDefenseInputMode = TowerDefenseSceneView["mode"];

export const SEAL_HOTKEYS: Record<TdSeal, string> = {
  tiger: "A",
  snake: "S",
  dog: "D",
  bird: "F",
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

/** Run status drawn over the top and bottom edges of the arena. */
export const TowerDefenseOverlay = (props: {
  state: TdState;
  speed: number;
  soundOn: boolean;
  mode: TowerDefenseInputMode;
  isFullscreen: boolean;
  onSpeed: (speed: number) => void;
  onSound: (enabled: boolean) => void;
  onFullscreen: () => void;
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
  const opening = state.waveTick < 0;
  const waveLeft = Math.ceil(
    ((opening ? 0 : TD_WAVE_TICKS) - state.waveTick) * TD_TICK_SECONDS,
  );
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
          <Meter
            label="Health"
            value={state.hero.hp}
            max={state.stats.maxHp}
            color="bg-red-500"
          />
          <Meter
            label="Chakra"
            value={state.hero.chakra}
            max={state.stats.maxChakra}
            color="bg-sky-500"
          />
        </div>
        <div className="pointer-events-auto flex shrink-0 gap-1">
          <BoostsButton state={state} />
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
            onAccept={() => props.act(["quit"])}
          >
            Retreating ends this run at wave {state.wave} and banks the scrolls it
            earned.
          </Confirm>
          <OverlayButton
            label={props.isFullscreen ? "Exit full screen" : "Full screen"}
            onClick={props.onFullscreen}
          >
            {props.isFullscreen ? (
              <Minimize className="h-4 w-4" />
            ) : (
              <Maximize className="h-4 w-4" />
            )}
          </OverlayButton>
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
  /** `grid` lays the controls out in fixed rows for a side column or the space under a full-screen arena. */
  layout?: "bar" | "grid";
}) => {
  const { state, act } = props;
  const tick = state.tick;
  const hero = state.hero;
  const ultimates = TD_ULTIMATES.filter((ultimate) =>
    tdUltimateUnlocked(state.config, ultimate),
  );
  const seals = TD_SEALS.map((seal) => (
    <ActionButton
      key={seal}
      title={`${seal} seal (${SEAL_HOTKEYS[seal]})`}
      onClick={() => act(["seal", seal, ...props.aim()])}
      hotkey={SEAL_HOTKEYS[seal]}
    >
      <span className="text-lg leading-none">{SEAL_GLYPHS[seal]}</span>
    </ActionButton>
  ));
  const moves = (
    <>
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
    </>
  );
  const specials = (
    <>
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
            <span className="text-xs font-semibold">
              {capitalizeFirstLetter(ultimate)}
            </span>
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
    </>
  );
  const targeting = (
    <label className="flex h-11 min-w-0 items-center gap-1 rounded-md border px-1.5 text-sm">
      <Crosshair className="h-4 w-4 shrink-0 @max-[32rem]:hidden" />
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
  );
  if (props.layout === "grid")
    return (
      <div className="@container grid gap-1">
        <div className="grid grid-cols-4 gap-1">{seals}</div>
        <div className="grid grid-cols-4 gap-1">
          {moves}
          {targeting}
        </div>
        {(ultimates.length > 0 || (state.config.dojo.ul_auto ?? 0) > 0) && (
          <div className="grid grid-cols-3 gap-1 @[360px]:grid-cols-6">{specials}</div>
        )}
      </div>
    );
  return (
    <div className="@container flex w-full flex-wrap gap-1">
      {seals}
      {moves}
      {specials}
      <div className="flex min-w-28 flex-[1.5]">{targeting}</div>
    </div>
  );
};

/**
 * Shop, sentry posts and seal-art recipes, each under its own heading. Grids follow the
 * width the panel gets, so names and effects never truncate in a narrow column.
 */
export const TowerDefensePanel = (props: {
  state: TdState;
  act: (command: TdCommand) => void;
  /** Buy as many levels as affordable per tap; owned by the page so it survives a layout switch. */
  buyMax: boolean;
  onBuyMax: (buyMax: boolean) => void;
}) => {
  const { state, act, buyMax } = props;
  const buying = (
    <div className="ml-auto flex gap-1">
      <Button
        size="sm"
        variant="outline"
        className="h-8 px-2"
        onClick={() => props.onBuyMax(!buyMax)}
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
  );
  const shop = (
    <div className="grid grid-cols-1 gap-1 @[300px]:grid-cols-2 @[620px]:grid-cols-3">
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
            <span className="min-w-0">
              <span className="block">
                {info.name} <span className="text-muted-foreground">{level}</span>
              </span>
              <span className="text-muted-foreground block text-xs leading-tight">
                {info.description}
              </span>
            </span>
            <span className="shrink-0 font-semibold text-amber-600 dark:text-amber-400">
              {maxed ? "Max" : formatTdNumber(cost)}
            </span>
          </button>
        );
      })}
    </div>
  );
  const arts = (
    <div className="grid grid-cols-1 gap-1 text-sm @[440px]:grid-cols-2">
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
          >
            <span className="shrink-0 text-base tracking-widest">
              {info.seals.map((seal) => SEAL_GLYPHS[seal]).join("")}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block">{info.name}</span>
              <span className="text-muted-foreground block text-xs leading-tight">
                {info.description}
              </span>
            </span>
            <span className="text-muted-foreground shrink-0">
              {open ? `${info.chakra} chakra` : `wave ${info.firstWave}`}
            </span>
          </div>
        );
      })}
    </div>
  );
  return (
    <div className="@container grid gap-3">
      <section className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <h3 className="font-semibold">Upgrades</h3>
          {buying}
        </div>
        {shop}
      </section>
      {state.stats.sentrySlots > 0 && (
        <section className="grid gap-1.5">
          <h3 className="font-semibold">Sentries</h3>
          <Sentries state={state} act={act} />
        </section>
      )}
      <section className="grid gap-1.5">
        <h3 className="font-semibold">Seal arts</h3>
        {arts}
      </section>
    </div>
  );
};

/** The perk draft that pauses the run after each boss. */
export const TowerDefenseDraft = ({
  state,
  act,
}: {
  state: TdState;
  act: (command: TdCommand) => boolean;
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
            <Button
              variant="outline"
              onClick={() => {
                // Take the first offer of every waiting draft; the last pick closes it.
                while (act(["perk", 0]));
              }}
            >
              Pick for me ({state.drafts})
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

const Sentries = ({
  state,
  act,
}: {
  state: TdState;
  act: (command: TdCommand) => void;
}) => (
  <div className="grid grid-cols-1 gap-1 @[440px]:grid-cols-2 @[680px]:grid-cols-3">
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

const Meter = (props: { label: string; value: number; max: number; color: string }) => (
  <div className="relative max-w-72">
    <Progress
      value={calculatePercent(props.value, props.max)}
      aria-label={props.label}
      aria-valuetext={`${formatTdNumber(props.value)} / ${formatTdNumber(props.max)}`}
      className="h-3 rounded bg-black/50"
      indicatorClassName={props.color}
    />
    <span className="absolute inset-0 text-center text-[0.75rem] leading-3 font-semibold">
      {formatTdNumber(props.value)} / {formatTdNumber(props.max)}
    </span>
  </div>
);

/** Everything currently shaping the run: timed effects, effective stats, perks and eras. */
const BoostsButton = ({ state }: { state: TdState }) => {
  const { stats, hero, tick } = state;
  const secondsUntil = (until: number) => Math.ceil((until - tick) * TD_TICK_SECONDS);
  const berserk =
    (state.perks.berserker ?? 0) > 0 ? 1.5 * (1 - hero.hp / stats.maxHp) : 0;
  const timed: [string, string, number | null][] = [];
  const during = (until: number, name: string, effect: string) => {
    if (tick < until) timed.push([name, effect, secondsUntil(until)]);
  };
  during(hero.rageUntil, "Rage", "×2 damage");
  during(hero.counterUntil, "Counter", "×1.5 damage");
  during(hero.domeUntil, "Earth Dome", "Half damage taken");
  during(state.clonesUntil, "Shadow clones", "Clones throw with you");
  during(state.tsukuyomiUntil, "Tsukuyomi", "Enemies frozen");
  during(hero.silencedUntil, "Silenced", "Jutsu cannot cast");
  if (berserk > 0.01)
    timed.push(["Berserker", `+${percent(berserk)} damage from missing health`, null]);
  // The same sums the simulation pays when the wave ends or is called early.
  const waveBonus = Math.floor(tdWaveBonus(state.wave) * stats.ryoMult);
  const earlyShare =
    state.waveTick < 0 ? 0 : (TD_WAVE_TICKS - state.waveTick) / TD_WAVE_TICKS;
  const interest =
    stats.interest > 0
      ? Math.floor(Math.min(60 * tdWaveBonus(state.wave), state.ryo * stats.interest))
      : 0;
  const ryoBonuses: [string, string][] = [
    ["Clearing this wave", `${formatTdNumber(waveBonus)} ryo`],
    [
      "Calling the next wave now",
      tdCanCallWave(state) && earlyShare > 0
        ? `+${formatTdNumber(Math.floor(tdWaveBonus(state.wave) * earlyShare * stats.ryoMult))} ryo extra`
        : "once the wave is cleared",
    ],
    ...(interest > 0
      ? ([["Interest on your ryo", `${formatTdNumber(interest)} ryo`]] as [
          string,
          string,
        ][])
      : []),
  ];
  const levelBonus = tdLevelDamageBonus(state.config.level);
  const rows: [string, string, string | null][] = [
    [
      "Character level",
      `${state.config.level}`,
      levelBonus > 0 ? `+${percent(levelBonus)} damage` : null,
    ],
    [
      "Damage",
      formatTdNumber(stats.damage),
      boostOf(stats.damage / TD_HERO_BASE.damage),
    ],
    [
      "Throws per second",
      stats.rate.toFixed(2),
      boostOf(stats.rate / TD_HERO_BASE.rate),
    ],
    ["Range", stats.range.toFixed(1), boostOf(stats.range / TD_HERO_BASE.range)],
    ["Critical hits", `${percent(stats.crit)} for ×${stats.critMult.toFixed(2)}`, null],
    [
      "Max health",
      formatTdNumber(stats.maxHp),
      boostOf(stats.maxHp / TD_HERO_BASE.health),
    ],
    [
      "Regeneration",
      `${percent(stats.regen, 2)} health/s`,
      boostOf(stats.regen / TD_HERO_BASE.regen),
    ],
    [
      "Max chakra",
      formatTdNumber(stats.maxChakra),
      boostOf(stats.maxChakra / TD_HERO_BASE.chakra),
    ],
    [
      "Chakra per second",
      stats.chakraRegen.toFixed(1),
      boostOf(stats.chakraRegen / TD_HERO_BASE.chakraRegen),
    ],
    ["Blink cooldown", `${(stats.blinkTicks * TD_TICK_SECONDS).toFixed(1)}s`, null],
    ["Substitution window", `${(stats.subWindow * TD_TICK_SECONDS).toFixed(1)}s`, null],
    [
      "Explosive tags",
      `${stats.trapCharges} charges`,
      boostOf(stats.trapMult, "power"),
    ],
    ["Ryo earned", `×${stats.ryoMult.toFixed(2)}`, boostOf(stats.ryoMult)],
    ["Scrolls earned", `×${stats.scrollMult.toFixed(2)}`, boostOf(stats.scrollMult)],
  ];
  const optional: [string, number, string][] = [
    ["Extra targets", stats.multishot, `${stats.multishot}`],
    ["Ricochets", stats.ricochet, `${stats.ricochet}`],
    ["Block", stats.block, percent(stats.block)],
    ["Lifesteal", stats.lifesteal, percent(stats.lifesteal, 2)],
    ["Thorns", stats.thorns, percent(stats.thorns, 1)],
    ["Interest per wave", stats.interest, percent(stats.interest, 1)],
    ["Jutsu power", stats.jutsuMult - 1, `×${stats.jutsuMult.toFixed(2)}`],
    ["Jutsu cooldowns", 1 - stats.jutsuCdMult, `−${percent(1 - stats.jutsuCdMult)}`],
    ["Seal power", stats.sealMult - 1, `×${stats.sealMult.toFixed(2)}`],
    ["Sentry power", stats.sentryMult - 1, `×${stats.sentryMult.toFixed(2)}`],
    ["Enemy health", stats.enemyHpMult - 1, `×${stats.enemyHpMult.toFixed(2)}`],
  ];
  for (const [label, amount, value] of optional)
    if (amount > 1e-6) rows.push([label, value, null]);
  const perks = (Object.entries(state.perks) as [TdPerk, number][]).filter(
    ([, count]) => count > 0,
  );
  const eras = state.eras.filter((era) => era !== "calm");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Active boosts"
          title="Active boosts"
          className={OVERLAY_BUTTON_CLASS}
        >
          <Info className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[70vh] w-80 space-y-3 overflow-y-auto p-3 text-sm"
      >
        <BoostSection title="Right now">
          {timed.length === 0 ? (
            <p className="text-muted-foreground">No timed effects.</p>
          ) : (
            timed.map(([name, effect, seconds]) => (
              <BoostRow
                key={name}
                label={name}
                value={seconds === null ? effect : `${effect} · ${seconds}s`}
              />
            ))
          )}
        </BoostSection>
        <BoostSection title="Ryo bonuses">
          {ryoBonuses.map(([label, value]) => (
            <BoostRow key={label} label={label} value={value} />
          ))}
          <p className="text-muted-foreground text-xs">
            Every kill also pays its bounty, ×{stats.ryoMult.toFixed(2)} with your Guard
            Hall and perks.
          </p>
        </BoostSection>
        <BoostSection title="Your ninja">
          {rows.map(([label, value, boost]) => (
            <BoostRow key={label} label={label} value={value} boost={boost} />
          ))}
        </BoostSection>
        {perks.length > 0 && (
          <BoostSection title="Perks">
            {perks.map(([id, count]) => (
              <div key={id}>
                <p className="font-semibold">
                  {TD_PERK_INFO[id].name}
                  {count > 1 && ` ×${count}`}
                </p>
                <p className="text-muted-foreground">{TD_PERK_INFO[id].description}</p>
              </div>
            ))}
          </BoostSection>
        )}
        {eras.length > 0 && (
          <BoostSection title="Era rules">
            {eras.map((era) => (
              <div key={era}>
                <p className="font-semibold text-red-600 dark:text-red-400">
                  {TD_ERA_INFO[era].name}
                </p>
                <p className="text-muted-foreground">{TD_ERA_INFO[era].description}</p>
              </div>
            ))}
          </BoostSection>
        )}
      </PopoverContent>
    </Popover>
  );
};

const BoostSection = (props: { title: string; children: ReactNode }) => (
  <div className="space-y-1">
    <p className="text-muted-foreground text-xs font-semibold uppercase">
      {props.title}
    </p>
    {props.children}
  </div>
);

const BoostRow = (props: { label: string; value: string; boost?: string | null }) => (
  <div className="flex items-baseline justify-between gap-2">
    <span>{props.label}</span>
    <span className="text-right font-semibold">
      {props.value}
      {props.boost && (
        <span className="ml-1 text-xs text-green-600 dark:text-green-400">
          {props.boost}
        </span>
      )}
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
        style={{
          height: `${calculatePercent(props.remaining ?? 0, props.total ?? 1)}%`,
        }}
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

const percent = (fraction: number, digits = 0) =>
  `${(fraction * 100).toFixed(digits)}%`;

/** "+42%" for a multiplier above the base, or nothing when it has not grown. */
const boostOf = (multiplier: number, suffix?: string) =>
  multiplier > 1.0005
    ? `+${formatTdNumber(Math.round((multiplier - 1) * 100))}%${suffix ? ` ${suffix}` : ""}`
    : null;
