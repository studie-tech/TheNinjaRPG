import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useGameScene } from "@/hooks/game-scene";
import { createFrameLoop } from "@/libs/rendering/frameLoop";

afterEach(cleanup);
const source = readFileSync(join(import.meta.dirname, "../../src/layout/Combat.tsx"), "utf8");
const sourceBetween = (start: string, end: string) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Combat lifecycle source missing: ${start}`);
  return source.slice(from, to);
};
const transpiler = new (require("bun").Transpiler)({ loader: "ts" }) as { transformSync(source: string): string };

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
    canPerformAction: () => true,
    performAction: () => { actions++; },
  };
  new Function("scope", `with (scope) { ${transpiler.transformSync(driver)} }`)(scope);
  drive();
  expect(actions).toBe(1);
});
