import { getQueryKey } from "@trpc/react-query";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import {
  getDojoPurchaseUpdate,
  getRunClaimUpdate,
  type TowerDefenseProgress,
} from "@/deltas/towerDefense";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { showMutationToast } from "@/libs/toast";
import { TD_TICK_SECONDS, tdMaxSpeed } from "@/libs/towerDefense/balance";
import type { TdDojoUpgrade } from "@/libs/towerDefense/content";
import {
  applyAction,
  createRun,
  replayRun,
  stepRun,
  type TdAction,
  type TdCommand,
  type TdEvent,
  type TdRunConfig,
  type TdState,
} from "@/libs/towerDefense/sim";

/** A run in progress, kept outside React so the frame loop never waits on a render. */
export interface TowerDefenseSession {
  id: string;
  config: TdRunConfig;
  token: string | null;
  state: TdState;
  log: TdAction[];
  /** Accumulated real seconds not yet simulated. */
  pending: number;
  /** Events for the renderer, drained every frame. */
  events: TdEvent[];
  claimStarted: boolean;
}

export type TowerDefensePhase = "lobby" | "playing" | "claiming" | "over";

export interface TowerDefenseOutcome {
  wave: number;
  kills: number;
  points: number;
  claimed: boolean;
  message: string | null;
  quit: boolean;
}

/** Most ticks simulated per frame; a long stall resumes instead of fast-forwarding. */
const MAX_TICKS_PER_FRAME = 40;
const SAVE_INTERVAL_MS = 4000;
const HUD_REFRESH_MS = 150;

/** Reconcile the Dojo progress query with confirmed purchases and claims. */
export const useTowerDefenseProgressCache = () => {
  const key = useMemo(
    () => getQueryKey(api.towerDefense.getProgress, undefined, "query"),
    [],
  );
  const { prepareUpdate, updateCache } =
    useQueryCacheUpdate<RouterOutputs["towerDefense"]["getProgress"]>(key);
  return {
    applyPurchase: useCallback(
      (upgradeId: TdDojoUpgrade, result: { level: number; points: number }) =>
        updateCache(
          (current) =>
            getDojoPurchaseUpdate(
              upgradeId,
              result,
            )(current as TowerDefenseProgress) as typeof current,
          prepareUpdate(),
        ),
      [prepareUpdate, updateCache],
    ),
    applyClaim: useCallback(
      (result: { pointsEarned: number; wave: number }) =>
        updateCache(
          (current) =>
            getRunClaimUpdate(result)(
              current as TowerDefenseProgress,
            ) as typeof current,
          prepareUpdate(),
        ),
      [prepareUpdate, updateCache],
    ),
  };
};

/**
 * Drives a tower-defense run: steps the deterministic simulation from the render loop,
 * records every accepted action with its tick, saves the run locally so a reload resumes
 * it by replay, and claims the result once the hero falls or retreats. Guests play the
 * same game locally without a token, so nothing is claimed.
 */
export const useTowerDefenseRun = (userId: string | undefined) => {
  const storageKey = `towerDefenseRun:${userId ?? "guest"}`;
  const session = useRef<TowerDefenseSession | null>(null);
  const lastSave = useRef(0);
  const [phase, setPhase] = useState<TowerDefensePhase>("lobby");
  const [speed, setSpeedState] = useState(1);
  const [outcome, setOutcome] = useState<TowerDefenseOutcome | null>(null);
  const [saved, setSaved] = useState<{ wave: number; tick: number } | null>(null);
  /** An immutable copy of the run for rendering; the live state stays in `session`. */
  const [hud, setHud] = useState<TdState | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const { applyClaim, applyPurchase } = useTowerDefenseProgressCache();
  const startRun = api.towerDefense.startRun.useMutation();
  const claimRun = api.towerDefense.claimRun.useMutation({
    meta: { handlesTransportError: true },
  });
  const purchase = api.towerDefense.purchaseDojoUpgrade.useMutation();

  const persist = useCallback(
    (force = false) => {
      const current = session.current;
      if (!current) return;
      const now = Date.now();
      if (!force && now - lastSave.current < SAVE_INTERVAL_MS) return;
      lastSave.current = now;
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            id: current.id,
            config: current.config,
            token: current.token,
            log: current.log,
            tick: current.state.tick,
            wave: current.state.wave,
            over: current.state.over,
          }),
        );
      } catch {
        // Storage can be full or blocked; the run keeps playing, it just will not resume.
      }
    },
    [storageKey],
  );

  const forget = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
    } catch {}
    setSaved(null);
  }, [storageKey]);

  const readSaved = useCallback(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw) as {
        id: string;
        config: TdRunConfig;
        token: string | null;
        log: TdAction[];
        tick: number;
        wave: number;
        over: boolean;
      };
    } catch {
      return null;
    }
  }, [storageKey]);

  useEffect(() => {
    const stored = readSaved();
    setSaved(stored ? { wave: stored.wave, tick: stored.tick } : null);
  }, [readSaved]);

  const claim = useCallback(async () => {
    const current = session.current;
    if (!current || current.claimStarted) return;
    current.claimStarted = true;
    const { state } = current;
    const base = {
      wave: state.wave,
      kills: state.kills,
      points: Math.floor(state.scrolls),
      quit: state.quit,
    };
    persist(true);
    if (!current.token) {
      setOutcome({ ...base, claimed: false, message: null });
      setPhase("over");
      forget();
      return;
    }
    setPhase("claiming");
    const result = await claimRun
      .mutateAsync({ token: current.token, actions: current.log, endTick: state.tick })
      .catch(() => null);
    if (!result) {
      setOutcome({
        ...base,
        claimed: false,
        message: "Could not reach the server. Your run is saved; try claiming again.",
      });
      setPhase("over");
      return;
    }
    if (result.success) {
      applyClaim({
        pointsEarned: result.pointsEarned ?? 0,
        wave: result.wave ?? state.wave,
      });
      forget();
    } else if (result.alreadyClaimed) forget();
    setOutcome({
      ...base,
      points: result.pointsEarned ?? base.points,
      claimed: result.success,
      message: result.message,
    });
    setPhase("over");
  }, [applyClaim, claimRun, forget, persist]);

  const begin = useCallback(
    (config: TdRunConfig, token: string | null, log: TdAction[] = [], tick = 0) => {
      const id = nanoid();
      const state =
        log.length > 0 || tick > 0
          ? replayRun(config, log, tick, { recordEvents: false }).state
          : createRun(config);
      state.recordEvents = true;
      state.events.length = 0;
      session.current = {
        id,
        config,
        token,
        state,
        log: [...log],
        pending: 0,
        events: [],
        claimStarted: false,
      };
      setOutcome(null);
      setSpeedState(1);
      setPhase("playing");
      setRunId(id);
      setHud(snapshotRun(state));
      persist(true);
      if (state.over) void claim();
    },
    [claim, persist],
  );

  /** Start a signed run from a checkpoint, or a local guest run. */
  const start = useCallback(
    async (startWave: number) => {
      if (!userId) {
        begin({ seed: nanoid(), startWave: 1, bestWave: 0, dojo: {} }, null);
        return;
      }
      const result = await startRun.mutateAsync({ startWave });
      if (!result.success || !result.token || !result.config) {
        showMutationToast(result);
        return;
      }
      begin(result.config as TdRunConfig, result.token);
    },
    [begin, startRun, userId],
  );

  /** Resume the saved run by replaying its log to the saved tick. */
  const resume = useCallback(() => {
    const stored = readSaved();
    if (!stored) return;
    begin(stored.config, stored.token, stored.log, stored.tick);
  }, [begin, readSaved]);

  /** Apply a player action at the current tick and record it if the run accepted it. */
  const act = useCallback(
    (command: TdCommand) => {
      const current = session.current;
      if (!current || current.state.over) return false;
      const action = [current.state.tick, ...command] as TdAction;
      if (!applyAction(current.state, action)) return false;
      current.log.push(action);
      current.events.push(...current.state.events);
      current.state.events.length = 0;
      setHud(snapshotRun(current.state));
      if (current.state.over) void claim();
      else persist();
      return true;
    },
    [claim, persist],
  );

  /** Advance by real elapsed seconds at the chosen speed; called every frame. */
  const advance = useCallback(
    (seconds: number) => {
      const current = session.current;
      if (!current || current.state.over || phase !== "playing") return;
      current.pending = Math.min(
        current.pending + seconds * speed,
        MAX_TICKS_PER_FRAME * TD_TICK_SECONDS,
      );
      let stepped = 0;
      while (current.pending >= TD_TICK_SECONDS && stepped < MAX_TICKS_PER_FRAME) {
        if (current.state.offer) {
          current.pending = 0;
          break;
        }
        current.pending -= TD_TICK_SECONDS;
        stepRun(current.state);
        stepped++;
        if (current.state.over) break;
      }
      if (current.state.events.length > 0) {
        current.events.push(...current.state.events);
        current.state.events.length = 0;
      }
      if (current.state.over) {
        void claim();
        return;
      }
      persist();
    },
    [claim, persist, phase, speed],
  );

  const setSpeed = useCallback((value: number) => {
    const current = session.current;
    const max = tdMaxSpeed(current?.config.dojo.speed ?? 0);
    setSpeedState(Math.min(max, Math.max(1, value)));
  }, []);

  const retryClaim = useCallback(() => {
    if (session.current) session.current.claimStarted = false;
    void claim();
  }, [claim]);

  const leave = useCallback(() => {
    session.current = null;
    setOutcome(null);
    setRunId(null);
    setHud(null);
    setPhase("lobby");
  }, []);

  // Publish a fresh snapshot a few times a second while the run is on screen.
  useEffect(() => {
    if (phase === "lobby") return;
    const timer = setInterval(() => {
      if (session.current) setHud(snapshotRun(session.current.state));
    }, HUD_REFRESH_MS);
    return () => clearInterval(timer);
  }, [phase]);

  const buyDojo = useCallback(
    async (upgradeId: TdDojoUpgrade) => {
      const result = await purchase.mutateAsync({ upgradeId });
      if (result.success && result.level !== undefined && result.points !== undefined)
        applyPurchase(upgradeId, { level: result.level, points: result.points });
      else showMutationToast(result);
    },
    [applyPurchase, purchase],
  );

  // Save on tab hide so a closed tab resumes where it was.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") persist(true);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      persist(true);
    };
  }, [persist]);

  return {
    session,
    runId,
    hud,
    phase,
    speed,
    outcome,
    saved,
    isStarting: startRun.isPending,
    isPurchasing: purchase.isPending,
    start,
    resume,
    act,
    advance,
    setSpeed,
    retryClaim,
    leave,
    discardSaved: forget,
    buyDojo,
  };
};

/**
 * A copy of everything the HUD reads, so a render never observes the live run and
 * memoized components see a new object whenever anything may have changed.
 */
const snapshotRun = (state: TdState): TdState => ({
  ...state,
  hero: { ...state.hero, seals: [...state.hero.seals] },
  shop: { ...state.shop },
  perks: { ...state.perks },
  offer: state.offer ? [...state.offer] : null,
  jutsuReadyAt: { ...state.jutsuReadyAt },
  ultReadyAt: { ...state.ultReadyAt },
  sentries: state.sentries.map((sentry) => (sentry ? { ...sentry } : null)),
  enemies: [...state.enemies],
  eras: [...state.eras],
  events: [],
});
