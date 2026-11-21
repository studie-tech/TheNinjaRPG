"use client";

import {
  type ComponentProps,
  type ComponentType,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { PortalContainerContext } from "@/components/ui/portal-container";
import type { useChakraStormRun } from "@/hooks/useChakraStormRun";
import { useFullscreenStage } from "@/hooks/useFullscreenStage";
import type { ChakraStormArena } from "@/layout/ChakraStorm";
import {
  ChakraStormBuild,
  ChakraStormDraft,
  ChakraStormOverlay,
  ChakraStormPaused,
  ChakraStormResults,
} from "@/layout/ChakraStormHud";
import Loader from "@/layout/Loader";
import type { CsStage } from "@/libs/chakraStorm/content";
import type { ChakraStormSceneView } from "@/libs/rendering/scenes/chakraStorm";
import { cn } from "@/libs/shadui";

type ArenaProps = ComponentProps<typeof ChakraStormArena>;

/** Pointer travel, in CSS pixels, before a drag starts walking. */
const JOYSTICK_DEADZONE = 10;
/** The drawn joystick's radius, in CSS pixels. */
const JOYSTICK_RADIUS = 46;

/**
 * A Chakra Storm run on screen: the battlefield with its meters, the draft and the
 * results, and the hero's build beside it on wide screens or below it on tall ones.
 * The hero walks with WASD or the arrow keys, or by dragging anywhere on the field.
 */
export const ChakraStormPlayfield = (props: {
  run: ReturnType<typeof useChakraStormRun>;
  Arena: ComponentType<ArenaProps>;
  appearance: ArenaProps["appearance"];
  /** Enemy artwork, undefined while it loads. */
  roster: ArenaProps["roster"] | undefined;
  sfxOn: boolean;
  onSound?: (enabled: boolean) => void;
  playSound: ArenaProps["playSound"];
  /** Start a run in a region, keeping the lobby's choice in step. */
  onScout: (stage: CsStage) => void;
  /** Shown under the results, such as an invitation to sign in. */
  resultsFooter?: ReactNode;
}) => {
  const { run } = props;
  const { setMove, setPaused, act, getSession, advance } = run;
  const hud = run.hud;
  const playing = run.phase === "playing" && hud;

  // Walking: held keys, or a drag that acts as a joystick wherever it starts.
  const keys = useRef(new Set<string>());
  const stick = useRef<{ id: number; x: number; y: number } | null>(null);
  const [stickView, setStickView] = useState<{
    x: number;
    y: number;
    dx: number;
    dy: number;
  } | null>(null);
  const updateKeyMove = useCallback(() => {
    if (stick.current) return;
    const held = keys.current;
    const x =
      (held.has("d") || held.has("arrowright") ? 1 : 0) -
      (held.has("a") || held.has("arrowleft") ? 1 : 0);
    const y =
      (held.has("w") || held.has("arrowup") ? 1 : 0) -
      (held.has("s") || held.has("arrowdown") ? 1 : 0);
    setMove(x === 0 && y === 0 ? -1 : directionIndex(x, y));
  }, [setMove]);

  const pausedNow = run.paused;
  useEffect(() => {
    if (run.phase !== "playing") return;
    const held = keys.current;
    const onDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const key = event.key.toLowerCase();
      if (MOVE_KEYS.has(key)) {
        event.preventDefault();
        held.add(key);
        updateKeyMove();
      } else if ((key === "p" || key === "escape") && !event.repeat)
        setPaused(!pausedNow);
    };
    const onUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!held.delete(key)) return;
      updateKeyMove();
    };
    // A hidden tab pauses the run, and loses track of keys released meanwhile.
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      held.clear();
      updateKeyMove();
      setPaused(true);
    };
    const onBlur = () => {
      held.clear();
      updateKeyMove();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pausedNow, run.phase, setPaused, updateKeyMove]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (stick.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    // A drag steers; it must not start selecting the page.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    stick.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setStickView({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      dx: 0,
      dy: 0,
    });
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = stick.current;
    if (!origin || origin.id !== event.pointerId) return;
    const dx = event.clientX - origin.x,
      dy = event.clientY - origin.y;
    const length = Math.hypot(dx, dy);
    setMove(length < JOYSTICK_DEADZONE ? -1 : directionIndex(dx, -dy));
    const reach = Math.min(1, JOYSTICK_RADIUS / Math.max(1, length));
    setStickView((view) => (view ? { ...view, dx: dx * reach, dy: dy * reach } : view));
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (stick.current?.id !== event.pointerId) return;
    stick.current = null;
    setStickView(null);
    updateKeyMove();
  };

  // The renderer asks for this every frame, so it refills one object.
  const view = useRef<ChakraStormSceneView>({ state: null, pending: 0 });
  const getView = useCallback((): ChakraStormSceneView => {
    const current = getSession();
    view.current.state = current?.state ?? null;
    view.current.pending = current?.pending ?? 0;
    return view.current;
  }, [getSession]);
  const { playSound } = props;
  // Milestones the simulation has no event for carry their own fanfare.
  const { announcement } = run;
  useEffect(() => {
    if (announcement?.sound) playSound(announcement.sound, 0.75);
  }, [announcement, playSound]);
  const onPick = useCallback(
    (index: number) => {
      playSound("airy", 0.4);
      act(["pick", index]);
    },
    [act, playSound],
  );
  const onReroll = useCallback(() => {
    playSound("shimmer", 0.35);
    act(["reroll"]);
  }, [act, playSound]);
  const onSkip = useCallback(() => act(["skip"]), [act]);

  const {
    setStageElement,
    element: stageElement,
    isFullscreen,
    toggle: toggleFullscreen,
    exit: exitFullscreen,
  } = useFullscreenStage();
  useEffect(() => {
    if (run.phase === "lobby") exitFullscreen();
  }, [exitFullscreen, run.phase]);
  // Phones and tablets play on the whole screen: inside the page the field is too small
  // to dodge in, and a drag on it must never scroll the page. Each run enters once.
  const staged = useRef<string | null>(null);
  useEffect(() => {
    if (!stageElement || !run.runId || staged.current === run.runId) return;
    staged.current = run.runId;
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (touch && !isFullscreen) toggleFullscreen();
  }, [isFullscreen, run.runId, stageElement, toggleFullscreen]);
  const { Arena } = props;

  return (
    <div
      ref={setStageElement}
      className={cn(
        // Dragging to steer must never start a text selection, whatever opens under
        // the pointer mid-drag, and a long press must not open the touch callout.
        "@container flex flex-col gap-1.5 p-1.5 select-none [-webkit-touch-callout:none]",
        isFullscreen &&
          "bg-background fixed inset-0 z-[100] pt-[max(0.375rem,env(safe-area-inset-top))] pb-[max(0.375rem,env(safe-area-inset-bottom))] landscape:flex-row",
      )}
    >
      <PortalContainerContext.Provider value={isFullscreen ? stageElement : null}>
        <div
          className={cn(
            "relative overflow-hidden rounded-lg bg-black",
            isFullscreen
              ? "min-h-0 min-w-0 flex-1 basis-0 portrait:min-h-[60dvh]"
              : "aspect-[4/5] max-h-[78vh] min-h-[340px] w-full @xl:aspect-[4/3]",
          )}
        >
          {!props.roster ? (
            <div className="flex h-full items-center justify-center">
              <Loader explanation="Preparing the field..." />
            </div>
          ) : (
            run.runId && (
              <Arena
                runId={run.runId}
                stage={hud?.config.stage ?? "horizon"}
                appearance={props.appearance}
                roster={props.roster}
                onFrame={advance}
                playSound={props.playSound}
                getView={getView}
              />
            )
          )}
          {/* The whole field is the joystick. */}
          {playing && !hud.draft && (
            <div
              className="absolute inset-0 z-[5] touch-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onLostPointerCapture={onPointerEnd}
            >
              {stickView && <Joystick {...stickView} />}
            </div>
          )}
          {playing && (
            <ChakraStormOverlay
              hud={hud}
              paused={run.paused}
              soundOn={props.sfxOn}
              isFullscreen={isFullscreen}
              announcement={run.announcement}
              goal={run.goal}
              record={run.record}
              onPause={setPaused}
              onSound={props.onSound}
              onFullscreen={toggleFullscreen}
            />
          )}
          {playing && hud.tick < 100 && !stickView && (
            <p className="pointer-events-none absolute inset-x-0 bottom-3 z-10 text-center text-base font-semibold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
              Move with WASD or the arrow keys, or drag anywhere. Your jutsu cast
              themselves.
            </p>
          )}
          {playing && (
            <ChakraStormDraft
              hud={hud}
              onPick={onPick}
              onReroll={onReroll}
              onSkip={onSkip}
            />
          )}
          {playing && run.paused && !hud.draft && (
            <ChakraStormPaused
              hud={hud}
              goal={run.goal}
              record={run.record}
              onGiveUp={() => act(["quit"])}
              onResume={() => setPaused(false)}
            />
          )}
          {run.phase === "over" && run.outcome && (
            <ChakraStormResults
              outcome={run.outcome}
              goal={run.goal}
              footer={props.resultsFooter}
              onAgain={() => {
                const outcome = run.outcome;
                if (!outcome) return;
                // A challenge starts again from its objective, which the server checks.
                if (outcome.challenge) void run.start(outcome.stage, outcome.challenge);
                else props.onScout(outcome.stage);
              }}
              onScout={props.onScout}
              onLeave={run.leave}
              onRetry={() => void run.retryClaim()}
            />
          )}
        </div>
        {hud && (
          <ChakraStormBuild
            hud={hud}
            className={cn(
              isFullscreen &&
                "min-h-0 overflow-y-auto landscape:w-[clamp(16rem,32vw,26rem)] landscape:flex-none",
            )}
          />
        )}
      </PortalContainerContext.Provider>
    </div>
  );
};

const Joystick = (props: { x: number; y: number; dx: number; dy: number }) => (
  <div className="pointer-events-none absolute" style={{ left: props.x, top: props.y }}>
    <div
      className="absolute rounded-full border-2 border-white/40 bg-white/10"
      style={{
        width: JOYSTICK_RADIUS * 2,
        height: JOYSTICK_RADIUS * 2,
        left: -JOYSTICK_RADIUS,
        top: -JOYSTICK_RADIUS,
      }}
    />
    <div
      className="absolute h-10 w-10 rounded-full bg-white/60 shadow"
      style={{ left: props.dx - 20, top: props.dy - 20 }}
    />
  </div>
);

const MOVE_KEYS = new Set([
  "w",
  "a",
  "s",
  "d",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
]);

/** The nearest of the simulation's sixteen directions, counterclockwise from east (y up). */
const directionIndex = (x: number, y: number) =>
  (Math.round(Math.atan2(y, x) / (Math.PI / 8)) + 16) % 16;
