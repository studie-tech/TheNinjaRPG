import { TRPCClientError } from "@trpc/client";
import { getQueryKey } from "@trpc/react-query";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getDojoPurchaseUpdate, getRunClaimUpdate } from "@/deltas/towerDefense";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { showMutationToast } from "@/libs/toast";
import { decodeTdActions, isTdActionEncodable } from "@/libs/towerDefense/actionLog";
import { TD_TICK_SECONDS, tdMaxSpeed } from "@/libs/towerDefense/balance";
import type { TdDojoUpgrade } from "@/libs/towerDefense/content";
import {
  appendToLog,
  clearRun,
  clearSettledRun,
  createLogWriter,
  encodedLog,
  isSameSavedRun,
  loadRun,
  readSavedRunHead,
  saveRun,
  TD_SAVED_LOG_MAX_CHARS,
  type TdLogWriter,
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
  type TdReplay,
  type TdRunConfig,
  type TdState,
  tdRunPoints,
} from "@/libs/towerDefense/sim";
import { isRetryableTrpcError } from "@/utils/error";
import { clamp } from "@/utils/math";
import { useUserInfo } from "@/utils/UserContext";
import {
  TD_MAX_ACTIONS,
  TD_MAX_LOG_CHARS,
  TD_MAX_TICKS,
} from "@/validators/towerDefense";

/** A run in progress, kept outside React so the frame loop never waits on a render. */
interface TowerDefenseSession {
  id: string;
  config: TdRunConfig;
  token: string | null;
  state: TdState;
  log: TdLogWriter;
  /** Accumulated real seconds not yet simulated. */
  pending: number;
  claimStarted: boolean;
  /** Counts accepted actions, so the HUD can tell when a paused run changed. */
  version: number;
  /** Whether the latest save failed or the log outgrew local storage. */
  unsaved: boolean;
  /** Whether this session has written the save, which from then on is its own. */
  hasSaved: boolean;
  /** The run was settled, or another session took its save over, so it is not saved again. */
  released: boolean;
}

type TowerDefensePhase = "lobby" | "playing" | "claiming" | "over";

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
const GUEST_STORAGE_KEY = "towerDefenseRun:guest";
const RETRY_SAVED_MESSAGE =
  "Could not reach the server. Your run is saved; try claiming again.";
const RETRY_UNSAVED_MESSAGE =
  "Could not reach the server. Keep this tab open and try claiming again.";

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
  /** Identifies the start in flight; a resume, leaving or unmounting cancels it. */
  const starting = useRef<object | null>(null);
  const [phase, setPhase] = useState<TowerDefensePhase>("lobby");
  const [speed, setSpeedState] = useState(1);
  const [outcome, setOutcome] = useState<TowerDefenseOutcome | null>(null);
  const [saved, setSaved] = useState<ReturnType<typeof readSavedRunHead>>(null);
  const [isResuming, setIsResuming] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  /** An immutable copy of the run for rendering; the live state stays in `session`. */
  const [hud, setHud] = useState<TdState | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const utils = api.useUtils();
  const { prepareUserUpdate, updateUser, refreshUser } = useUserInfo();
  const { prepareUpdate, updateCache } = useQueryCacheUpdate<
    RouterOutputs["towerDefense"]["getProgress"]
  >(getQueryKey(api.towerDefense.getProgress, undefined, "query"));
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

  /** Another session took the save over or removed it, so only this tab holds the run. */
  const loseSave = useCallback(
    (current: TowerDefenseSession) => {
      current.released = true;
      markUnsaved(current, true);
      setOutcome((outcome) =>
        outcome?.message === RETRY_SAVED_MESSAGE
          ? { ...outcome, message: RETRY_UNSAVED_MESSAGE }
          : outcome,
      );
    },
    [markUnsaved],
  );

  const persist = useCallback(
    (force = false) => {
      const current = session.current;
      // A guest run could never be claimed, so it is not kept either.
      if (!current?.token || current.released) return;
      const now = Date.now();
      if (!force && now - lastSave.current < SAVE_INTERVAL_MS) return;
      lastSave.current = now;
      // Past the local limit the last save stays as it is, resumable from where it was.
      if (current.log.chars > TD_SAVED_LOG_MAX_CHARS) {
        markUnsaved(current, true);
        return;
      }
      if (current.hasSaved && readSavedRunHead(storageKey)?.id !== current.id) {
        loseSave(current);
        return;
      }
      const isSaved = saveRun(
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
      // Storage can be full or blocked; the run keeps playing and the player is told
      // that a reload would lose it.
      if (isSaved) current.hasSaved = true;
      markUnsaved(current, !isSaved);
    },
    [loseSave, markUnsaved, storageKey],
  );

  /** The save as storage now holds it, for the lobby. */
  const refreshSaved = useCallback(() => {
    setSaved(readSavedRunHead(storageKey));
  }, [storageKey]);

  const forget = useCallback(() => {
    clearRun(storageKey);
    setSaved(null);
  }, [storageKey]);

  useEffect(() => {
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
    const { state, token } = current;
    const base = {
      wave: state.wave,
      kills: state.kills,
      points: tdRunPoints(state),
      quit: state.quit,
    };
    persist(true);
    const unsettled = { ...base, claimed: false, reloadRequired: false };
    if (!token) {
      setOutcome({ ...unsettled, retryable: false, message: null });
      setPhase("over");
      forget();
      return;
    }
    /**
     * The run is settled for good, so it is never written again and its save goes, unless
     * another run took storage over while the claim was in flight.
     */
    const settle = () => {
      current.released = true;
      clearSettledRun(storageKey, token);
      refreshSaved();
    };
    setPhase("claiming");
    const snapshot = prepareUpdate();
    const userRevision = prepareUserUpdate();
    const response = await claimRun({
      token,
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
      if (rejected) settle();
      else refreshSaved();
      setOutcome({
        ...unsettled,
        retryable: !rejected,
        message: rejected
          ? "This run's record could not be read, so it cannot be claimed."
          : error instanceof TRPCClientError && !isRetryableTrpcError(error)
            ? error.message
            : current.unsaved
              ? RETRY_UNSAVED_MESSAGE
              : RETRY_SAVED_MESSAGE,
      });
      setPhase("over");
      return;
    }
    const { result } = response;
    if (result.success) {
      void updateCache(
        getRunClaimUpdate({
          pointsEarned: result.pointsEarned ?? 0,
          wave: result.wave ?? state.wave,
        }),
        snapshot,
      );
      // The daily Guard Hall duty and its reward.
      void updateUser(result, { revision: userRevision });
      settle();
    } else if (result.alreadyClaimed) {
      // An earlier attempt paid out, but its response never arrived.
      void utils.towerDefense.getProgress.invalidate();
      void refreshUser();
      settle();
    } else if (result.permanent) {
      // The server refused the run itself; claiming it again can only repeat that.
      settle();
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
  }, [
    claimRun,
    forget,
    persist,
    prepareUpdate,
    prepareUserUpdate,
    refreshSaved,
    refreshUser,
    storageKey,
    updateCache,
    updateUser,
    utils,
  ]);

  /** End the run with a retreat, as the player could; used at the run's length limits. */
  const retreat = useCallback(
    (current: TowerDefenseSession) => {
      const quit: TdAction = [current.state.tick, "quit"];
      if (applyAction(current.state, quit)) recordAction(current, quit);
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
      // A new run replaces whatever an earlier one left in storage.
      if (!restored) forget();
      session.current = {
        id,
        config,
        token,
        state,
        log: restored?.log ?? createLogWriter(),
        pending: 0,
        claimStarted: false,
        version: 0,
        unsaved: false,
        hasSaved: false,
        released: false,
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
   * saved one, so it starts only while storage still holds the save the player chose to
   * discard, or none without `replaceSaved`. Storage is read again once the server
   * answers, since another tab may have written it in the meantime.
   */
  const start = useCallback(
    async (startWave: number, replaceSaved = false) => {
      const chosen = replaceSaved ? saved : null;
      /** Whether storage still holds the save the player decided about. */
      const isUnchanged = () => {
        if (isSameSavedRun(readSavedRunHead(storageKey), chosen)) return true;
        refreshSaved();
        showMutationToast({
          success: false,
          message: replaceSaved
            ? "Your saved run changed in another tab. Check it before starting a new run."
            : "Claim, resume or discard your saved run before starting a new one.",
        });
        return false;
      };
      if (!isUnchanged()) return;
      if (!userId) {
        begin({ seed: nanoid(), startWave: 1, bestWave: 0, level: 1, dojo: {} }, null);
        return;
      }
      const ticket = {};
      starting.current = ticket;
      const result = await startRun({ startWave });
      // A run resumed or left while this request was pending keeps the page.
      if (starting.current !== ticket) return;
      starting.current = null;
      if (!result.success || !result.token || !result.config) {
        showMutationToast(result);
        return;
      }
      if (!isUnchanged()) return;
      begin(result.config, result.token);
    },
    [begin, refreshSaved, saved, startRun, storageKey, userId],
  );

  /** Discard the save the lobby shows, unless another tab wrote or removed it since. */
  const discardSaved = useCallback(() => {
    if (isSameSavedRun(readSavedRunHead(storageKey), saved)) {
      forget();
      return;
    }
    refreshSaved();
    showMutationToast({
      success: false,
      message: "Your saved run changed in another tab, so it was kept. Check it again.",
    });
  }, [forget, refreshSaved, saved, storageKey]);

  /** Resume the saved run by replaying its log to the saved tick, a slice at a time. */
  const resume = useCallback(() => {
    const stored = loadRun(storageKey);
    const actions = stored && decodeTdActions(stored.text);
    if (!stored || !actions) {
      showMutationToast({
        success: false,
        message: "This saved run could not be read, so it was discarded.",
      });
      forget();
      return;
    }
    const { head } = stored;
    const replay = createReplay(head.config, actions);
    const ticket = {};
    resuming.current = ticket;
    starting.current = null;
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
      // Another tab may have started, resumed or discarded a run while this one replayed;
      // its save is left alone.
      if (!isSameSavedRun(readSavedRunHead(storageKey), head)) {
        refreshSaved();
        showMutationToast({
          success: false,
          message: "Your saved run changed in another tab. Check it before resuming.",
        });
        return;
      }
      // A replay that stopped short of the save (rules changed by a deploy can end or stall
      // it earlier) continues from where it stopped, with a log of only the actions it
      // applied, so the log and the save rewritten from it describe that run.
      const log = createLogWriter();
      for (const action of actions.slice(0, replay.index)) appendToLog(log, action);
      if (replay.index !== actions.length || result.state.tick !== head.tick) {
        clearRun(storageKey);
        showMutationToast({
          success: false,
          message: `The game was updated since this run was saved, so it resumed at wave ${result.state.wave}.`,
        });
      }
      begin(head.config, head.token, { state: result.state, log });
    };
    step();
  }, [begin, forget, refreshSaved, storageKey]);

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
      recordAction(current, action);
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
    setSpeedState(clamp(value, 1, max));
  }, []);

  const retryClaim = useCallback(() => {
    if (session.current) session.current.claimStarted = false;
    void claim();
  }, [claim]);

  const leave = useCallback(() => {
    session.current = null;
    published.current = null;
    resuming.current = null;
    starting.current = null;
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
      const snapshot = prepareUpdate();
      const result = await purchase({ upgradeId });
      if (
        result.success &&
        result.level !== undefined &&
        result.pointsSpent !== undefined
      )
        void updateCache(
          getDojoPurchaseUpdate(upgradeId, {
            level: result.level,
            pointsSpent: result.pointsSpent,
          }),
          snapshot,
        );
      else showMutationToast(result);
    },
    [prepareUpdate, purchase, updateCache],
  );

  // A tab that starts or resumes a run takes the save over, and one that discards or
  // settles it removes it; either way this session stops writing it.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      const current = session.current;
      if (!current?.hasSaved || current.released) return;
      if (readSavedRunHead(storageKey)?.id !== current.id) loseSave(current);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [loseSave, storageKey]);

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

  // A resume still replaying or a start still pending when the page goes away has
  // nothing left to begin.
  useEffect(
    () => () => {
      resuming.current = null;
      starting.current = null;
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
    discardSaved,
    buyDojo,
  };
};

/** Record an action the run accepted. */
const recordAction = (current: TowerDefenseSession, action: TdAction) => {
  appendToLog(current.log, action);
  current.version++;
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
