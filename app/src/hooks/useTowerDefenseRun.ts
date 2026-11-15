import { TRPCClientError } from "@trpc/client";
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
import { decodeTdActions, isTdActionEncodable } from "@/libs/towerDefense/actionLog";
import { TD_TICK_SECONDS, tdMaxSpeed } from "@/libs/towerDefense/balance";
import type { TdDojoUpgrade } from "@/libs/towerDefense/content";
import {
  appendToLog,
  clearRun,
  createLogWriter,
  encodedLog,
  loadRun,
  readSavedRunSummary,
  resumeLogWriter,
  saveRun,
  TD_SAVED_LOG_MAX_CHARS,
  type TdLogWriter,
  type TdSavedRunSummary,
} from "@/libs/towerDefense/savedRun";
import {
  advanceReplay,
  applyAction,
  createReplay,
  createRun,
  stepRun,
  TD_SIM_VERSION,
  type TdAction,
  type TdCommand,
  type TdEvent,
  type TdReplay,
  type TdRunConfig,
  type TdState,
} from "@/libs/towerDefense/sim";
import { isRetryableTrpcError } from "@/utils/error";
import {
  TD_MAX_ACTIONS,
  TD_MAX_LOG_CHARS,
  TD_MAX_TICKS,
} from "@/validators/towerDefense";

/** A run in progress, kept outside React so the frame loop never waits on a render. */
export interface TowerDefenseSession {
  id: string;
  config: TdRunConfig;
  token: string | null;
  state: TdState;
  log: TdLogWriter;
  /** Accumulated real seconds not yet simulated. */
  pending: number;
  /** Events for the renderer, drained every frame. */
  events: TdEvent[];
  claimStarted: boolean;
  /** Counts accepted actions, so the HUD can tell when a paused run changed. */
  version: number;
  /** Whether the latest save failed or the log outgrew local storage. */
  unsaved: boolean;
}

export type TowerDefensePhase = "lobby" | "playing" | "claiming" | "over";

export interface TowerDefenseOutcome {
  wave: number;
  kills: number;
  points: number;
  claimed: boolean;
  /** Whether claiming again could still succeed. */
  retryable: boolean;
  /** The page runs older rules than the server; a reload resumes the saved run. */
  reloadRequired: boolean;
  message: string | null;
  quit: boolean;
}

/** Most ticks simulated per frame; a long stall resumes instead of fast-forwarding. */
const MAX_TICKS_PER_FRAME = 40;
const SAVE_INTERVAL_MS = 4000;
const HUD_REFRESH_MS = 150;
/** Time a resume replays before yielding, so a long run restores without freezing. */
const RESUME_SLICE_MS = 8;
/** Ticks replayed between clock checks while resuming. */
const RESUME_STEP_TICKS = 250;
/** Room kept in the log for the retreat that ends a run at its length limit. */
const LOG_RESERVE_CHARS = 64;
const LOG_LIMITS = { maxTick: TD_MAX_TICKS, maxActions: TD_MAX_ACTIONS };
const GUEST_STORAGE_KEY = "towerDefenseRun:guest";

/**
 * Reconcile the Dojo progress query with confirmed purchases and claims. Callers take a
 * snapshot with `prepare` when the mutation starts and hand it to the update.
 */
export const useTowerDefenseProgressCache = () => {
  const utils = api.useUtils();
  const key = useMemo(
    () => getQueryKey(api.towerDefense.getProgress, undefined, "query"),
    [],
  );
  const { prepareUpdate, updateCache } =
    useQueryCacheUpdate<RouterOutputs["towerDefense"]["getProgress"]>(key);
  type Snapshot = ReturnType<typeof prepareUpdate>;
  return {
    prepare: prepareUpdate,
    applyPurchase: useCallback(
      (
        upgradeId: TdDojoUpgrade,
        result: { level: number; pointsSpent: number },
        snapshot: Snapshot,
      ) =>
        updateCache(
          (current) =>
            getDojoPurchaseUpdate(
              upgradeId,
              result,
            )(current as TowerDefenseProgress) as typeof current,
          snapshot,
        ),
      [updateCache],
    ),
    applyClaim: useCallback(
      (result: { pointsEarned: number; wave: number }, snapshot: Snapshot) =>
        updateCache(
          (current) =>
            getRunClaimUpdate(result)(
              current as TowerDefenseProgress,
            ) as typeof current,
          snapshot,
        ),
      [updateCache],
    ),
    /** A claim whose outcome this page never saw: only the server knows the balance. */
    refresh: useCallback(() => utils.towerDefense.getProgress.invalidate(), [utils]),
  };
};

/**
 * Drives a tower-defense run: steps the deterministic simulation from the render loop,
 * records every accepted action with its tick, saves the run locally so a reload resumes
 * it by replay, and claims the result once the hero falls or retreats. Guests play the
 * same game locally without a token, so nothing is claimed or saved.
 */
export const useTowerDefenseRun = (userId: string | undefined) => {
  const storageKey = userId ? `towerDefenseRun:${userId}` : GUEST_STORAGE_KEY;
  const session = useRef<TowerDefenseSession | null>(null);
  const lastSave = useRef(0);
  /** What the latest published snapshot was taken at. */
  const published = useRef<{ tick: number; version: number } | null>(null);
  /** Identifies the resume in flight; replacing it cancels the previous one. */
  const resuming = useRef<object | null>(null);
  const [phase, setPhase] = useState<TowerDefensePhase>("lobby");
  const [speed, setSpeedState] = useState(1);
  const [outcome, setOutcome] = useState<TowerDefenseOutcome | null>(null);
  const [saved, setSaved] = useState<TdSavedRunSummary | null>(null);
  const [isResuming, setIsResuming] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  /** An immutable copy of the run for rendering; the live state stays in `session`. */
  const [hud, setHud] = useState<TdState | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const { prepare, applyClaim, applyPurchase, refresh } =
    useTowerDefenseProgressCache();
  const { mutateAsync: startRun, isPending: isStarting } =
    api.towerDefense.startRun.useMutation();
  // A claim uploads a long log and replays it, so it travels alone instead of holding up
  // the requests batched beside it.
  const { mutateAsync: claimRun } = api.towerDefense.claimRun.useMutation({
    meta: { handlesTransportError: true },
    trpc: { context: { skipBatch: true } },
  });
  const { mutateAsync: purchase, isPending: isPurchasing } =
    api.towerDefense.purchaseDojoUpgrade.useMutation();

  const markUnsaved = useCallback((current: TowerDefenseSession, value: boolean) => {
    if (current.unsaved === value) return;
    current.unsaved = value;
    setUnsaved(value);
  }, []);

  const persist = useCallback(
    (force = false) => {
      const current = session.current;
      // A guest run could never be claimed, so it is not kept either.
      if (!current?.token) return;
      const now = Date.now();
      if (!force && now - lastSave.current < SAVE_INTERVAL_MS) return;
      lastSave.current = now;
      // Past the local limit the last save stays as it is, resumable from where it was.
      if (current.log.chars > TD_SAVED_LOG_MAX_CHARS) {
        markUnsaved(current, true);
        return;
      }
      try {
        saveRun(
          localStorage,
          storageKey,
          {
            id: current.id,
            config: current.config,
            token: current.token,
            tick: current.state.tick,
            wave: current.state.wave,
            over: current.state.over,
          },
          current.log,
        );
        markUnsaved(current, false);
      } catch {
        // Storage can be full or blocked; the run keeps playing and the player is told
        // that a reload would lose it.
        markUnsaved(current, true);
      }
    },
    [markUnsaved, storageKey],
  );

  /** The save as storage now holds it, for the lobby. */
  const refreshSaved = useCallback(() => {
    setSaved(readSavedSummary(storageKey));
  }, [storageKey]);

  const forget = useCallback(() => {
    try {
      clearRun(localStorage, storageKey);
    } catch {}
    setSaved(null);
  }, [storageKey]);

  useEffect(() => {
    // Guest runs are never kept, so a guest save left in this browser is removed.
    try {
      clearRun(localStorage, GUEST_STORAGE_KEY);
    } catch {}
    refreshSaved();
  }, [refreshSaved]);

  /** Publish a snapshot for the HUD. */
  const publish = useCallback((current: TowerDefenseSession) => {
    published.current = { tick: current.state.tick, version: current.version };
    setHud(snapshotRun(current.state));
  }, []);

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
    const unsettled = { ...base, claimed: false, reloadRequired: false };
    if (!current.token) {
      setOutcome({ ...unsettled, retryable: false, message: null });
      setPhase("over");
      forget();
      return;
    }
    setPhase("claiming");
    const snapshot = prepare();
    const response = await claimRun({
      token: current.token,
      actions: encodedLog(current.log),
      endTick: state.tick,
      simVersion: TD_SIM_VERSION,
    }).then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    if ("error" in response) {
      const { error } = response;
      const code =
        error instanceof TRPCClientError
          ? (error.data as { code?: string } | undefined)?.code
          : undefined;
      // The server refused to read the log itself; resubmitting it cannot change that.
      const rejected = code === "BAD_REQUEST";
      if (rejected) forget();
      else refreshSaved();
      setOutcome({
        ...unsettled,
        retryable: !rejected,
        message: rejected
          ? "This run's record could not be read, so it cannot be claimed."
          : error instanceof TRPCClientError && !isRetryableTrpcError(error)
            ? error.message
            : current.unsaved
              ? "Could not reach the server. Keep this tab open and try claiming again."
              : "Could not reach the server. Your run is saved; try claiming again.",
      });
      setPhase("over");
      return;
    }
    const { result } = response;
    if (result.success) {
      void applyClaim(
        { pointsEarned: result.pointsEarned ?? 0, wave: result.wave ?? state.wave },
        snapshot,
      );
      forget();
    } else if (result.alreadyClaimed) {
      // An earlier attempt paid out, but its response never arrived.
      void refresh();
      forget();
    } else if (result.permanent) {
      // The server refused the run itself; claiming it again can only repeat that.
      forget();
    } else refreshSaved();
    setOutcome({
      ...base,
      points: result.pointsEarned ?? base.points,
      claimed: result.success || !!result.alreadyClaimed,
      retryable: !result.permanent && !result.reloadRequired,
      reloadRequired: !!result.reloadRequired,
      message: result.message,
    });
    setPhase("over");
  }, [applyClaim, claimRun, forget, persist, prepare, refresh, refreshSaved]);

  /** End the run with a retreat, as the player could; used at the run's length limits. */
  const retreat = useCallback(
    (current: TowerDefenseSession) => {
      const quit: TdAction = [current.state.tick, "quit"];
      if (applyAction(current.state, quit)) appendToLog(current.log, quit);
      current.version++;
      current.events.push(...current.state.events);
      current.state.events.length = 0;
      publish(current);
      void claim();
    },
    [claim, publish],
  );

  const begin = useCallback(
    (
      config: TdRunConfig,
      token: string | null,
      restored?: { state: TdState; log: TdLogWriter },
    ) => {
      const id = nanoid();
      const state = restored?.state ?? createRun(config);
      state.recordEvents = true;
      state.events.length = 0;
      // A new run replaces whatever an earlier one left in storage.
      if (!restored) forget();
      session.current = {
        id,
        config,
        token,
        state,
        log: restored?.log ?? createLogWriter(),
        pending: 0,
        events: [],
        claimStarted: false,
        version: 0,
        unsaved: false,
      };
      published.current = null;
      setUnsaved(false);
      setOutcome(null);
      setSpeedState(1);
      setPhase("playing");
      setRunId(id);
      publish(session.current);
      persist(true);
      if (state.over) void claim();
    },
    [claim, forget, persist, publish],
  );

  /**
   * Start a signed run from a checkpoint, or a local guest run. A new run replaces the
   * saved one, so it starts only once the player chose to discard that save; the check
   * reads storage, which another tab may have written since the lobby did.
   */
  const start = useCallback(
    async (startWave: number, replaceSaved = false) => {
      if (!replaceSaved && readSavedSummary(storageKey)) {
        refreshSaved();
        showMutationToast({
          success: false,
          message: "Claim, resume or discard your saved run before starting a new one.",
        });
        return;
      }
      if (!userId) {
        begin({ seed: nanoid(), startWave: 1, bestWave: 0, dojo: {} }, null);
        return;
      }
      const result = await startRun({ startWave });
      if (!result.success || !result.token || !result.config) {
        showMutationToast(result);
        return;
      }
      begin(result.config as TdRunConfig, result.token);
    },
    [begin, refreshSaved, startRun, storageKey, userId],
  );

  /** Resume the saved run by replaying its log to the saved tick, a slice at a time. */
  const resume = useCallback(() => {
    const stored = loadSaved(storageKey);
    if (!stored) {
      showMutationToast({
        success: false,
        message: "This saved run could not be read, so it was discarded.",
      });
      forget();
      return;
    }
    const { head, chunks, tail, actions } = stored;
    const replay = createReplay(head.config, actions);
    const ticket = {};
    resuming.current = ticket;
    setIsResuming(true);
    const step = () => {
      if (resuming.current !== ticket) return;
      const result = advanceReplayFor(replay, head.tick, RESUME_SLICE_MS);
      if (!result) {
        setTimeout(step, 0);
        return;
      }
      resuming.current = null;
      setIsResuming(false);
      const { complete, log } = resumeLogWriter(
        { chunks, tail, tick: head.tick },
        actions,
        replay,
      );
      if (!complete) {
        // The save is rewritten from the shorter log.
        try {
          clearRun(localStorage, storageKey);
        } catch {}
        showMutationToast({
          success: false,
          message: `The game was updated since this run was saved, so it resumed at wave ${result.state.wave}.`,
        });
      }
      begin(head.config, head.token, { state: result.state, log });
    };
    step();
  }, [begin, forget, storageKey]);

  /** Apply a player action at the current tick and record it if the run accepted it. */
  const act = useCallback(
    (command: TdCommand) => {
      const current = session.current;
      if (!current || current.state.over) return false;
      if (
        current.log.count >= TD_MAX_ACTIONS - 1 ||
        current.log.chars >= TD_MAX_LOG_CHARS - LOG_RESERVE_CHARS
      ) {
        retreat(current);
        return false;
      }
      // The log carries -0 as 0, so the live run must see the value a replay will.
      const action = [
        current.state.tick,
        ...command.map((value) => (value === 0 ? 0 : value)),
      ];
      // Only what the log can carry is played, so a claim replays exactly this run.
      if (!isTdActionEncodable(action) || !applyAction(current.state, action))
        return false;
      appendToLog(current.log, action);
      current.version++;
      current.events.push(...current.state.events);
      current.state.events.length = 0;
      publish(current);
      if (current.state.over) void claim();
      else persist();
      return true;
    },
    [claim, persist, publish, retreat],
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
      while (
        current.pending >= TD_TICK_SECONDS &&
        stepped < MAX_TICKS_PER_FRAME &&
        current.state.tick < TD_MAX_TICKS
      ) {
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
      // A claim replays at most TD_MAX_TICKS, so the run ends there.
      if (current.state.tick >= TD_MAX_TICKS) {
        retreat(current);
        return;
      }
      persist();
    },
    [claim, persist, phase, retreat, speed],
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
    published.current = null;
    resuming.current = null;
    setIsResuming(false);
    setUnsaved(false);
    setOutcome(null);
    setRunId(null);
    setHud(null);
    setPhase("lobby");
    refreshSaved();
  }, [refreshSaved]);

  // Publish a fresh snapshot a few times a second while the run is on screen, skipping
  // refreshes while nothing moved (a draft, the claim or the results).
  useEffect(() => {
    if (phase === "lobby") return;
    const timer = setInterval(() => {
      const current = session.current;
      const last = published.current;
      if (
        current &&
        (!last || last.tick !== current.state.tick || last.version !== current.version)
      )
        publish(current);
    }, HUD_REFRESH_MS);
    return () => clearInterval(timer);
  }, [phase, publish]);

  const buyDojo = useCallback(
    async (upgradeId: TdDojoUpgrade) => {
      const snapshot = prepare();
      const result = await purchase({ upgradeId });
      if (
        result.success &&
        result.level !== undefined &&
        result.pointsSpent !== undefined
      )
        void applyPurchase(
          upgradeId,
          { level: result.level, pointsSpent: result.pointsSpent },
          snapshot,
        );
      else showMutationToast(result);
    },
    [applyPurchase, prepare, purchase],
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

  // A resume still replaying when the page goes away has nothing left to start.
  useEffect(
    () => () => {
      resuming.current = null;
    },
    [],
  );

  /** The live run, for handlers and the renderer; never read it while rendering. */
  const getSession = useCallback(() => session.current, []);

  return {
    getSession,
    runId,
    hud,
    phase,
    speed,
    outcome,
    saved,
    unsaved,
    isStarting,
    isResuming,
    isPurchasing,
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

/** The saved run's summary for the lobby, or null without a readable save. */
const readSavedSummary = (key: string) => {
  try {
    return readSavedRunSummary(localStorage, key);
  } catch {
    return null;
  }
};

/** The saved run with its decoded log, or null when it is missing or unreadable. */
const loadSaved = (key: string) => {
  let stored: ReturnType<typeof loadRun> = null;
  try {
    stored = loadRun(localStorage, key);
  } catch {
    return null;
  }
  if (!stored) return null;
  const actions = decodeTdActions(
    [...stored.chunks, stored.tail].filter((part) => part !== "").join(";"),
    LOG_LIMITS,
  );
  return actions ? { ...stored, actions } : null;
};

/** A copy of everything the HUD reads, so a render never observes the live run. */
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

/**
 * Advance a replay for about `budgetMs` of real time, in short steps between clock
 * checks. Returns the result once the replay stops, or null when the time ran out.
 */
const advanceReplayFor = (replay: TdReplay, endTick: number, budgetMs: number) => {
  const started = performance.now();
  for (;;) {
    const result = advanceReplay(replay, endTick, { ticks: RESUME_STEP_TICKS });
    if (result || performance.now() - started >= budgetMs) return result;
  }
};
