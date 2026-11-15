"use client";

import { Trophy } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  ID_ANIMATION_HIT,
  ID_ANIMATION_SMOKE,
  TD_SFX,
  type TdSfx,
} from "@/drizzle/constants";
import {
  type TowerDefenseOutcome,
  useTowerDefenseRun,
} from "@/hooks/useTowerDefenseRun";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import ContentBox from "@/layout/ContentBox";
import { type GameSettingsUser, useGameSettings } from "@/layout/GameSettings";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import {
  SEAL_HOTKEYS,
  TowerDefenseActionBar,
  TowerDefenseDraft,
  type TowerDefenseInputMode,
  TowerDefenseOverlay,
  TowerDefensePanel,
} from "@/layout/TowerDefenseHud";
import { TowerDefenseLobby } from "@/layout/TowerDefenseLobby";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import type { TowerDefenseSceneView } from "@/libs/rendering/scenes/towerDefense";
import { TD_COORD_SCALE } from "@/libs/towerDefense/balance";
import { TD_SEALS, TD_ULTIMATES } from "@/libs/towerDefense/content";
import { formatTdNumber } from "@/libs/towerDefense/format";
import type { TdEvent } from "@/libs/towerDefense/sim";
import { playPreloadedAudio, preloadAudioBuffers, savedSfxVolume } from "@/utils/audio";
import { useUserDataSelector } from "@/utils/UserContext";

// Load the renderer only once a run starts
const TowerDefenseArena = dynamic(
  () => import("@/layout/TowerDefense").then((module) => module.TowerDefenseArena),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[400px] items-center justify-center">
        <Loader explanation="Loading arena..." />
      </div>
    ),
  },
);

export default function TowerDefensePage() {
  const {
    data: user,
    isClerkLoaded,
    isSignedIn,
    status,
  } = useUserDataSelector((profile) => ({
    userId: profile.userId,
    gender: profile.gender,
    spriteBodyStyle: profile.spriteBodyStyle,
    attributes: profile.attributes,
    items: profile.items,
  }));
  const userId = user?.userId;
  const run = useTowerDefenseRun(userId);
  const progress = api.towerDefense.getProgress.useQuery(undefined, {
    enabled: !!userId,
  });
  const roster = api.towerDefense.getRoster.useQuery(undefined, {
    staleTime: Number.POSITIVE_INFINITY,
  });
  const { data: assets } = api.misc.getAllGameAssetNames.useQuery({
    ids: [ID_ANIMATION_HIT, ID_ANIMATION_SMOKE, ...Object.values(TD_SFX)],
  });
  // Sound follows the same "Combat sounds" preference and volume as battles.
  const { data: settingsUser } = useUserDataSelector(
    (profile): GameSettingsUser => ({
      musicOn: profile.musicOn,
      buttonSfxOn: profile.buttonSfxOn,
      sfxOn: profile.sfxOn,
      village: profile.village,
      isOutlaw: profile.isOutlaw,
      bloodlineId: profile.bloodlineId,
      status: profile.status,
    }),
  );
  const { sfxOn, setSfxEnabled } = useGameSettings(settingsUser);
  const sounds = useMemo(() => {
    const urls = new Map<TdSfx, string>();
    for (const [cue, id] of Object.entries(TD_SFX) as [TdSfx, string][]) {
      const url = assets?.find((asset) => asset.id === id)?.url;
      if (url) urls.set(cue, url);
    }
    return urls;
  }, [assets]);
  useEffect(() => {
    if (sfxOn && sounds.size > 0) void preloadAudioBuffers([...sounds.values()]);
  }, [sfxOn, sounds]);
  const playSound = (cue: TdSfx, volume: number) => {
    const url = sounds.get(cue);
    if (sfxOn && url) void playPreloadedAudio(url, savedSfxVolume() * volume);
  };
  const appearance = useMemo(
    () =>
      resolveSpriteAppearance(
        user
          ? {
              gender: user.gender,
              spriteBodyStyle: user.spriteBodyStyle,
              attributes: user.attributes,
              items: user.items,
            }
          : { gender: "Male" },
      ),
    [user],
  );
  const [mode, setMode] = useState<TowerDefenseInputMode>("aim");
  const reticle = useRef<{ x: number; y: number } | null>(null);

  // Handlers depend on the run's stable members, never on the object returned per render.
  const { act, getSession } = run;
  const aim = useCallback((): [number, number] => {
    const point = reticle.current ?? nearestCrowd(getSession()?.state.enemies ?? []);
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
    events: [],
    reticle: null,
    mode: "aim",
  });
  const getView = useCallback((): TowerDefenseSceneView => {
    const current = getSession();
    const next = view.current;
    next.state = current?.state ?? null;
    next.pending = current?.pending ?? 0;
    next.events = current?.state.events ?? NO_EVENTS;
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
      // Space never scrolls the page, even while held.
      if (key === " ") event.preventDefault();
      // A held key repeats keydown; one press is one seal or one cast.
      if (event.repeat) return;
      const seal = TD_SEALS.find((id) => SEAL_HOTKEYS[id].toLowerCase() === key);
      if (seal) act(["seal", seal, ...aim()]);
      else if (key === " ") act(["sub"]);
      else if (key === "b") setMode((value) => (value === "blink" ? "aim" : "blink"));
      else if (key === "t") setMode((value) => (value === "trap" ? "aim" : "trap"));
      else if (key === "n") act(["call"]);
      else if (key === "escape") setMode("aim");
      else if (/^\d$/.test(key)) {
        const ultimate = TD_ULTIMATES[Number(key) - 1];
        if (ultimate) act(["ult", ultimate, ...aim()]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, aim, run.phase]);

  // A run this device holds no save of is lost with the tab until its claim succeeds.
  const isOnlyInTab =
    !!userId &&
    run.unsaved &&
    run.phase !== "lobby" &&
    (!run.outcome || (!run.outcome.claimed && run.outcome.retryable));
  const leaveGuard = useUnsavedChangesGuard(isOnlyInTab, {
    title: "Leave this run?",
    message:
      "This run is not saved on this device, so leaving or reloading before it is claimed can lose it and its scrolls.",
    proceedLabel: "Leave",
  });

  // A signed-in player's runs are claimable only once the profile names them, so the
  // guest lobby waits until the profile has loaded.
  if (!isClerkLoaded || (isSignedIn && !user && status === "pending"))
    return <Loader explanation="Loading user data..." />;
  const state = run.hud;
  const playing = run.phase === "playing" && state;

  if (run.phase === "lobby")
    return (
      <ContentBox
        title="Tower Defense"
        subtitle="Hold the line for as many waves as you can"
        defaultBackHref="/minigames"
        topRightContent={<LeaderboardLink />}
      >
        <TowerDefenseLobby
          isGuest={!userId}
          progress={progress.data}
          saved={run.saved}
          isStarting={run.isStarting}
          isResuming={run.isResuming}
          isPurchasing={run.isPurchasing}
          onStart={(startWave, replaceSaved) => void run.start(startWave, replaceSaved)}
          onResume={run.resume}
          onDiscard={run.discardSaved}
          onBuy={(upgradeId) => void run.buyDojo(upgradeId)}
        />
      </ContentBox>
    );

  return (
    <ContentBox
      title="Tower Defense"
      subtitle={state ? `Wave ${state.wave}` : "Run"}
      defaultBackHref="/minigames"
      noRightAlign
      padding={false}
    >
      {leaveGuard.dialog}
      <div className="space-y-1.5 p-1.5">
        <div className="relative overflow-hidden rounded-lg">
          {roster.isPending ? (
            <div className="flex h-[400px] items-center justify-center">
              <Loader explanation="Gathering enemies..." />
            </div>
          ) : (
            run.runId && (
              <TowerDefenseArena
                runId={run.runId}
                appearance={appearance}
                roster={roster.data ?? []}
                hitAsset={assets?.find((asset) => asset.id === ID_ANIMATION_HIT)}
                smokeAsset={assets?.find((asset) => asset.id === ID_ANIMATION_SMOKE)}
                onFrame={run.advance}
                playSound={playSound}
                getView={getView}
                onTap={onTap}
              />
            )
          )}
          {playing && (
            <TowerDefenseOverlay
              state={playing}
              speed={run.speed}
              soundOn={!!sfxOn}
              mode={mode}
              onSpeed={run.setSpeed}
              onSound={setSfxEnabled}
              act={act}
            />
          )}
          {playing && (
            <TowerDefenseDraft
              state={playing}
              act={act}
              onAutoPick={() => {
                for (let i = 0; i < 50 && act(["perk", 0]); i++);
              }}
            />
          )}
          {run.phase !== "playing" && (
            <Results
              phase={run.phase}
              outcome={run.outcome}
              isGuest={!userId}
              isOnlyInTab={isOnlyInTab}
              onRetry={run.retryClaim}
              onLeave={() => leaveGuard.confirmDiscard(run.leave)}
            />
          )}
        </div>
        {playing && (
          <>
            <TowerDefenseActionBar
              state={playing}
              mode={mode}
              onMode={setMode}
              act={act}
              aim={aim}
            />
            {run.unsaved && (
              <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-sm">
                This run is no longer saved on this device. Finish it in this tab:
                leaving or reloading loses its latest progress.
              </p>
            )}
            <TowerDefensePanel state={playing} act={act} />
          </>
        )}
      </div>
    </ContentBox>
  );
}

const Results = (props: {
  phase: string;
  outcome: TowerDefenseOutcome | null;
  isGuest: boolean;
  /** The unclaimed run has no local save, so only this tab still holds it. */
  isOnlyInTab: boolean;
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
              {props.outcome.quit ? "Retreated" : "Defeated"} at wave{" "}
              {props.outcome.wave}
            </h3>
            <p>
              {formatTdNumber(props.outcome.kills)} enemies defeated
              {props.isGuest
                ? ""
                : ` · ${formatTdNumber(props.outcome.points)} scrolls`}
            </p>
            {props.outcome.message && (
              <p className="text-sm">{props.outcome.message}</p>
            )}
            {props.isGuest && (
              <p className="text-sm">Log in to keep scrolls and train in the Dojo.</p>
            )}
            {props.isOnlyInTab && (
              <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-sm">
                This run is not saved on this device. Claim it before leaving this tab:
                leaving or reloading loses it.
              </p>
            )}
            <div className="flex justify-center gap-2">
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
              <Button onClick={props.onLeave}>Back to the Dojo</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/** The renderer drains its events in place, so the empty fallback is never refilled. */
const NO_EVENTS: TdEvent[] = [];

const LeaderboardLink = () => (
  <Button asChild size="sm">
    <Link href="/manual/towerDefense/leaderboard">
      <Trophy className="mr-2 h-4 w-4" />
      Leaderboard
    </Link>
  </Button>
);

/** Aim at the thickest crowd when the player has not placed a reticle. */
const nearestCrowd = (enemies: { x: number; y: number }[]) => {
  let best = { x: 0, y: 3 },
    bestCount = 0;
  for (const enemy of enemies.slice(0, 40)) {
    let count = 0;
    for (const other of enemies)
      if (Math.abs(other.x - enemy.x) + Math.abs(other.y - enemy.y) < 3) count++;
    if (count > bestCount) {
      best = enemy;
      bestCount = count;
    }
  }
  return best;
};
