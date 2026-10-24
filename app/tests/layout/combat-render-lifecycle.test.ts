import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dirname, "../../src/layout/Combat.tsx"), "utf8");

// Execute the actual scene scheduler and lifecycle effects with a deterministic
// frame queue. No WebGL context or globally persistent module mocks are needed.
function sourceBetween(start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Combat lifecycle source missing: ${start}`);
  return source.slice(from, to);
}

const scheduler = sourceBetween("      function render() {", "\n      // Remove the mouseover listener");
const lifecycle = [
  sourceBetween("  useEffect(() => {\n    resultRef.current = result;", "\n\n  // Precompute maps"),
  sourceBetween("  useEffect(() => {\n    const wasActive = wasPageActiveRef.current;", "\n\n  // Departed players"),
].join("\n");
// A typed `bun` import would add its fetch globals to the entire app typecheck.
const transpiler = new (require("bun").Transpiler)({ loader: "ts" }) as {
  transformSync(source: string): string;
};
const initialize = new Function("scope", `with (scope) { ${transpiler.transformSync(scheduler)}; return render; }`) as (scope: object) => () => void;
const updateLifecycle = new Function("scope", `with (scope) { ${lifecycle} }`) as (scope: object) => void;

function createScene(initialResult: { outcome: string } | null = null) {
  const callbacks = new Map<number, () => void>();
  const dependencies: unknown[][] = [];
  let nextId = 0;
  let effectIndex = 0;
  const counts = { renders: 0, scheduled: 0, cancelled: 0, clockStarts: 0, clockStops: 0, refreshes: 0, mixerUpdates: 0, windUpdates: 0, waveUpdates: 0 };
  const scope = {
    animationId: null as number | null,
    isMountedRef: { current: true },
    isPageActive: true,
    isPageActiveRef: { current: true },
    wasPageActiveRef: { current: true },
    result: initialResult,
    resultRef: { current: initialResult },
    setRenderActiveRef: { current: null as ((active: boolean) => void) | null },
    utils: { combat: { getBattle: { invalidate() { counts.refreshes++; } } } },
    useEffect(callback: () => void, values: unknown[]) {
      const previous = dependencies[effectIndex];
      dependencies[effectIndex++] = values;
      if (!previous || values.some((value, index) => !Object.is(value, previous[index]))) callback();
    },
    profiler: null,
    performanceMonitor: {
      begin() {}, end() {},
      requestFrame(callback: () => void) {
        counts.scheduled++;
        callbacks.set(++nextId, callback);
        return nextId;
      },
      cancelFrame(id: number) { counts.cancelled++; callbacks.delete(id); },
    },
    animateBattlefieldRef: { current: true },
    spriteMixer: { update() { counts.mixerUpdates++; } },
    clock: { getDelta: () => 0.016, start() { counts.clockStarts++; }, stop() { counts.clockStops++; } },
    raycaster: { setFromCamera() {} }, mouse: {}, camera: {},
    // Skip drawing fixtures; the renderer and scheduler must stop independently
    // of whether actor/grid data are available to the scene.
    userData: null, battleRef: { current: null }, gridRef: { current: null },
    cameraRef: { current: null }, controlsRef: { current: null },
    controls: { update() {} }, lightLayout: true, isContextLost: false,
    group_assets: {}, group_tiles: {},
    updateWindAnimation() { counts.windUpdates++; },
    updateWaveAnimation() { counts.waveUpdates++; },
    renderer: { render() { counts.renders++; }, info: {} }, scene: {}, hasRenderedFrame: false,
  };
  const render = initialize(scope);
  const update = (result = scope.result, active = scope.isPageActive) => {
    scope.result = result;
    scope.isPageActive = active;
    scope.isPageActiveRef.current = active;
    effectIndex = 0;
    updateLifecycle(scope);
  };
  update();
  return {
    counts, callbacks, scope, render, update,
    step() {
      const next = callbacks.entries().next().value;
      if (!next) return;
      callbacks.delete(next[0]);
      next[1]();
    },
  };
}

it("stops effect playback and scenery motion while continuing to render a live battlefield", () => {
  const scene = createScene();
  scene.scope.lightLayout = false;
  scene.step();
  expect(scene.counts.mixerUpdates).toBe(2);
  expect(scene.counts.windUpdates).toBe(1);
  expect(scene.counts.waveUpdates).toBe(1);
  scene.scope.animateBattlefieldRef.current = false;
  scene.step();
  expect(scene.counts.renders).toBe(3);
  expect(scene.counts.mixerUpdates).toBe(2);
  expect(scene.counts.windUpdates).toBe(1);
  expect(scene.counts.waveUpdates).toBe(1);
  scene.scope.animateBattlefieldRef.current = true;
  scene.step();
  expect(scene.counts.mixerUpdates).toBe(3);
  expect(scene.counts.windUpdates).toBe(2);
  expect(scene.counts.waveUpdates).toBe(2);
});

it.each(["Won", "Lost", "Fled", "Draw"])("cancels rendering while %s rewards remain held, including page resume", (outcome) => {
  const scene = createScene();
  scene.step();
  expect(scene.counts.renders).toBe(2);
  expect(scene.callbacks.size).toBe(1);

  scene.update({ outcome });
  expect(scene.counts.cancelled).toBe(1);
  expect(scene.counts.clockStops).toBe(1);
  expect(scene.callbacks.size).toBe(0);
  for (let i = 0; i < 120; i++) scene.step();
  expect(scene.counts.renders).toBe(2);
  expect(scene.counts.scheduled).toBe(2);
  expect(scene.counts.refreshes).toBe(0);

  scene.update(scene.scope.result, false);
  scene.update(scene.scope.result, true);
  expect(scene.counts.refreshes).toBe(1);
  expect(scene.callbacks.size).toBe(0);
  expect(scene.counts.renders).toBe(2);
});

it("rejects an already queued frame after settlement even before the pause effect runs", () => {
  const scene = createScene();
  scene.scope.resultRef.current = { outcome: "Won" };
  scene.step();
  expect(scene.counts.renders).toBe(1);
  expect(scene.counts.scheduled).toBe(1);
  expect(scene.callbacks.size).toBe(0);
});

it("does not start rendering a scene initialized with held results", () => {
  const scene = createScene({ outcome: "Won" });
  expect(scene.counts.renders).toBe(0);
  expect(scene.counts.scheduled).toBe(0);
});

it.each([true, false])("resumes one loop for the next live battle (page active: %s)", (active) => {
  const scene = createScene({ outcome: "Won" });
  scene.update(scene.scope.result, active);
  scene.update(null, active);
  expect(scene.counts.renders).toBe(active ? 1 : 0);
  expect(scene.callbacks.size).toBe(active ? 1 : 0);
  scene.update(null, true);
  expect(scene.counts.renders).toBe(1);
  expect(scene.callbacks.size).toBe(1);
  expect(scene.counts.clockStarts).toBe(1);
  scene.update();
  scene.step();
  expect(scene.counts.renders).toBe(2);
  expect(scene.callbacks.size).toBe(1);
});

it("retains the scene across result changes rather than rebuilding its hidden canvas", () => {
  expect(source).toContain("ref={mountRef} hidden={!!result}");
  expect(source).toContain("}, [battleId, hasGameAssets, userData?.sfxOn]);");
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
    canPerformAction: () => true,
    performAction: () => { actions++; },
  };
  new Function("scope", `with (scope) { ${transpiler.transformSync(driver)} }`)(scope);
  drive();
  expect(actions).toBe(1);
});
