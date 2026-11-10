import { buildPlaybackFrames, type CombatPlaybackFrame } from "@/libs/combat/playback";
import type { LoggedHealth, ReturnedBattle } from "@/libs/combat/types";

/** Longest one action may hold the queue when art or a cue never reports back. */
const FRAME_TIMEOUT_MS = 4000;
/** A landed strike reads before the next action starts. */
const IMPACT_HOLD_MS = 120;
/** Long authored clips still land their hit promptly, whatever their own length. */
const MAX_WINDUP_MS = 550;
/** Older actions are skipped past this, so a backlog never trails the live battle. */
const MAX_QUEUED_FRAMES = 8;

/**
 * Decides which battle the field shows while committed actions replay in order. Rendering
 * lags the live battle, which stays authoritative for input and is always the final state.
 */
export const createCombatPlayback = (initial: ReturnedBattle) => {
  let latest = initial;
  let presented = initial;
  let queue: CombatPlaybackFrame[] = [];
  let current:
    | {
        frame: CombatPlaybackFrame;
        landed: boolean;
        startedAt: number;
        landedAt: number;
        cueAt?: number;
      }
    | undefined;
  /** Log rows above this version belong to actions the field has not reached. */
  let logVersion: number | undefined;
  /**
   * Logged health lines of the frames landed since the scene last took them. Any landed
   * frame without lines, or any frame skipped unlanded, leaves the scene its net change.
   */
  let landed = { frames: 0, hits: [] as LoggedHealth[], complete: true };
  const record = (frame: CombatPlaybackFrame) => {
    landed.frames += 1;
    if (frame.hits) landed.hits.push(...frame.hits);
    else landed.complete = false;
  };

  const start = (frame: CombatPlaybackFrame, now: number) => {
    current = { frame, landed: !frame.windup, startedAt: now, landedAt: now };
    presented = frame.windup ?? frame.battle;
    logVersion = frame.windup ? frame.version - 1 : frame.version;
    if (!frame.windup) record(frame);
  };
  const land = (now: number) => {
    if (!current) return;
    if (!current.landed) record(current.frame);
    current.landed = true;
    current.landedAt = now;
    presented = current.frame.battle;
    logVersion = current.frame.version;
  };
  const finish = () => {
    if ((current && !current.landed) || queue.length) landed.complete = false;
    current = undefined;
    queue = [];
    presented = latest;
    logVersion = undefined;
  };

  return {
    /** Queue a newer battle; other identities restart, and equal versions refresh in place. */
    receive: (battle: ReturnedBattle) => {
      if (battle === latest) return;
      if (battle.id !== latest.id || battle.version < latest.version) {
        latest = battle;
        finish();
        return;
      }
      const frames =
        battle.version > latest.version ? buildPlaybackFrames(latest, battle) : [];
      latest = battle;
      queue.push(...frames);
      if (queue.length > MAX_QUEUED_FRAMES) {
        queue = queue.slice(queue.length - MAX_QUEUED_FRAMES);
        landed.complete = false;
      }
      if (!current && !queue.length) presented = battle;
    },
    /**
     * Advance on scene time. `cue` is the strike's progress from 0 to 1; 1 when the
     * fighter has no animated strike to wait for.
     */
    tick: (input: {
      now: number;
      /** Skip the replay: reduced motion, hidden pages and static previews. */
      instant: boolean;
      moving: boolean;
      cue: (actorId: string, cueId: string) => number;
    }) => {
      const { now, moving } = input;
      if (input.instant) {
        if (current || queue.length) finish();
        return presented;
      }
      if (current && now - current.startedAt >= FRAME_TIMEOUT_MS) {
        land(now);
        current = undefined;
      }
      if (current) {
        const { frame } = current;
        const progress = frame.cueId ? input.cue(frame.actorId, frame.cueId) : 1;
        if (!current.landed && !moving) {
          if (progress > 0) current.cueAt ??= now;
          const overdue =
            current.cueAt !== undefined && now - current.cueAt >= MAX_WINDUP_MS;
          if (progress >= frame.impact || overdue) land(now);
        }
        const held = !frame.cueId || now - current.landedAt >= IMPACT_HOLD_MS;
        if (current.landed && !moving && progress >= 1 && held) current = undefined;
      }
      if (!current) {
        const next = queue.shift();
        if (next) start(next, now);
        else if (presented !== latest || logVersion !== undefined) finish();
      }
      return presented;
    },
    isPlaying: () => !!current || queue.length > 0,
    /** The fighter whose action is on the field, while one is replaying. */
    actorId: () => current?.frame.actorId,
    logVersion: () => logVersion,
    presented: () => presented,
    /**
     * Logged health lines landed since the last call, or undefined when the field moved
     * without them (a skip, a refresh, or a source without steps) and must use net change.
     */
    takeHits: () => {
      const { frames, hits, complete } = landed;
      landed = { frames: 0, hits: [], complete: true };
      return frames && complete ? hits : undefined;
    },
  };
};
