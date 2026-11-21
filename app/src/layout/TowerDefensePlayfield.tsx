"use client";

import {
  type ComponentProps,
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { PortalContainerContext } from "@/components/ui/portal-container";
import { useFullscreenStage } from "@/hooks/useFullscreenStage";
import type {
  TowerDefenseOutcome,
  useTowerDefenseSession,
} from "@/hooks/useTowerDefenseSession";
import Loader from "@/layout/Loader";
import type { TowerDefenseArena } from "@/layout/TowerDefense";
import {
  SEAL_HOTKEYS,
  TowerDefenseActionBar,
  TowerDefenseDraft,
  type TowerDefenseInputMode,
  TowerDefenseOverlay,
  TowerDefensePanel,
} from "@/layout/TowerDefenseHud";
import type { TowerDefenseSceneView } from "@/libs/rendering/scenes/towerDefense";
import { cn } from "@/libs/shadui";
import { TD_COORD_SCALE } from "@/libs/towerDefense/balance";
import { TD_SEALS, TD_ULTIMATES } from "@/libs/towerDefense/content";
import { formatTdNumber } from "@/libs/towerDefense/format";
import { tdCrowdTarget } from "@/libs/towerDefense/sim";

type ArenaProps = ComponentProps<typeof TowerDefenseArena>;

/**
 * A tower defense run on screen: the arena with its overlay and draft, the action bar and
 * the shop, keyboard and tap controls, and the results once the run ends. Wide screens put
 * the controls beside a full-height arena and tall ones below it; on the page that layout
 * applies in full screen, and a standalone build always uses it.
 */
export const TowerDefensePlayfield = (props: {
  run: ReturnType<typeof useTowerDefenseSession>;
  /** The arena, loaded however the host loads its renderer. */
  Arena: ComponentType<ArenaProps>;
  appearance: ArenaProps["appearance"];
  /** Enemy artwork, undefined while it loads. */
  roster: ArenaProps["roster"] | undefined;
  hitAsset?: ArenaProps["hitAsset"];
  smokeAsset?: ArenaProps["smokeAsset"];
  sfxOn: boolean;
  /** Absent where the host owns sound, as YouTube does with its own mute. */
  onSound?: (enabled: boolean) => void;
  /** The host owns the frame, so the run offers no full-screen button of its own. */
  hostControlsFrame?: boolean;
  playSound: ArenaProps["playSound"];
  /** A guest's runs are never claimed, so results show no scrolls or retries. */
  isGuest: boolean;
  /** The run fills its container as a stage, as a standalone build shows it. */
  standalone?: boolean;
  /** A confirmation the host shows before leaving; rendered inside the stage. */
  guardDialog?: ReactNode;
  /** Leave the run, after any confirmation the host needs. */
  confirmLeave?: (leave: () => void) => void;
  /** Shown under a guest's results, such as an invitation to sign in. */
  guestNote?: ReactNode;
  /** Extra content at the bottom of the results, such as a link to the full game. */
  resultsFooter?: ReactNode;
  /** The results' next step, shown as the primary button beside the leave button. */
  resultsAction?: ReactNode;
  /** The host paused the game: the arena is taken down so nothing renders until it resumes. */
  suspended?: boolean;
}) => {
  const { run } = props;
  const [mode, setMode] = useState<TowerDefenseInputMode>("aim");
  const [buyMax, setBuyMax] = useState(false);
  const reticle = useRef<{ x: number; y: number } | null>(null);

  // Handlers depend on the run's stable members, never on the object returned per render.
  const { act, getSession, setPaused } = run;
  const pausedByPlayer = run.pauses.includes("player");
  const aim = useCallback((): [number, number] => {
    const state = getSession()?.state;
    const point = reticle.current ?? (state && tdCrowdTarget(state)) ?? { x: 0, y: 3 };
    return [Math.round(point.x * TD_COORD_SCALE), Math.round(point.y * TD_COORD_SCALE)];
  }, [getSession]);

  const onTap = useCallback(
    (point: { x: number; y: number }, hit: { enemyId?: number; lootId?: number }) => {
      const scaled: [number, number] = [
        Math.round(point.x * TD_COORD_SCALE),
        Math.round(point.y * TD_COORD_SCALE),
      ];
      if (mode === "blink") {
        if (act(["blink", ...scaled])) setMode("aim");
        return;
      }
      if (mode === "trap") {
        act(["trap", ...scaled]);
        if ((getSession()?.state.hero.trapCharges ?? 0) <= 0) setMode("aim");
        return;
      }
      if (hit.lootId !== undefined && act(["loot", hit.lootId])) return;
      if (hit.enemyId !== undefined) act(["focus", hit.enemyId]);
      reticle.current = point;
    },
    [act, getSession, mode],
  );

  // The renderer asks for this every frame, so it refills one object.
  const view = useRef<TowerDefenseSceneView>({
    state: null,
    pending: 0,
    reticle: null,
    mode: "aim",
  });
  const getView = useCallback((): TowerDefenseSceneView => {
    const current = getSession();
    const next = view.current;
    next.state = current?.state ?? null;
    next.pending = current?.pending ?? 0;
    next.reticle = reticle.current;
    next.mode = mode;
    return next;
  }, [getSession, mode]);

  // Keyboard shortcuts while a run is on screen
  useEffect(() => {
    if (run.phase !== "playing") return;
    const onKey = (event: KeyboardEvent) => {
      // Modifier chords belong to the browser or OS, not to run keys.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const key = event.key.toLowerCase();
      // A control reached with the keyboard keeps Space and Enter for itself; a clicked
      // HUD button does not, so Space still substitutes right after a click.
      if (
        (key === " " || key === "enter") &&
        target?.closest("button, a, [role=button]") &&
        target.matches(":focus-visible")
      )
        return;
      // Space never scrolls the page, even while held.
      if (key === " ") event.preventDefault();
      // A held key repeats keydown; one press is one seal or one cast. While the host has
      // suspended the run, no key acts on it.
      if (event.repeat || props.suspended) return;
      const seal = TD_SEALS.find((id) => SEAL_HOTKEYS[id].toLowerCase() === key);
      if (seal) act(["seal", seal, ...aim()]);
      else if (key === " ") act(["sub"]);
      else if (key === "b") setMode((value) => (value === "blink" ? "aim" : "blink"));
      else if (key === "t") setMode((value) => (value === "trap" ? "aim" : "trap"));
      else if (key === "n") act(["call"]);
      else if (key === "p") setPaused("player", !pausedByPlayer);
      else if (key === "escape") setMode("aim");
      else if (/^\d$/.test(key)) {
        const ultimate = TD_ULTIMATES[Number(key) - 1];
        if (ultimate) act(["ult", ultimate, ...aim()]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, aim, pausedByPlayer, props.suspended, run.phase, setPaused]);

  const {
    setStageElement,
    element: stageElement,
    isFullscreen,
    toggle: toggleFullscreen,
    exit: exitFullscreen,
  } = useFullscreenStage();
  // The lobby is a page, not a stage: back there, the screen is handed back.
  useEffect(() => {
    if (run.phase === "lobby") exitFullscreen();
  }, [exitFullscreen, run.phase]);

  // A run this device holds no save of is lost with the tab until its claim succeeds.
  const isOnlyInTab =
    !props.isGuest &&
    run.unsaved &&
    run.phase !== "lobby" &&
    (!run.outcome || (!run.outcome.claimed && run.outcome.retryable));
  const state = run.hud;
  const playing = run.phase === "playing" && state;
  const stage = isFullscreen || !!props.standalone;
  const leave = () =>
    props.confirmLeave ? props.confirmLeave(run.leave) : run.leave();
  const { Arena } = props;

  return (
    // Full screen keeps the arena at the same place in the tree, so it never reloads.
    // When the controls need more height than a tall screen leaves, the arena keeps a
    // playable minimum and they scroll.
    <div
      ref={setStageElement}
      className={cn(
        stage && "bg-background flex flex-col gap-1.5 p-1.5 landscape:flex-row",
        stage &&
          "pt-[max(0.375rem,env(safe-area-inset-top))] pb-[max(0.375rem,env(safe-area-inset-bottom))]",
        isFullscreen && "fixed inset-0 z-[100]",
        !isFullscreen && props.standalone && "h-full",
        !stage && "space-y-1.5 p-1.5",
      )}
    >
      <PortalContainerContext.Provider value={isFullscreen ? stageElement : null}>
        {props.guardDialog}
        <div className={stage ? "contents" : undefined}>
          <div
            className={cn(
              "relative overflow-hidden rounded-lg",
              stage && "min-h-0 min-w-0 flex-1 basis-0",
              stage && playing && "portrait:min-h-[min(80vw,62dvh)]",
            )}
          >
            {props.suspended ? (
              <div className="flex h-full min-h-[320px] items-center justify-center bg-black/80 text-white">
                Paused
              </div>
            ) : !props.roster ? (
              <div className="flex h-[400px] items-center justify-center">
                <Loader explanation="Gathering enemies..." />
              </div>
            ) : (
              run.runId && (
                <Arena
                  runId={run.runId}
                  appearance={props.appearance}
                  roster={props.roster}
                  hitAsset={props.hitAsset}
                  smokeAsset={props.smokeAsset}
                  fill={stage}
                  onFrame={run.advance}
                  playSound={props.playSound}
                  getView={getView}
                  onTap={onTap}
                />
              )
            )}
            {playing && (
              <TowerDefenseOverlay
                state={playing}
                speed={run.speed}
                soundOn={props.sfxOn}
                mode={mode}
                isFullscreen={isFullscreen}
                pausedByPlayer={pausedByPlayer}
                onSpeed={run.setSpeed}
                onSound={props.onSound}
                onFullscreen={props.hostControlsFrame ? undefined : toggleFullscreen}
                onPause={(paused) => setPaused("player", paused)}
                onPanel={(open) => setPaused("panel", open)}
                act={act}
              />
            )}
            {playing && <TowerDefenseDraft state={playing} act={act} />}
            {run.phase !== "playing" && (
              <Results
                phase={run.phase}
                outcome={run.outcome}
                isGuest={props.isGuest}
                isOnlyInTab={isOnlyInTab}
                guestNote={props.guestNote}
                footer={props.resultsFooter}
                action={props.resultsAction}
                onRetry={run.retryClaim}
                onLeave={leave}
              />
            )}
          </div>
          {stage && playing && (
            <aside className="flex min-h-0 min-w-0 flex-initial [scrollbar-width:thin] flex-col gap-2 overflow-y-auto overscroll-contain landscape:w-[clamp(17rem,40vw,30rem)] landscape:flex-none">
              <TowerDefenseActionBar
                state={playing}
                mode={mode}
                onMode={setMode}
                act={act}
                aim={aim}
                layout="grid"
              />
              {run.unsaved && <UnsavedNotice />}
              <TowerDefensePanel
                state={playing}
                act={act}
                buyMax={buyMax}
                onBuyMax={setBuyMax}
              />
            </aside>
          )}
        </div>
        {!stage && playing && (
          <>
            <TowerDefenseActionBar
              state={playing}
              mode={mode}
              onMode={setMode}
              act={act}
              aim={aim}
            />
            {run.unsaved && <UnsavedNotice />}
            <TowerDefensePanel
              state={playing}
              act={act}
              buyMax={buyMax}
              onBuyMax={setBuyMax}
            />
          </>
        )}
      </PortalContainerContext.Provider>
    </div>
  );
};

const UnsavedNotice = () => (
  <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-sm">
    This run is no longer saved on this device. Finish it in this tab: leaving or
    reloading loses its latest progress.
  </p>
);

const Results = (props: {
  phase: string;
  outcome: TowerDefenseOutcome | null;
  isGuest: boolean;
  /** The unclaimed run has no local save, so only this tab still holds it. */
  isOnlyInTab: boolean;
  guestNote?: ReactNode;
  footer?: ReactNode;
  action?: ReactNode;
  onRetry: () => void;
  onLeave: () => void;
}) => {
  const canRetry =
    !!props.outcome &&
    !props.outcome.claimed &&
    props.outcome.retryable &&
    !props.isGuest;
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-2">
      <div className="bg-background w-full max-w-md space-y-3 rounded-xl border p-5 text-center shadow-xl">
        {props.phase === "claiming" || !props.outcome ? (
          <Loader explanation="Verifying your run..." />
        ) : (
          <>
            <h3 className="text-2xl font-bold">
              {props.outcome.won
                ? "Challenge cleared"
                : props.outcome.quit
                  ? "Retreated"
                  : "Defeated"}{" "}
              at wave {props.outcome.wave}
            </h3>
            <p>
              {formatTdNumber(props.outcome.kills)} enemies defeated
              {props.isGuest || props.outcome.challenge
                ? ""
                : ` · ${formatTdNumber(props.outcome.points)} scroll${props.outcome.points === 1 ? "" : "s"}`}
            </p>
            {props.outcome.message && (
              <p className="text-sm">{props.outcome.message}</p>
            )}
            {props.isGuest && props.guestNote}
            {props.isOnlyInTab && (
              <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-sm">
                This run is not saved on this device. Claim it before leaving this tab:
                leaving or reloading loses it.
              </p>
            )}
            <div className="flex flex-wrap justify-center gap-2">
              {canRetry && (
                <Button variant="outline" onClick={props.onRetry}>
                  Retry claim
                </Button>
              )}
              {props.outcome.reloadRequired && (
                <Button variant="outline" onClick={() => window.location.reload()}>
                  Reload
                </Button>
              )}
              <Button
                variant={props.action ? "outline" : "default"}
                onClick={props.onLeave}
              >
                {props.outcome.challenge ? "Back" : "Back to the Guard Hall"}
              </Button>
              {props.action}
            </div>
            {props.footer}
          </>
        )}
      </div>
    </div>
  );
};
