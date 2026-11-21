import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { showMutationToast } from "@/libs/toast";
import { decodeTdActions, isTdActionEncodable } from "@/libs/towerDefense/actionLog";
import { TD_TICK_SECONDS, tdMaxSpeed } from "@/libs/towerDefense/balance";
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
  type TdSavedRunHead,
} from "@/libs/towerDefense/savedRun";
import {
  advanceReplay,
  applyAction,
  createReplay,
  createRun,
  stepRun,
  type TdAction,
  type TdActionKind,
  type TdCommand,
  type TdReplay,
  type TdRunConfig,
  type TdState,
  tdRunPoints,
} from "@/libs/towerDefense/sim";
import { clamp } from "@/utils/math";
import type { QuestChallengeRequest } from "@/validators/questChallenge";
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

/**
 * What holds a run paused: the player's pause button, a panel covering the arena, or the
 * page hosting the game (a portal pausing it, an ad).
 */
export type TowerDefensePause = "player" | "panel" | "host";

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
  /** The run was a quest challenge. */
  challenge: boolean;
  /** The challenge run cleared its last wave. */
  won: boolean;
}

/** How the backend settled a claimed run. */
export interface TowerDefenseClaimResult {
  /** The run is settled for good: its save goes and it is never claimed again. */
  settled: boolean;
  claimed: boolean;
  retryable: boolean;
  reloadRequired: boolean;
  /** What the run earned, when the backend counted it. */
  points?: number;
  message: string | null;
}

/**
 * Where runs start and are claimed: the game server for signed-in players, or the device
 * itself for the standalone build. A run without a token is a guest run, never saved or
 * claimed.
 */
export interface TowerDefenseBackend {
  /** Local storage key of the saved run. */
  storageKey: string;
  /**
   * Whether runs are kept in local storage to resume after a reload; a host that allows
   * only its own saves (YouTube Playables) keeps runs in memory for the session.
   */
  saveRuns?: boolean;
  isStarting: boolean;
  /**
   * A run's config and token, or null once the backend has told the player why not. A
   * quest challenge takes its start wave and rules from the objective it names.
   */
  startRun: (
    startWave: number,
    challenge?: QuestChallengeRequest,
  ) => Promise<{ config: TdRunConfig; token: string | null } | null>;
  claimRun: (claim: {
    token: string;
    actions: string;
    endTick: number;
    state: TdState;
    /** Whether only this tab holds the run, which a retry message should say. */
    unsaved: boolean;
  }) => Promise<TowerDefenseClaimResult>;
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
/**
 * Actions that act on the battle itself wait for the run to resume, so a pause is a
 * breather for shopping and planning rather than a way to time a dodge or a cast.
 */
const PAUSED_REFUSED: ReadonlySet<TdActionKind> = new Set([
  "ult",
  "focus",
  "blink",
  "sub",
  "seal",
  "trap",
  "loot",
  "call",
]);
export const RETRY_SAVED_MESSAGE =
  "Could not reach the server. Your run is saved; try claiming again.";
export const RETRY_UNSAVED_MESSAGE =
  "Could not reach the server. Keep this tab open and try claiming again.";

/**
 * Drives a tower-defense run: steps the deterministic simulation from the render loop,
 * records every accepted action with its tick, saves the run locally so a reload resumes
 * it by replay, and claims the result through its backend once the hero falls or
 * retreats. A run without a token is played locally and neither claimed nor saved.
 */
export const useTowerDefenseSession = (backend: TowerDefenseBackend) => {
  const { storageKey, startRun, claimRun } = backend;
  const saveRuns = backend.saveRuns !== false;
  const runs = useMemo(() => savedRuns(storageKey, saveRuns), [saveRuns, storageKey]);
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
  const [pauses, setPauses] = useState<readonly TowerDefensePause[]>([]);
  const paused = pauses.length > 0;
  /** The host holds the run; read by controls that must not act until it resumes. */
  const isHostHeld = useRef(false);
  const [outcome, setOutcome] = useState<TowerDefenseOutcome | null>(null);
  const [saved, setSaved] = useState<ReturnType<typeof readSavedRunHead>>(null);
  const [isResuming, setIsResuming] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  /** An immutable copy of the run for rendering; the live state stays in `session`. */
  const [hud, setHud] = useState<TdState | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

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
      if (!saveRuns || !current?.token || current.released) return;
      const now = Date.now();
      if (!force && now - lastSave.current < SAVE_INTERVAL_MS) return;
      lastSave.current = now;
      // Past the local limit the last save stays as it is, resumable from where it was.
      if (current.log.chars > TD_SAVED_LOG_MAX_CHARS) {
        markUnsaved(current, true);
        return;
      }
      if (current.hasSaved && runs.head()?.id !== current.id) {
        loseSave(current);
        return;
      }
      const isSaved = runs.save(
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
    [loseSave, markUnsaved, runs, saveRuns],
  );

  /** The save as storage now holds it, for the lobby. */
  const refreshSaved = useCallback(() => {
    setSaved(runs.head());
  }, [runs]);

  const forget = useCallback(() => {
    runs.clear();
    setSaved(null);
  }, [runs]);

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
      challenge: !!state.config.challenge,
      won: state.won,
    };
    persist(true);
    if (!token) {
      setOutcome({
        ...base,
        claimed: false,
        reloadRequired: false,
        retryable: false,
        message: null,
      });
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
      runs.clearSettled(token);
      refreshSaved();
    };
    setPhase("claiming");
    const result = await claimRun({
      token,
      actions: encodedLog(current.log),
      endTick: state.tick,
      state,
      unsaved: current.unsaved,
    });
    if (result.settled) settle();
    else refreshSaved();
    setOutcome({
      ...base,
      points: result.points ?? base.points,
      claimed: result.claimed,
      retryable: result.retryable,
      reloadRequired: result.reloadRequired,
      // Another tab may have taken the save over while the claim was in flight.
      message:
        result.message === RETRY_SAVED_MESSAGE && current.unsaved
          ? RETRY_UNSAVED_MESSAGE
          : result.message,
    });
    setPhase("over");
  }, [claimRun, forget, persist, refreshSaved, runs]);

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
      // The player's own pauses end with the old run; a host's pause holds until it resumes.
      setPauses((current) => current.filter((reason) => reason === "host"));
      setPhase("playing");
      setRunId(id);
      publish(session.current);
      persist(true);
      if (state.over) void claim();
    },
    [claim, forget, persist, publish],
  );

  /**
   * Start a signed run from a checkpoint or for a quest challenge, or a local guest run.
   * A new run replaces the saved one, so it starts only while storage still holds the
   * save the player chose to discard, or none without `replaceSaved`. Storage is read
   * again once the server answers, since another tab may have written it in the meantime.
   */
  const start = useCallback(
    async (
      startWave: number,
      replaceSaved = false,
      challenge?: QuestChallengeRequest,
    ) => {
      const chosen = replaceSaved ? saved : null;
      /** Whether storage still holds the save the player decided about. */
      const isUnchanged = () => {
        if (isSameSavedRun(runs.head(), chosen)) return true;
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
      const ticket = {};
      starting.current = ticket;
      const result = await startRun(startWave, challenge);
      // A run resumed or left while this request was pending keeps the page.
      if (starting.current !== ticket) return;
      starting.current = null;
      if (!result) return;
      if (!isUnchanged()) return;
      begin(result.config, result.token);
    },
    [begin, refreshSaved, runs, saved, startRun],
  );

  /** Discard the save the lobby shows, unless another tab wrote or removed it since. */
  const discardSaved = useCallback(() => {
    if (isSameSavedRun(runs.head(), saved)) {
      forget();
      return;
    }
    refreshSaved();
    showMutationToast({
      success: false,
      message: "Your saved run changed in another tab, so it was kept. Check it again.",
    });
  }, [forget, refreshSaved, runs, saved]);

  /** Resume the saved run by replaying its log to the saved tick, a slice at a time. */
  const resume = useCallback(() => {
    const stored = runs.load();
    // Another tab may have replaced the save the lobby shows; the player chooses again.
    if (stored && !isSameSavedRun(stored.head, saved)) {
      refreshSaved();
      showMutationToast({
        success: false,
        message: "Your saved run changed in another tab. Check it before resuming.",
      });
      return;
    }
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
      if (!isSameSavedRun(runs.head(), head)) {
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
        runs.clear();
        showMutationToast({
          success: false,
          message: `The game was updated since this run was saved, so it resumed at wave ${result.state.wave}.`,
        });
      }
      begin(head.config, head.token, { state: result.state, log });
    };
    step();
  }, [begin, forget, refreshSaved, runs, saved]);

  /** Apply a player action at the current tick and record it if the run accepted it. */
  const act = useCallback(
    (command: TdCommand) => {
      const current = session.current;
      if (!current || current.state.over) return false;
      // A host holding the run takes every command, retreat included, until it resumes.
      if (pauses.includes("host")) return false;
      if (paused && PAUSED_REFUSED.has(command[0])) return false;
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
    [claim, paused, pauses, persist, publish, retreat],
  );

  /** Advance by real elapsed seconds at the chosen speed; called every frame. */
  const advance = useCallback(
    (seconds: number) => {
      const current = session.current;
      if (!current || current.state.over || phase !== "playing") return;
      // Time spent paused is not owed to the run when it resumes.
      if (paused) {
        current.pending = 0;
        return;
      }
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
    [claim, paused, persist, phase, retreat, speed],
  );

  /**
   * Hold or release the run for one reason; it runs again once no reason holds it. While
   * the host holds it, the player's own pauses stay as they were: one added would outlast
   * the host's, and one released would let the run go on when the host resumes.
   */
  const setPaused = useCallback((reason: TowerDefensePause, on: boolean) => {
    if (reason === "host") isHostHeld.current = on;
    else if (isHostHeld.current) return;
    setPauses((current) =>
      on
        ? current.includes(reason)
          ? current
          : [...current, reason]
        : current.filter((held) => held !== reason),
    );
  }, []);

  /** Change the game speed; the host holding the run keeps it as it was. */
  const setSpeed = useCallback((value: number) => {
    if (isHostHeld.current) return;
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

  // A tab that starts or resumes a run takes the save over, and one that discards or
  // settles it removes it; either way this session stops writing it.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      const current = session.current;
      if (!current?.hasSaved || current.released) return;
      if (runs.head()?.id !== current.id) loseSave(current);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [loseSave, runs, storageKey]);

  // Save on tab hide so a closed tab resumes where it was.
  useEffect(() => {
    // A host that forbids watching page visibility keeps no run to save either.
    if (!saveRuns) return;
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
  }, [persist, saveRuns]);

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
    pauses,
    paused,
    outcome,
    saved,
    unsaved,
    isStarting: backend.isStarting,
    isResuming,
    start,
    resume,
    act,
    advance,
    setSpeed,
    setPaused,
    retryClaim,
    leave,
    discardSaved,
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

/**
 * The device storage a session keeps its run in. Where runs are not kept it holds none,
 * so nothing left on the device by another build is offered, replaced or removed.
 */
const savedRuns = (key: string, kept: boolean) =>
  kept
    ? {
        head: () => readSavedRunHead(key),
        load: () => loadRun(key),
        save: (head: TdSavedRunHead, log: TdLogWriter) => saveRun(key, head, log),
        clear: () => clearRun(key),
        clearSettled: (token: string) => clearSettledRun(key, token),
      }
    : {
        head: () => null,
        load: () => null,
        save: () => false,
        clear: () => undefined,
        clearSettled: () => undefined,
      };
