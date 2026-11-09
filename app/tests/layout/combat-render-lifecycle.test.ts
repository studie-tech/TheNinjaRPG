import { afterEach, expect, it } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createStore } from "jotai";
import { useEffect } from "react";
import { useGameScene } from "@/hooks/game-scene";
import { maskBattle } from "@/libs/combat/masking";
import { isBattleInLobby } from "@/libs/combat/util";
import { createFrameLoop } from "@/libs/rendering/frameLoop";
import { userBattleAtom } from "@/utils/UserContext";
import { makeCompleteBattle } from "../setup/combat";
import { deferred } from "../setup/deferred";
import { readSource, runInScope, sliceCall } from "../setup/sourceSlice";

afterEach(cleanup);
const source = readSource("layout/Combat.tsx");

it("keeps shared battle state when the battlefield scene unmounts", () => {
  const effects = sliceCall(
    source,
    /useEffect\(\(\)\s*=>\s*\{\s*combat\.scene\.current\?\.refresh\(\);\s*\}/,
  );
  const runEffects = (scope: object) => runInScope(effects, scope);
  const store = createStore();
  const battle = maskBattle(makeCompleteBattle(), "player-0");
  store.set(userBattleAtom, battle);
  const hook = renderHook(() =>
    runEffects({
      useEffect,
      combat: { scene: { current: null }, isReady: true },
      battleState: { battle },
      props: {},
      gameAssets: [],
      userData: undefined,
      isPageActive: true,
      config: {},
      lightingPreviewDate: null,
      weatherPreview: null,
      showDayNightMapOverlays: false,
      setBattleAtom: (value: typeof battle | undefined) =>
        store.set(userBattleAtom, value),
    }),
  );
  hook.unmount();
  expect(store.get(userBattleAtom)).toBe(battle);
});

it.each(["Won", "Lost", "Fled", "Draw"])(
  "releases the canvas loop while %s rewards remain held",
  async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let id = 0,
      renders = 0,
      disposed = 0;
    const loop = createFrameLoop(
      (callback) => {
        callbacks.set(++id, callback);
        return id;
      },
      (key) => {
        callbacks.delete(key);
      },
    );
    const mount = { current: document.createElement("div") };
    const factory = async () => {
      const leave = loop.subscribe(() => {
        renders++;
      });
      return {
        dispose: () => {
          leave();
          disposed++;
        },
      };
    };
    const hook = renderHook(
      ({ enabled }) => useGameScene("combat", mount, factory, "battle", enabled),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(hook.result.current.isReady).toBe(true));
    const queued = callbacks.entries().next().value;
    expect(queued).toBeDefined();
    if (queued) {
      callbacks.delete(queued[0]);
      queued[1](16);
    }
    expect(renders).toBe(1);
    hook.rerender({ enabled: false });
    await waitFor(() => expect(hook.result.current.isReady).toBe(false));
    expect(callbacks.size).toBe(0);
    expect(disposed).toBe(1);
    if (queued) queued[1](32);
    expect(renders).toBe(1);
    hook.rerender({ enabled: true });
    await waitFor(() => expect(hook.result.current.isReady).toBe(true));
    expect(callbacks.size).toBe(1);
  },
);

it("never initializes held results and cancels late scene completion", async () => {
  let starts = 0,
    disposed = 0;
  let resolve = (_scene: { dispose: () => void }) => {};
  const mount = { current: document.createElement("div") };
  const factory = () => {
    starts++;
    return new Promise<{ dispose: () => void }>((complete) => {
      resolve = complete;
    });
  };
  const hook = renderHook(
    ({ enabled }) => useGameScene("combat", mount, factory, "battle", enabled),
    { initialProps: { enabled: false } },
  );
  expect(starts).toBe(0);
  hook.rerender({ enabled: true });
  expect(starts).toBe(1);
  hook.unmount();
  await act(async () => {
    resolve({
      dispose: () => {
        disposed++;
      },
    });
    await Promise.resolve();
  });
  expect(disposed).toBe(1);
});

it("still drives live auto combat while its scene is paused in the background", () => {
  const driver = sliceCall(
    source,
    /useEffect\(\(\)\s*=>\s*\{\s*if \(!isPageActive && !hasAutoCombat\)/,
  );
  let drive = () => {};
  let actions = 0;
  const scope = {
    isPageActive: false,
    hasAutoCombat: true,
    isPending: false,
    settledResult: null,
    suid: "viewer",
    timeDiff: 0,
    controlledActorId: "viewer",
    battleRef: {
      current: {
        id: "live-battle",
        version: 1,
        createdAt: new Date(0),
        usersState: [{ controllerId: "viewer" }],
      },
    },
    userIdRef: { current: "viewer" },
    precomputedActionsRef: { current: [] },
    lastAutonomousActionRef: { current: 0 },
    lastBattleCheckRef: { current: 0 },
    fieldFailedRef: { current: false },
    combat: { scene: { current: { isPresenting: () => false } } },
    AUTONOMOUS_ACTION_MS: 1100,
    BATTLE_CHECK_MS: 1000,
    DRIVER_TICK_MS: 200,
    useEffect(callback: () => void) {
      callback();
    },
    setInterval(callback: () => void) {
      drive = callback;
      return 1;
    },
    calcActiveUser: () => ({ actor: { userId: "ai" }, changedActor: false }),
    getTurnControl: () => ({ isAITurn: true }),
    isBattleInLobby,
    canPerformAction: () => true,
    canDrive: () => true,
    performAction: () => {
      actions++;
    },
  };
  runInScope(driver, scope);
  drive();
  expect(actions).toBe(1);
  // Requests stay inside the rate limit however quickly a replay finishes.
  drive();
  expect(actions).toBe(1);
  scope.lastAutonomousActionRef.current = 0;
  // The field finishes replaying the last response before the next is requested.
  scope.combat.scene.current.isPresenting = () => true;
  drive();
  expect(actions).toBe(1);
  scope.combat.scene.current.isPresenting = () => false;
  scope.canDrive = () => false;
  drive();
  expect(actions).toBe(1);
  scope.canDrive = () => true;
  drive();
  expect(actions).toBe(2);
});

it("lets only the battle's fighters drive its AI turns, never a spectator", () => {
  const driver = sliceCall(
    source,
    /useEffect\(\(\)\s*=>\s*\{\s*if \(!isPageActive && !hasAutoCombat\)/,
  );
  let drive = () => {};
  let actions = 0;
  const scope = {
    isPageActive: true,
    hasAutoCombat: false,
    isPending: false,
    settledResult: null,
    suid: "spectator",
    timeDiff: 0,
    controlledActorId: "spectator",
    battleRef: {
      current: {
        id: "live-battle",
        version: 1,
        createdAt: new Date(0),
        roundStartAt: new Date(),
        usersState: [{ controllerId: "fighter" }, { controllerId: "ai" }],
      },
    },
    userIdRef: { current: "spectator" },
    precomputedActionsRef: { current: [] },
    lastAutonomousActionRef: { current: 0 },
    lastBattleCheckRef: { current: 0 },
    fieldFailedRef: { current: false },
    combat: { scene: { current: { isPresenting: () => false } } },
    utils: { combat: { getBattle: { invalidate: () => Promise.resolve() } } },
    AUTONOMOUS_ACTION_MS: 1100,
    BATTLE_CHECK_MS: 1000,
    DRIVER_TICK_MS: 200,
    COMBAT_SECONDS: 30,
    COMBAT_LOBBY_SECONDS: 15,
    useEffect(callback: () => void) {
      callback();
    },
    setInterval(callback: () => void) {
      drive = callback;
      return 1;
    },
    calcActiveUser: () => ({ actor: { userId: "ai" }, changedActor: false }),
    getTurnControl: () => ({ isAITurn: true }),
    isBattleInLobby,
    canPerformAction: () => true,
    canDrive: () => true,
    performAction: () => {
      actions++;
    },
  };
  runInScope(driver, scope);
  drive();
  expect(actions).toBe(0);
  scope.battleRef.current.usersState.push({ controllerId: "spectator" });
  drive();
  expect(actions).toBe(1);
});

it("resolves nothing autonomously until a visible field can show it", () => {
  const driver = sliceCall(
    source,
    /useEffect\(\(\)\s*=>\s*\{\s*if \(!isPageActive && !hasAutoCombat\)/,
  );
  let drive = () => {};
  let actions = 0;
  const scope = {
    isPageActive: true,
    hasAutoCombat: true,
    isPending: false,
    settledResult: null,
    suid: "viewer",
    timeDiff: 0,
    controlledActorId: "viewer",
    battleRef: {
      current: {
        id: "live-battle",
        version: 1,
        createdAt: new Date(0),
        usersState: [{ controllerId: "viewer" }],
      },
    },
    userIdRef: { current: "viewer" },
    precomputedActionsRef: { current: [] },
    lastAutonomousActionRef: { current: 0 },
    lastBattleCheckRef: { current: 0 },
    fieldFailedRef: { current: false },
    combat: { scene: { current: null as { isPresenting: () => boolean } | null } },
    AUTONOMOUS_ACTION_MS: 1100,
    BATTLE_CHECK_MS: 1000,
    DRIVER_TICK_MS: 200,
    useEffect(callback: () => void) {
      callback();
    },
    setInterval(callback: () => void) {
      drive = callback;
      return 1;
    },
    calcActiveUser: () => ({ actor: { userId: "ai" }, changedActor: false }),
    getTurnControl: () => ({ isAITurn: true }),
    isBattleInLobby,
    canPerformAction: () => true,
    canDrive: () => true,
    performAction: () => {
      actions++;
    },
  };
  runInScope(driver, scope);
  drive();
  expect(actions).toBe(0);
  scope.combat.scene.current = { isPresenting: () => false };
  drive();
  expect(actions).toBe(1);
  // A field that cannot load must not strand the battle.
  scope.combat.scene.current = null;
  scope.lastAutonomousActionRef.current = 0;
  scope.fieldFailedRef.current = true;
  drive();
  expect(actions).toBe(2);
});

it.each([false, true])(
  "displays committed rewards before history recovery and retains them if recovery fails=%s",
  async (fails) => {
    const handlers = sliceCall(
      source,
      /const \{\s*mutate: mutateAction,\s*isPending\s*\}\s*=\s*api\.combat\.performAction\.useMutation\(/,
    );
    const battle = { id: "settled-arena", version: 2 };
    const result = { outcome: "Won", notifications: [] };
    let state: {
      battle: typeof battle;
      result: typeof result | null;
      isPending: boolean;
    } = { battle, result: null, isPending: true };
    let options!: {
      onSuccess: (data: object, input: object, context: object) => Promise<void>;
      onError: () => void;
    };
    const { promise: held, resolve: finish } = deferred<void>();
    const events: string[] = [];
    runInScope(handlers, {
      api: {
        combat: {
          performAction: {
            useMutation: (value: typeof options) => {
              options = value;
              return {};
            },
          },
        },
      },
      battleRef: { current: battle },
      resultRef: { current: null },
      completionRevisionRef: { current: null },
      suid: "player",
      actionInFlightRef: { current: true },
      setPendingAction() {},
      combat: { scene: { current: {} } },
      resolveControlledActorId: () => "player",
      haptics: { notify() {} },
      setBattleState: (
        update: typeof state | ((current: typeof state) => typeof state),
      ) => {
        state = typeof update === "function" ? update(state) : update;
        events.push("result");
      },
      setBattleAtom() {},
      publishBattle() {},
      currentStep: { onCombatWin: "next-step" },
      updateLogs: async () => {
        events.push("history");
        await held;
        if (fails) throw new Error("History unavailable");
      },
      handleNextStepAsync: async () => {
        events.push("tutorial");
      },
    });
    const pending = options.onSuccess(
      {
        updateClient: true,
        battleUpdate: battle,
        result,
        logEntries: [],
        updatedQuestIds: [],
      },
      { battleId: battle.id },
      {},
    );
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
  },
);

it("retains a peer's terminal result when an earlier action response arrives", async () => {
  const handlers = sliceCall(
    source,
    /const \{\s*mutate: mutateAction,\s*isPending\s*\}\s*=\s*api\.combat\.performAction\.useMutation\(/,
  );
  const battle = { id: "shared", version: 3 };
  const result = { outcome: "Won" };
  let state = { battle, result, isPending: true };
  let success!: (data: object) => Promise<void>;
  runInScope(handlers, {
    api: {
      combat: {
        performAction: {
          useMutation: (options: { onSuccess: typeof success }) => {
            success = options.onSuccess;
            return {};
          },
        },
      },
    },
    resultRef: { current: result },
    actionInFlightRef: { current: true },
    setPendingAction() {},
    combat: { scene: { current: {} } },
    setBattleState: (update: (current: typeof state) => typeof state) => {
      state = update(state);
    },
  });
  await success({
    updateClient: true,
    battleUpdate: { ...battle, version: 2 },
    result: null,
  });
  expect(state).toEqual({ battle, result, isPending: false });
});
