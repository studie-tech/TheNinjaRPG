"use client";

import {
  type ComponentProps,
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { PortalContainerContext } from "@/components/ui/portal-container";
import type { useChakraStormRun } from "@/hooks/useChakraStormRun";
import {
  type ChakraStormStickView,
  JOYSTICK_RADIUS,
  useChakraStormSteering,
} from "@/hooks/useChakraStormSteering";
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

  // Walking: held keys, or a drag that acts as a joystick wherever it starts. The
  // joystick layer leaves while a draft is open, which ends a drag in progress.
  const steering = Boolean(playing && !hud.draft);
  const { stickView, handlers: stickHandlers } = useChakraStormSteering({
    playing: run.phase === "playing",
    steering,
    paused: run.paused,
    setMove,
    setPaused,
  });

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
          {steering && (
            <div className="absolute inset-0 z-[5] touch-none" {...stickHandlers}>
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

const Joystick = (props: ChakraStormStickView) => (
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
