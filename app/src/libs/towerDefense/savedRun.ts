/**
 * The local copy of a run in progress, so a reload resumes it by replay.
 *
 * The action log grows to megabytes in long runs, so it is kept encoded
 * (`libs/towerDefense/actionLog`) as sealed chunks of a fixed number of actions plus an
 * open tail. A save writes each sealed chunk to its own storage key once, then a small
 * head with the run's configuration and the tail, so its cost stays flat however long
 * the run gets.
 */
import { encodeTdAction } from "@/libs/towerDefense/actionLog";
import type { TdAction, TdRunConfig } from "@/libs/towerDefense/sim";
import {
  safeLocalStorageGetItem,
  safeLocalStorageRemoveItem,
  safeLocalStorageSetItem,
} from "@/utils/storage";

/** Actions per sealed chunk. */
export const TD_LOG_CHUNK_ACTIONS = 2048;
/**
 * Longest log saved locally. Browsers give an origin about 5 MB of local storage, shared
 * with the rest of the game and counted in UTF-16 by some, so a longer run keeps its
 * last save instead of crowding out every other stored setting.
 */
export const TD_SAVED_LOG_MAX_CHARS = 1_000_000;

/** An encoded action log being recorded. */
export interface TdLogWriter {
  /** Encoded chunks of exactly `TD_LOG_CHUNK_ACTIONS` actions each. */
  sealed: string[];
  /** Encoded actions after the sealed chunks. */
  tail: string[];
  count: number;
  /** Length of the whole encoded log. */
  chars: number;
  lastTick: number;
  /** Sealed chunks already in storage. */
  stored: number;
}

/** What a save keeps beside the log. */
export interface TdSavedRunHead {
  id: string;
  config: TdRunConfig;
  token: string | null;
  tick: number;
  wave: number;
  over: boolean;
}

interface StoredHead extends TdSavedRunHead {
  chunks: number;
  tail: string;
}

/** A writer for an empty log. */
export const createLogWriter = (): TdLogWriter => ({
  sealed: [],
  tail: [],
  count: 0,
  chars: 0,
  lastTick: 0,
  stored: 0,
});

/** Record an action, sealing the tail once it holds a full chunk. */
export const appendToLog = (log: TdLogWriter, action: TdAction) => {
  const encoded = encodeTdAction(action, log.lastTick);
  log.chars += encoded.length + (log.count > 0 ? 1 : 0);
  log.count++;
  log.lastTick = action[0];
  log.tail.push(encoded);
  if (log.tail.length >= TD_LOG_CHUNK_ACTIONS) {
    log.sealed.push(log.tail.join(";"));
    log.tail = [];
  }
};

/** The whole log in its wire encoding. */
export const encodedLog = (log: TdLogWriter) =>
  [...log.sealed, log.tail.join(";")].filter((part) => part !== "").join(";");

/** Save a run; returns false when storage refused a write, so the run carries on unsaved. */
export const saveRun = (key: string, head: TdSavedRunHead, log: TdLogWriter) => {
  while (log.stored < log.sealed.length) {
    if (
      !safeLocalStorageSetItem(chunkKey(key, log.stored), log.sealed[log.stored] ?? "")
    )
      return false;
    log.stored++;
  }
  const stored: StoredHead = {
    ...head,
    chunks: log.sealed.length,
    tail: log.tail.join(";"),
  };
  return safeLocalStorageSetItem(key, JSON.stringify(stored));
};

/** The saved head alone, cheap enough to read on every visit to the lobby. */
export const readSavedRunHead = (key: string): StoredHead | null => {
  const raw = safeLocalStorageGetItem(key);
  if (!raw) return null;
  try {
    const head = JSON.parse(raw) as Partial<StoredHead>;
    return typeof head.chunks === "number" &&
      typeof head.tail === "string" &&
      head.config
      ? (head as StoredHead)
      : null;
  } catch {
    return null;
  }
};

/**
 * Whether storage still holds the save a player decided about, or still holds none. Any
 * write by another session moves the save's id or tick, so a stale decision is caught.
 */
export const isSameSavedRun = (
  stored: Pick<TdSavedRunHead, "id" | "tick"> | null,
  chosen: Pick<TdSavedRunHead, "id" | "tick"> | null,
) =>
  stored === null || chosen === null
    ? stored === chosen
    : stored.id === chosen.id && stored.tick === chosen.tick;

/** A saved run with its encoded log, or null when nothing complete is stored. */
export const loadRun = (key: string) => {
  const head = readSavedRunHead(key);
  if (!head) return null;
  const parts: string[] = [];
  for (let index = 0; index < head.chunks; index++) {
    const chunk = safeLocalStorageGetItem(chunkKey(key, index));
    if (chunk === null) return null;
    parts.push(chunk);
  }
  if (head.tail) parts.push(head.tail);
  return { head, text: parts.join(";") };
};

/** Remove a saved run and its chunks. */
export const clearRun = (key: string) => {
  const chunks = readSavedRunHead(key)?.chunks ?? 0;
  for (let index = 0; index < chunks; index++)
    safeLocalStorageRemoveItem(chunkKey(key, index));
  safeLocalStorageRemoveItem(key);
};

/**
 * Remove the save of a settled run while storage still holds that run, identified by its
 * token since every session resuming it saves under a new id. A save another run wrote
 * since is kept. Returns whether the save was removed.
 */
export const clearSettledRun = (key: string, token: string) => {
  const isOwned = readSavedRunHead(key)?.token === token;
  if (isOwned) clearRun(key);
  return isOwned;
};

const chunkKey = (key: string, index: number) => `${key}:log:${index}`;
