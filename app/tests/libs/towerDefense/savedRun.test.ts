import { describe, expect, it } from "bun:test";
import { decodeTdActions, encodeTdActions } from "@/libs/towerDefense/actionLog";
import {
  appendToLog,
  clearRun,
  createLogWriter,
  encodedLog,
  loadRun,
  readSavedRunHead,
  resumeLogWriter,
  saveRun,
  TD_LOG_CHUNK_ACTIONS,
} from "@/libs/towerDefense/savedRun";
import {
  advanceReplay,
  applyAction,
  createReplay,
  replayRun,
  type TdAction,
  tdStateHash,
} from "@/libs/towerDefense/sim";

const limits = { maxTick: 1_000_000, maxActions: 1_000_000 };

/** In-memory Storage that records every write. */
const memoryStorage = () => {
  const items = new Map<string, string>();
  const writes: string[] = [];
  return {
    items,
    writes,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes.push(key);
      items.set(key, value);
    },
    removeItem: (key: string) => void items.delete(key),
  };
};

const head = {
  id: "run",
  config: { seed: "s", startWave: 1, bestWave: 0, dojo: {} },
  token: "token",
  tick: 0,
  wave: 1,
  over: false,
};

const actionAt = (index: number): TdAction =>
  index % 3 === 0
    ? [index * 2, "seal", "tiger", 1 - index, index]
    : [index * 2, "loot", index * 7];

describe("tower defense saved runs", () => {
  it("encodes the log incrementally exactly like the whole-log encoder", () => {
    const log = createLogWriter();
    const actions = Array.from({ length: TD_LOG_CHUNK_ACTIONS * 2 + 5 }, (_, i) =>
      actionAt(i),
    );
    for (const action of actions) appendToLog(log, action);
    expect(log.sealed).toHaveLength(2);
    expect(log.tail).toHaveLength(5);
    expect(encodedLog(log)).toBe(encodeTdActions(actions));
    expect(log.chars).toBe(encodeTdActions(actions).length);
  });

  it("writes each sealed chunk once and restores the log to keep recording", () => {
    const storage = memoryStorage();
    const log = createLogWriter();
    const actions: TdAction[] = [];
    for (let i = 0; i < TD_LOG_CHUNK_ACTIONS + 10; i++) {
      actions.push(actionAt(i));
      appendToLog(log, actionAt(i));
    }
    saveRun(storage, "key", head, log);
    saveRun(storage, "key", { ...head, tick: 99 }, log);
    expect(storage.writes).toEqual(["key:log:0", "key", "key"]);
    expect(readSavedRunHead(storage, "key")).toMatchObject({ tick: 99, chunks: 1 });

    const stored = loadRun(storage, "key");
    if (!stored) throw new Error("Nothing stored");
    const text = [...stored.chunks, stored.tail].join(";");
    const decoded = decodeTdActions(text, limits);
    expect(decoded).toEqual(actions);
    const restored = createLogWriter(stored, decoded ?? []);
    const next = actionAt(TD_LOG_CHUNK_ACTIONS + 10);
    appendToLog(restored, next);
    expect(encodedLog(restored)).toBe(encodeTdActions([...actions, next]));
    expect(restored.chars).toBe(encodedLog(restored).length);
  });

  it("clears a run with its chunks and ignores incomplete saves", () => {
    const storage = memoryStorage();
    const log = createLogWriter();
    for (let i = 0; i < TD_LOG_CHUNK_ACTIONS; i++) appendToLog(log, actionAt(i));
    saveRun(storage, "key", head, log);
    storage.removeItem("key:log:0");
    expect(loadRun(storage, "key")).toBeNull();
    clearRun(storage, "key");
    expect(storage.items.size).toBe(0);
    storage.setItem("key", JSON.stringify({ id: "old", log: [] }));
    expect(readSavedRunHead(storage, "key")).toBeNull();
  });

  it("continues the stored log when the replay reaches the save", () => {
    const config = { seed: "resume", startWave: 1, bestWave: 0, dojo: {} };
    const actions: TdAction[] = [
      [0, "buy", "damage"],
      [40, "buy", "health"],
    ];
    const replay = createReplay(config, actions);
    expect(advanceReplay(replay, 60)?.state.tick).toBe(60);
    const saved = { chunks: [], tail: encodeTdActions(actions), tick: 60 };
    const { complete, log } = resumeLogWriter(saved, actions, replay);
    expect(complete).toBe(true);
    expect(log.lastTick).toBe(40);
    expect(encodedLog(log)).toBe(saved.tail);
  });

  it("cuts the log to what a replay applied when it stops short of the save", () => {
    // A draft opens at once and no recorded action answers it, as when a deploy changes
    // the rules: the replay stalls at tick 0, before the saved tick 500.
    const config = { seed: "stall", startWave: 41, bestWave: 100, dojo: {} };
    const actions: TdAction[] = [
      [0, "buy", "damage"],
      [300, "buy", "health"],
    ];
    const replay = createReplay(config, actions);
    const result = advanceReplay(replay, 500);
    expect(result).toMatchObject({ stop: "stalled" });
    const saved = { chunks: [], tail: encodeTdActions(actions), tick: 500 };
    const { complete, log } = resumeLogWriter(saved, actions, replay);
    expect(complete).toBe(false);
    expect(log.count).toBe(1);
    // The resumed run records its next action at its own tick, and the log decodes and
    // replays to the same place.
    if (!result) throw new Error("Replay did not stop");
    const next: TdAction = [result.state.tick, "perk", 0];
    expect(applyAction(result.state, next)).toBe(true);
    appendToLog(log, next);
    const decoded = decodeTdActions(encodedLog(log), limits);
    expect(decoded).toEqual([[0, "buy", "damage"], next]);
    const replayed = replayRun(config, decoded ?? [], result.state.tick);
    expect(replayed.invalidAt).toBeNull();
    expect(tdStateHash(replayed.state)).toBe(tdStateHash(result.state));
    // The stored log would have continued from tick 300 and could not record it.
    expect(() => appendToLog(createLogWriter(saved, actions), next)).toThrow(
      RangeError,
    );
  });
});
