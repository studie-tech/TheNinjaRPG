import { afterEach, describe, expect, it, vi } from "bun:test";
import { decodeTdActions, encodeTdActions } from "@/libs/towerDefense/actionLog";
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
  TD_LOG_CHUNK_ACTIONS,
} from "@/libs/towerDefense/savedRun";
import type { TdAction } from "@/libs/towerDefense/sim";

const limits = { maxTick: 1_000_000, maxActions: 1_000_000 };
const key = "towerDefenseRun:test";

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

/** Keys this suite wrote; jsdom's storage is shared with other suites. */
const savedKeys = () =>
  Object.keys(localStorage).filter((item) => item.startsWith(key));

afterEach(() => {
  vi.restoreAllMocks();
  for (const item of savedKeys()) localStorage.removeItem(item);
});

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

  it("writes each sealed chunk once and loads the whole log back", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const log = createLogWriter();
    const actions = Array.from({ length: TD_LOG_CHUNK_ACTIONS + 10 }, (_, i) =>
      actionAt(i),
    );
    for (const action of actions) appendToLog(log, action);
    expect(saveRun(key, head, log)).toBe(true);
    expect(saveRun(key, { ...head, tick: 99, over: true }, log)).toBe(true);
    expect(setItem.mock.calls.map(([written]) => written)).toEqual([
      `${key}:log:0`,
      key,
      key,
    ]);
    const stored = loadRun(key);
    expect(stored?.head).toMatchObject({ tick: 99, over: true, chunks: 1 });
    expect(decodeTdActions(stored?.text ?? "", limits)).toEqual(actions);
  });

  it("reports a refused write so the log keeps the chunk for the next save", () => {
    const log = createLogWriter();
    for (let i = 0; i < TD_LOG_CHUNK_ACTIONS; i++) appendToLog(log, actionAt(i));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(saveRun(key, head, log)).toBe(false);
    expect(log.stored).toBe(0);
    expect(readSavedRunHead(key)).toBeNull();
    expect(saveRun(key, head, log)).toBe(true);
    expect(log.stored).toBe(1);
  });

  it("notices when another session wrote or removed the save a player chose", () => {
    const log = createLogWriter();
    saveRun(key, { ...head, tick: 40, wave: 5 }, log);
    const shown = readSavedRunHead(key);
    expect(isSameSavedRun(readSavedRunHead(key), shown)).toBe(true);
    expect(isSameSavedRun(null, null)).toBe(true);

    saveRun(key, { ...head, tick: 900, wave: 50 }, log);
    expect(isSameSavedRun(readSavedRunHead(key), shown)).toBe(false);
    saveRun(key, { ...head, id: "other", tick: 40, wave: 5 }, log);
    expect(isSameSavedRun(readSavedRunHead(key), shown)).toBe(false);
    expect(isSameSavedRun(readSavedRunHead(key), null)).toBe(false);
    clearRun(key);
    expect(isSameSavedRun(readSavedRunHead(key), shown)).toBe(false);
  });

  it("clears a run with its chunks and ignores incomplete saves", () => {
    const log = createLogWriter();
    for (let i = 0; i < TD_LOG_CHUNK_ACTIONS; i++) appendToLog(log, actionAt(i));
    saveRun(key, head, log);
    localStorage.removeItem(`${key}:log:0`);
    expect(loadRun(key)).toBeNull();
    clearRun(key);
    expect(savedKeys()).toEqual([]);
    localStorage.setItem(key, JSON.stringify({ id: "old", log: [] }));
    expect(readSavedRunHead(key)).toBeNull();
    localStorage.setItem(key, "not json");
    expect(readSavedRunHead(key)).toBeNull();
  });

  it("removes a settled run's save but keeps one another run wrote since", () => {
    const log = createLogWriter();
    for (let i = 0; i < TD_LOG_CHUNK_ACTIONS + 3; i++) appendToLog(log, actionAt(i));
    saveRun(key, head, log);
    // Another session resuming the same run saves it under its own id.
    saveRun(key, { ...head, id: "resumed" }, log);
    expect(clearSettledRun(key, "token")).toBe(true);
    expect(savedKeys()).toEqual([]);

    const next = createLogWriter();
    for (let i = 0; i < TD_LOG_CHUNK_ACTIONS + 3; i++) appendToLog(next, actionAt(i));
    saveRun(key, { ...head, id: "next", token: "next-token" }, next);
    expect(clearSettledRun(key, "token")).toBe(false);
    expect(loadRun(key)?.head).toMatchObject({ id: "next", token: "next-token" });
    expect(localStorage.getItem(`${key}:log:0`)).not.toBeNull();
    clearRun(key);
    expect(clearSettledRun(key, "token")).toBe(false);
  });
});
