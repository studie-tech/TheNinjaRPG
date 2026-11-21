import { getQueryKey } from "@trpc/react-query";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import {
  getChakraStormClaimUpdate,
  getChakraStormTrainingUpdate,
} from "@/deltas/chakraStorm";
import type { CsSfx } from "@/drizzle/constants";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { encodeCsActions } from "@/libs/chakraStorm/actionLog";
import {
  CS_JUTSU_INFO,
  CS_RUN_SECONDS,
  CS_STAGE_INFO,
  CS_TICK_SECONDS,
  type CsStage,
  type CsTraining,
  csNoTraining,
} from "@/libs/chakraStorm/content";
import {
  buyCsTraining,
  CS_EMPTY_PROGRESS,
  type CsProgress,
  type CsRunResult,
  type CsUnlockGoal,
  csNextUnlock,
  parseCsProgress,
  settleCsRun,
} from "@/libs/chakraStorm/progress";
import {
  applyCsAction,
  CS_SIM_VERSION,
  type CsAction,
  type CsEvent,
  type CsRunConfig,
  type CsState,
  createCsRun,
  csAwakenable,
  csCanStep,
  csSeconds,
  stepCs,
} from "@/libs/chakraStorm/sim";
import { showMutationToast } from "@/libs/toast";
import { useUserInfo } from "@/utils/UserContext";
import type { QuestChallengeRequest } from "@/validators/questChallenge";

/** The most ticks one frame simulates, so a stalled tab catches up gently. */
const MAX_TICKS_PER_FRAME = 6;
/** How often the HUD snapshot refreshes while nothing else changes it. */
const HUD_INTERVAL_MS = 120;
/** How long a banner stays on screen. */
const ANNOUNCEMENT_MS = 2600;
/** How long a milestone, such as opening a region, stays on screen. */
const MILESTONE_MS = 4000;
const PROGRESS_STORAGE_KEY = "chakraStorm:progress";

export type ChakraStormPhase = "lobby" | "playing" | "over";

/** A finished run as the results screen shows it. */
export interface ChakraStormOutcome extends CsRunResult {
  intel: number;
  isBest: boolean;
  /** A region this run opened. */
  unlocked?: CsStage;
  /**
   * Where the rewards stand: kept on this device for guests, or for a signed-in player
   * being verified, paid, or refused with a message (and whether a retry can help).
   */
  claim: "local" | "pending" | "paid" | "failed";
  message?: string;
  retryable?: boolean;
  dailyReward?: { ryo: number; prestige: number; villageTokens: number };
  /** The quest objective this run was a challenge for. */
  challenge?: QuestChallengeRequest;
}

/** A moment worth a banner across the battlefield. */
export interface ChakraStormAnnouncement {
  id: number;
  title: string;
  detail?: string;
  tone: "danger" | "reward" | "info";
  /** A fanfare for a moment no simulation event sounds, such as opening a region. */
  sound?: CsSfx;
}

/** Seconds before the reinforcements arrive when the run says they are close. */
const REINFORCEMENT_WARNING_SECONDS = 60;

/**
 * A Chakra Storm run in this tab and the progress behind it. Signed-in players' runs are
 * signed by the server when they start and claimed when they end: the server replays the
 * action log and pays intel, region records and the daily scouting report, and the
 * Training Hall spends that server-held intel. Guests play the same game with progress
 * kept on their device. The live simulation stays in a ref the renderer reads every
 * frame; the HUD renders an immutable snapshot. The walking direction comes from
 * `setMove`, and each change is recorded as an action at its tick, so the action log
 * replays the run exactly.
 */
export const useChakraStormRun = (userId: string | undefined) => {
  const signedIn = !!userId;
  const session = useRef<{
    state: CsState;
    pending: number;
    log: [number, CsAction][];
    /** The server's signature on this run; null for a guest's. */
    token: string | null;
    /** The direction the player holds, applied at the next tick. */
    move: number;
    publishedAt: number;
    /** The region this run opens once it lasts long enough. */
    goal: CsUnlockGoal | null;
    /** The region's longest run before this one, in seconds. */
    record: number | null;
    /** The quest objective this run is a challenge for. */
    challenge?: QuestChallengeRequest;
  } | null>(null);
  const [phase, setPhase] = useState<ChakraStormPhase>("lobby");
  const [runId, setRunId] = useState<string | null>(null);
  const [hud, setHud] = useState<ChakraStormHud | null>(null);
  const [paused, setPausedState] = useState(false);
  const [localProgress, setLocalProgress] = useState<CsProgress>(CS_EMPTY_PROGRESS);
  const [outcome, setOutcome] = useState<ChakraStormOutcome | null>(null);
  const [goal, setGoal] = useState<CsUnlockGoal | null>(null);
  const [record, setRecord] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState<ChakraStormAnnouncement | null>(
    null,
  );
  const pausedRef = useRef(false);
  const localRef = useRef(localProgress);
  const announcementTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Server progress for signed-in players
  const utils = api.useUtils();
  const { prepareUserUpdate, updateUser } = useUserInfo();
  const progressQuery = api.chakraStorm.getProgress.useQuery(undefined, {
    enabled: signedIn,
  });
  const { prepareUpdate, updateCache } = useQueryCacheUpdate<CsProgress>(
    getQueryKey(api.chakraStorm.getProgress, undefined, "query"),
  );
  const { mutateAsync: startSigned, isPending: isStarting } =
    api.chakraStorm.startRun.useMutation();
  // A claim uploads a long log and replays it, so it travels alone.
  const { mutateAsync: claimSigned } = api.chakraStorm.claimRun.useMutation({
    meta: { handlesTransportError: true },
    trpc: { context: { skipBatch: true } },
  });
  const { mutateAsync: trainSigned, isPending: isTraining } =
    api.chakraStorm.train.useMutation();
  const progress = signedIn ? (progressQuery.data ?? CS_EMPTY_PROGRESS) : localProgress;

  useEffect(() => {
    const stored = readProgress();
    localRef.current = stored;
    setLocalProgress(stored);
    return () => {
      if (announcementTimer.current) clearTimeout(announcementTimer.current);
    };
  }, []);

  const saveLocal = useCallback((next: CsProgress) => {
    localRef.current = next;
    setLocalProgress(next);
    writeProgress(next);
  }, []);

  /** A milestone banner holds the field until this time; lesser banners wait it out. */
  const milestoneUntil = useRef(0);
  const announce = useCallback(
    (next: Omit<ChakraStormAnnouncement, "id">, milestone = false) => {
      const now = performance.now();
      if (!milestone && now < milestoneUntil.current) return;
      const duration = milestone ? MILESTONE_MS : ANNOUNCEMENT_MS;
      if (milestone) milestoneUntil.current = now + duration;
      if (announcementTimer.current) clearTimeout(announcementTimer.current);
      setAnnouncement({ ...next, id: now });
      announcementTimer.current = setTimeout(() => setAnnouncement(null), duration);
    },
    [],
  );

  const publish = useCallback((now = performance.now()) => {
    const current = session.current;
    if (!current) return;
    current.publishedAt = now;
    setHud(snapshotRun(current.state));
  }, []);

  /** Ask the server to verify and pay a finished signed run; safe to call again. */
  const claim = useCallback(async () => {
    const current = session.current;
    if (!current?.token || !current.state.over) return;
    const { state } = current;
    setOutcome((previous) =>
      previous ? { ...previous, claim: "pending", message: undefined } : previous,
    );
    const snapshot = prepareUpdate();
    const revision = prepareUserUpdate();
    const response = await claimSigned({
      token: current.token,
      actions: encodeCsActions(current.log),
      endTick: state.tick,
      simVersion: CS_SIM_VERSION,
    }).then(
      (result) => ({ result }),
      () => ({ result: null }),
    );
    const { result } = response;
    if (!result) {
      setOutcome((previous) =>
        previous
          ? {
              ...previous,
              claim: "failed",
              retryable: true,
              message:
                "We could not reach the server to verify this run. Keep this tab open and try again.",
            }
          : previous,
      );
      return;
    }
    if (result.success) {
      // A quest challenge pays no intel and sets no region record.
      if (!state.config.challenge)
        void updateCache(
          getChakraStormClaimUpdate({
            intelEarned: result.intelEarned ?? 0,
            stage: state.config.stage,
            record: result.record ?? null,
          }),
          snapshot,
        );
      void updateUser(result, { revision });
    } else if (result.alreadyClaimed) void utils.chakraStorm.getProgress.invalidate();
    setOutcome((previous) =>
      previous
        ? {
            ...previous,
            claim: result.success || result.alreadyClaimed ? "paid" : "failed",
            intel: result.intelEarned ?? 0,
            isBest: !!result.record,
            unlocked: result.unlocked,
            dailyReward: result.dailyReward,
            message: result.message,
            retryable: !result.permanent,
          }
        : previous,
    );
  }, [claimSigned, prepareUpdate, prepareUserUpdate, updateCache, updateUser, utils]);

  const finish = useCallback(
    (state: CsState) => {
      const run: CsRunResult = {
        stage: state.config.stage,
        seconds: Math.floor(csSeconds(state)),
        kills: state.kills,
        level: state.hero.level,
        won: state.won,
        bosses: state.bossesKilled,
      };
      const challenge = session.current?.challenge;
      setPhase("over");
      if (session.current?.token) {
        setOutcome({ ...run, intel: 0, isBest: false, claim: "pending", challenge });
        void claim();
        return;
      }
      const settled = settleCsRun(localRef.current, run);
      saveLocal(settled.progress);
      setOutcome({
        ...run,
        intel: settled.intel,
        isBest: settled.isBest,
        unlocked: settled.unlocked,
        claim: "local",
      });
    },
    [claim, saveLocal],
  );

  /** Banners for the events the renderer is about to draw. */
  const announceEvents = useCallback(
    (events: CsEvent[]) => {
      for (const event of events) {
        if (event.type === "boss")
          announce({
            title: event.name,
            detail: "A hunter has picked up your trail",
            tone: "danger",
          });
        else if (event.type === "swarm")
          announce({
            title: "Ambush!",
            detail: "Hostiles close in from every side",
            tone: "danger",
          });
        else if (event.type === "awaken")
          announce({
            title: CS_JUTSU_INFO[event.jutsu].awakening.name,
            detail: `${CS_JUTSU_INFO[event.jutsu].name} awakens`,
            tone: "reward",
          });
        else if (event.type === "revive")
          announce({ title: "Second Wind", detail: "You rise again", tone: "reward" });
        else if (event.type === "pickup" && event.kind === "scroll" && event.value > 1)
          announce({ title: `Treasure scroll: ${event.value} arts`, tone: "reward" });
        else if (event.type === "pickup" && event.kind === "talisman")
          announce({
            title: "Gust talisman",
            detail: "Every orb rushes to you",
            tone: "info",
          });
      }
    },
    [announce],
  );

  const act = useCallback(
    (action: CsAction) => {
      const current = session.current;
      if (!current || !applyCsAction(current.state, action)) return false;
      current.log.push([current.state.tick, action]);
      if (current.state.over) finish(current.state);
      publish();
      return true;
    },
    [finish, publish],
  );

  /**
   * Start a run in a region: a signed run for players, or a local one for guests. A quest
   * challenge takes its region and survival time from the objective the server checks.
   */
  const start = useCallback(
    async (requested: CsStage, challengeRequest?: QuestChallengeRequest) => {
      let seed = nanoid();
      let token: string | null = null;
      let training = localRef.current.training;
      let stage = requested;
      let challenge: CsRunConfig["challenge"];
      if (signedIn) {
        const result = await startSigned({
          stage: requested,
          challenge: challengeRequest,
        }).catch(() => null);
        if (!result?.success || !result.token || !result.seed) {
          if (result) showMutationToast(result);
          return;
        }
        seed = result.seed;
        token = result.token;
        training = { ...csNoTraining(), ...result.training };
        stage = result.stage ?? requested;
        challenge = result.challenge;
      }
      const runRecord = progress.stages[stage]?.seconds ?? null;
      // A challenge opens no region, so it has no unlock to aim for.
      const runGoal = challenge ? null : csNextUnlock(progress, stage);
      session.current = {
        state: createCsRun(seed, { stage, training: { ...training }, challenge }),
        pending: 0,
        log: [],
        token,
        move: -1,
        publishedAt: 0,
        goal: runGoal,
        record: runRecord,
        challenge: challenge && challengeRequest,
      };
      setGoal(runGoal);
      setRecord(runRecord);
      pausedRef.current = false;
      setPausedState(false);
      setOutcome(null);
      setAnnouncement(null);
      milestoneUntil.current = 0;
      setRunId(seed);
      setPhase("playing");
      publish();
    },
    [progress, publish, signedIn, startSigned],
  );

  /**
   * Leave the field. A run still going pauses instead, so the player sees what giving up
   * would cost before choosing to; leaving from the results returns to the lobby.
   */
  const leave = useCallback(() => {
    const current = session.current;
    if (current && !current.state.over) {
      pausedRef.current = true;
      setPausedState(true);
      return;
    }
    session.current = null;
    setRunId(null);
    setHud(null);
    setAnnouncement(null);
    setPhase("lobby");
  }, []);

  const setPaused = useCallback((value: boolean) => {
    pausedRef.current = value;
    setPausedState(value);
  }, []);

  /**
   * Buy the next Training Hall level with server-held or device-held intel; true once the
   * level is bought.
   */
  const train = useCallback(
    async (id: CsTraining) => {
      if (!signedIn) {
        const next = buyCsTraining(localRef.current, id);
        if (next) saveLocal(next);
        return !!next;
      }
      const snapshot = prepareUpdate();
      const result = await trainSigned({ id }).catch(() => null);
      if (!result) return false;
      if (
        result.success &&
        result.level !== undefined &&
        result.intelSpent !== undefined
      ) {
        void updateCache(
          getChakraStormTrainingUpdate(id, {
            level: result.level,
            intelSpent: result.intelSpent,
          }),
          snapshot,
        );
        return true;
      }
      showMutationToast(result);
      return false;
    },
    [prepareUpdate, saveLocal, signedIn, trainSigned, updateCache],
  );

  /** Hold a walking direction (0-15) or -1 to stand; recorded when the next tick runs. */
  const setMove = useCallback((direction: number) => {
    if (session.current) session.current.move = direction;
  }, []);

  /** Advance by real elapsed seconds; the renderer calls this every frame. */
  const advance = useCallback(
    (seconds: number) => {
      const current = session.current;
      if (!current || current.state.over) return;
      const { state } = current;
      if (pausedRef.current || !csCanStep(state)) {
        current.pending = 0;
        return;
      }
      current.pending = Math.min(
        current.pending + seconds,
        MAX_TICKS_PER_FRAME * CS_TICK_SECONDS,
      );
      const level = state.hero.level;
      const seen = state.events.length;
      const before = csSeconds(state);
      while (current.pending >= CS_TICK_SECONDS && csCanStep(state)) {
        current.pending -= CS_TICK_SECONDS;
        if (current.move !== state.hero.move) {
          const action: CsAction = ["move", current.move];
          if (applyCsAction(state, action)) current.log.push([state.tick, action]);
        }
        stepCs(state);
      }
      if (state.events.length > seen) announceEvents(state.events.slice(seen));
      const after = csSeconds(state);
      const endless = !!CS_STAGE_INFO[state.config.stage].endless;
      const reached = (seconds: number) => before < seconds && after >= seconds;
      if (current.goal && reached(current.goal.seconds))
        announce(
          {
            title: `${CS_STAGE_INFO[current.goal.stage].name} is open`,
            detail: "Hold out until the reinforcements arrive",
            tone: "reward",
            sound: "chime",
          },
          true,
        );
      else if (
        endless &&
        current.record !== null &&
        current.record > 0 &&
        !state.over &&
        reached(current.record)
      )
        announce(
          {
            title: "New personal best",
            detail: "Every second from here beats your longest cover",
            tone: "reward",
            sound: "chime",
          },
          true,
        );
      else if (
        !endless &&
        !state.over &&
        !state.config.challenge &&
        reached(CS_RUN_SECONDS - REINFORCEMENT_WARNING_SECONDS)
      )
        announce(
          {
            title: "Reinforcements in one minute",
            detail: "Hold out until they reach you",
            tone: "info",
            sound: "shimmer",
          },
          true,
        );
      if (state.over) {
        finish(state);
        publish();
        return;
      }
      const now = performance.now();
      if (
        state.draft ||
        state.hero.level !== level ||
        now - current.publishedAt > HUD_INTERVAL_MS
      )
        publish(now);
    },
    [announce, announceEvents, finish, publish],
  );

  /** The live run, for the renderer. */
  const getSession = useCallback(() => session.current, []);

  return {
    phase,
    runId,
    hud,
    paused,
    progress,
    isLoadingProgress: signedIn && progressQuery.isPending,
    isStarting,
    isTraining,
    outcome,
    goal,
    record,
    announcement,
    start,
    leave,
    act,
    train,
    retryClaim: claim,
    setMove,
    setPaused,
    advance,
    getSession,
  };
};

/** Everything the HUD reads, copied so a render never observes the live run. */
export type ChakraStormHud = Pick<
  CsState,
  "tick" | "jutsu" | "passives" | "draft" | "kills" | "over" | "won" | "config"
> & {
  hero: CsState["hero"];
  boss: { name: string; hp: number; maxHp: number } | null;
  /** Jutsu that a scroll would awaken now. */
  awakenable: CsState["jutsu"];
};

const snapshotRun = (state: CsState): ChakraStormHud => {
  const boss = state.enemies.find((enemy) => enemy.kind === "boss" && enemy.hp > 0);
  return {
    tick: state.tick,
    config: state.config,
    hero: { ...state.hero },
    jutsu: state.jutsu.map((entry) => ({ ...entry })),
    passives: state.passives.map((entry) => ({ ...entry })),
    draft: state.draft ? [...state.draft] : null,
    kills: state.kills,
    over: state.over,
    won: state.won,
    boss: boss ? { name: boss.name, hp: boss.hp, maxHp: boss.maxHp } : null,
    awakenable: csAwakenable(state).map((entry) => ({ ...entry })),
  };
};

const readProgress = (): CsProgress => {
  try {
    return parseCsProgress(window.localStorage.getItem(PROGRESS_STORAGE_KEY));
  } catch {
    return CS_EMPTY_PROGRESS;
  }
};

const writeProgress = (progress: CsProgress) => {
  try {
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Storage can be full or blocked; progress still holds until the page closes.
  }
};
