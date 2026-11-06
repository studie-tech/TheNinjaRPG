import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "bun:test";
import { createStore } from "jotai";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useEffect } from "react";
import { useGameScene } from "@/hooks/game-scene";
import { maskBattle } from "@/libs/combat/util";
import { createFrameLoop } from "@/libs/rendering/frameLoop";
import { userBattleAtom } from "@/utils/UserContext";
import { makeCompleteBattle } from "../libs/combat/helpers/battleScenario";

afterEach(cleanup);
const source = readFileSync(join(import.meta.dirname, "../../src/layout/Combat.tsx"), "utf8");
const sourceBetween = (start: string, end: string) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Combat lifecycle source missing: ${start}`);
  return source.slice(from, to);
};
const transpiler = new (require("bun").Transpiler)({ loader: "ts" }) as { transformSync(source: string): string };

it("keeps shared battle state when the battlefield scene unmounts", () => {
  const effects = sourceBetween("  useEffect(() => {\n    combat.scene.current?.refresh();", "\n  useEffect(() => {\n    lastHoverKeyRef.current = null;");
  const runEffects = new Function("scope", `with (scope) { ${transpiler.transformSync(effects)} }`);
  const store = createStore();
  const battle = maskBattle(makeCompleteBattle(), "player-0");
  store.set(userBattleAtom, battle);
  const hook = renderHook(() => runEffects({
    useEffect, combat: { scene: { current: null }, isReady: true },
    battleState: { battle }, props: {}, gameAssets: [], userData: undefined,
    isPageActive: true, config: {}, lightingPreviewDate: null, weatherPreview: null,
    showDayNightMapOverlays: false,
    setBattleAtom: (value: typeof battle | undefined) => store.set(userBattleAtom, value),
  }));
  hook.unmount();
  expect(store.get(userBattleAtom)).toBe(battle);
});

it.each(["Won", "Lost", "Fled", "Draw"])("releases the canvas loop while %s rewards remain held", async () => {
  const callbacks = new Map<number, FrameRequestCallback>();
  let id = 0, renders = 0, disposed = 0;
  const loop = createFrameLoop((callback) => { callbacks.set(++id, callback); return id; }, (key) => { callbacks.delete(key); });
  const mount = { current: document.createElement("div") };
  const factory = async () => {
    const leave = loop.subscribe(() => { renders++; });
    return { dispose: () => { leave(); disposed++; } };
  };
  const hook = renderHook(({ enabled }) => useGameScene(mount, factory, "battle", enabled), { initialProps: { enabled: true } });
  await waitFor(() => expect(hook.result.current.isReady).toBe(true));
  const queued = callbacks.entries().next().value;
  expect(queued).toBeDefined();
  if (queued) { callbacks.delete(queued[0]); queued[1](16); }
  expect(renders).toBe(1);
  hook.rerender({ enabled: false });
  await waitFor(() => expect(hook.result.current.isReady).toBe(false));
  expect(callbacks.size).toBe(0); expect(disposed).toBe(1);
  if (queued) queued[1](32);
  expect(renders).toBe(1);
  hook.rerender({ enabled: true });
  await waitFor(() => expect(hook.result.current.isReady).toBe(true));
  expect(callbacks.size).toBe(1);
});

it("never initializes held results and cancels late scene completion", async () => {
  let starts = 0, disposed = 0;
  let resolve = (_scene: { dispose: () => void }) => {};
  const mount = { current: document.createElement("div") };
  const factory = () => { starts++; return new Promise<{ dispose: () => void }>((complete) => { resolve = complete; }); };
  const hook = renderHook(({ enabled }) => useGameScene(mount, factory, "battle", enabled), { initialProps: { enabled: false } });
  expect(starts).toBe(0);
  hook.rerender({ enabled: true }); expect(starts).toBe(1);
  hook.unmount();
  await act(async () => { resolve({ dispose: () => { disposed++; } }); await Promise.resolve(); });
  expect(disposed).toBe(1);
});

it("still drives live auto combat while its scene is paused in the background", () => {
  const driver = sourceBetween("  useEffect(() => {\n    if (!isPageActive && !hasAutoCombat)", "\n\n  useEffect(() => {\n    actionRef.current");
  let drive = () => {};
  let actions = 0;
  const scope = {
    isPageActive: false, hasAutoCombat: true, isPending: false, result: null,
    suid: "viewer", timeDiff: 0, controlledActorId: "viewer",
    battleRef: { current: { id: "live-battle", version: 1, createdAt: new Date(0) } },
    userIdRef: { current: "viewer" }, precomputedActionsRef: { current: [] },
    useEffect(callback: () => void) { callback(); },
    setInterval(callback: () => void) { drive = callback; return 1; },
    calcActiveUser: () => ({ actor: { userId: "ai" }, changedActor: false }),
    getTurnControl: () => ({ isAITurn: true }),
    canPerformAction: () => true, canDrive: () => true,
    performAction: () => { actions++; },
  };
  new Function("scope", `with (scope) { ${transpiler.transformSync(driver)} }`)(scope);
  drive();
  expect(actions).toBe(1);
  scope.canDrive = () => false;
  drive();
  expect(actions).toBe(1);
});

it.each([false, true])("displays committed rewards before history recovery and retains them if recovery fails=%s", async (fails) => {
  const handlers = sourceBetween("  // User Action\n", "\n  const performAction = ");
  const battle = { id: "settled-arena", version: 2 };
  const result = { outcome: "Won", notifications: [] };
  let state: { battle: typeof battle; result: typeof result | null; isPending: boolean } = { battle, result: null, isPending: true };
  let options!: { onSuccess: (data: object, input: object, context: object) => Promise<void>; onError: () => void };
  let finish!: () => void;
  const held = new Promise<void>((resolve) => { finish = resolve; });
  const events: string[] = [];
  new Function("scope", `with (scope) { ${transpiler.transformSync(handlers)} }`)({
    api: { combat: { performAction: { useMutation: (value: typeof options) => { options = value; return {}; } } } },
    battleRef: { current: battle }, resultRef: { current: null }, completionRevisionRef: { current: null }, suid: "player",
    resolveControlledActorId: () => "player", haptics: { notify() {} },
    setBattleState: (update: typeof state | ((current: typeof state) => typeof state)) => { state = typeof update === "function" ? update(state) : update; events.push("result"); },
    setBattleAtom() {}, publishBattle() {}, currentStep: { onCombatWin: "next-step" },
    updateLogs: async () => { events.push("history"); await held; if (fails) throw new Error("History unavailable"); },
    handleNextStepAsync: async () => { events.push("tutorial"); },
  });
  const pending = options.onSuccess({ updateClient: true, battleUpdate: battle, result, logEntries: [], updatedQuestIds: [] }, { battleId: battle.id }, {});
  expect(state.result).toBe(result);
  expect(state.isPending).toBe(false);
  expect(events).toEqual(["result", "history"]);
  finish();
  if (fails) {
    await expect(pending).rejects.toThrow("History unavailable");
    options.onError();
    expect(state.result).toBe(result);
  } else {
    await pending;
    expect(events).toEqual(["result", "history", "tutorial"]);
  }
});

it("retains a peer's terminal result when an earlier action response arrives", async () => {
  const handlers = sourceBetween("  // User Action\n", "\n  const performAction = ");
  const battle = { id: "shared", version: 3 };
  const result = { outcome: "Won" };
  let state = { battle, result, isPending: true };
  let success!: (data: object) => Promise<void>;
  new Function("scope", `with (scope) { ${transpiler.transformSync(handlers)} }`)({
    api: { combat: { performAction: { useMutation: (options: { onSuccess: typeof success }) => { success = options.onSuccess; return {}; } } } },
    resultRef: { current: result },
    setBattleState: (update: (current: typeof state) => typeof state) => { state = update(state); },
  });
  await success({ updateClient: true, battleUpdate: { ...battle, version: 2 }, result: null });
  expect(state).toEqual({ battle, result, isPending: false });
});
