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

/** Actions per sealed chunk. */
export const TD_LOG_CHUNK_ACTIONS = 2048;

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

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

/** A writer for an empty log, or one continuing a log restored from storage. */
export const createLogWriter = (
  restored?: { chunks: string[]; tail: string },
  actions?: readonly TdAction[],
): TdLogWriter => {
  const sealed = restored?.chunks ?? [];
  const tail = restored?.tail ? restored.tail.split(";") : [];
  return {
    sealed,
    tail,
    count: actions?.length ?? 0,
    chars: [...sealed, ...tail].reduce(
      (total, part, index) => total + part.length + (index > 0 ? 1 : 0),
      0,
    ),
    lastTick: actions?.at(-1)?.[0] ?? 0,
    stored: sealed.length,
  };
};

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

/** Save a run; storage errors propagate so the caller can carry on without a save. */
export const saveRun = (
  storage: Storage,
  key: string,
  head: TdSavedRunHead,
  log: TdLogWriter,
) => {
  while (log.stored < log.sealed.length) {
    storage.setItem(chunkKey(key, log.stored), log.sealed[log.stored] ?? "");
    log.stored++;
  }
  const stored: StoredHead = {
    ...head,
    chunks: log.sealed.length,
    tail: log.tail.join(";"),
  };
  storage.setItem(key, JSON.stringify(stored));
};

/** The saved head alone, cheap enough to read on every visit to the lobby. */
export const readSavedRunHead = (storage: Storage, key: string): StoredHead | null => {
  const raw = storage.getItem(key);
  if (!raw) return null;
  const head = JSON.parse(raw) as Partial<StoredHead>;
  return typeof head.chunks === "number" && typeof head.tail === "string" && head.config
    ? (head as StoredHead)
    : null;
};

/** A saved run with its log, or null when nothing complete is stored. */
export const loadRun = (storage: Storage, key: string) => {
  const head = readSavedRunHead(storage, key);
  if (!head) return null;
  const chunks: string[] = [];
  for (let index = 0; index < head.chunks; index++) {
    const chunk = storage.getItem(chunkKey(key, index));
    if (chunk === null) return null;
    chunks.push(chunk);
  }
  return { head, chunks, tail: head.tail };
};

/** Remove a saved run and its chunks. */
export const clearRun = (storage: Storage, key: string) => {
  let chunks = 0;
  try {
    chunks = readSavedRunHead(storage, key)?.chunks ?? 0;
  } catch {}
  for (let index = 0; index < chunks; index++) storage.removeItem(chunkKey(key, index));
  storage.removeItem(key);
};

const chunkKey = (key: string, index: number) => `${key}:log:${index}`;
