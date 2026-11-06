import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";
import * as toastUi from "@/components/ui/use-toast";
import { showActionReadinessToast } from "@/libs/actionFeedback";
import { AUTO_WAKE_MESSAGE } from "@/libs/actionReadiness";
import * as toast from "@/libs/toast";
import { actualShowMutationToast } from "../setup/preload";

// Exercise movement callbacks without mounting their WebGL scene, as in combat-completion-cache.test.ts.
const source = readFileSync(new URL("../../src/layout/Sector.tsx", import.meta.url), "utf8");
const transpiler = new (require("bun").Transpiler)({ loader: "ts" }) as { transformSync(source: string): string };
const block = (startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Missing movement callback: ${startMarker}`);
  return source.slice(start, end);
};
const evaluate = (code: string, scope: object) => new Function("scope", `with (scope) { ${transpiler.transformSync(code)} }`)(scope);
type CallbackOptions = { onSuccess: (...args: unknown[]) => Promise<void> };
type CrossingHandler = (...args: unknown[]) => Promise<void>;

beforeEach(() => {
  vi.spyOn(toast, "showMutationToast").mockImplementation(actualShowMutationToast);
});
afterEach(() => vi.restoreAllMocks());

const setup = () => {
  const shown = vi.spyOn(toastUi, "toast").mockImplementation(Object.assign(() => "movement", { dismiss: () => "movement" }));
  const scope = {
    showMutationToast: actualShowMutationToast,
    showActionReadinessToast,
    useSceneMutation: (options: unknown) => options,
    getMutationKey: () => ["travel", "moveInSector"],
    api: { travel: { moveInSector: {} } },
    mountedRef: { current: true },
    windowNavRef: { current: null },
    pendingCrossRef: { current: null },
    pendingWorldTargetRef: { current: null },
    publishSurroundingsRef: { current: false },
    userRef: { current: { sector: 1 } },
    snapMovementPosition: vi.fn(),
    setTarget: vi.fn(),
    setPosition: vi.fn(),
    updateUser: vi.fn(async () => {}),
    refreshMovementPosition: vi.fn(async () => {}),
    runQuestTriggers: vi.fn(),
    applyCrossing: vi.fn(async () => {}),
    runJourneySegment: vi.fn(async () => {}),
    updateSector: vi.fn(async () => {}),
  };
  const reconcileCrossing = evaluate(`${block("  const reconcileCrossing = async (", "  const clearAllHighlights")}\nreturn reconcileCrossing;`, scope) as CrossingHandler;
  const handlers = { ...scope, reconcileCrossing };
  const executeMove = evaluate(`${block("  const executeMove = useSceneMutation({", "\n\n  const move =")}\nreturn executeMove;`, handlers) as CallbackOptions;
  const moveStep = evaluate(`${block("  const moveStepAsync = useSceneMutation({", "\n\n  /**\n   * Assemble")}\nreturn moveStepAsync;`, handlers) as CallbackOptions;
  const handleCrossing = evaluate(`${block("  const handleCrossing = async (", "\n\n  /** Restore every movement")}\nreturn handleCrossing;`, handlers) as CrossingHandler;
  return { shown, scope, executeMove, moveStep, handleCrossing };
};

it.each(["ordinary", "sector crossing", "shortened path", "interception", "rejection"] as const)("shows one recovery notice for %s movement", async (outcome) => {
  const test = setup();
  const hasData = outcome !== "interception" && outcome !== "rejection";
  const data = { sector: outcome === "sector crossing" ? 2 : 1, longitude: outcome === "shortened path" ? 4 : 5, latitude: 5, location: "Field" };
  const result = {
    success: outcome !== "rejection",
    message: hasData ? "OK" : `${outcome === "interception" ? "Attacked by village protector" : "Movement interrupted"} ${AUTO_WAKE_MESSAGE}`,
    actionNotice: AUTO_WAKE_MESSAGE,
    ...(hasData ? { data } : { userRecovery: { status: "AWAKE" } }),
  };
  await test.executeMove.onSuccess(result, { sector: 1, longitude: 5, latitude: 5 }, { walk: Promise.resolve(), userRevision: 17 });
  expect(test.shown).toHaveBeenCalledTimes(1);
  expect(test.shown.mock.calls[0]![0].description).toBe(hasData ? AUTO_WAKE_MESSAGE : result.message);
  expect(test.scope.refreshMovementPosition).toHaveBeenCalledTimes(hasData ? 0 : 1);
  expect(test.scope.runJourneySegment).toHaveBeenCalledTimes(outcome === "ordinary" ? 1 : 0);
  expect(test.scope.applyCrossing).toHaveBeenCalledTimes(outcome === "sector crossing" ? 1 : 0);
  if (!hasData) expect(test.scope.updateUser).toHaveBeenCalledWith(result, { revision: 17, refetch: false, userRecovery: { status: "AWAKE" } });
});

it.each([true, false])("shows one recovery notice for a pre-fired crossing with destination data %s", async (hasData) => {
  const test = setup();
  const result = {
    success: true,
    message: hasData ? "OK" : `Attacked by village protector ${AUTO_WAKE_MESSAGE}`,
    actionNotice: AUTO_WAKE_MESSAGE,
    ...(hasData ? { data: { sector: 2, longitude: 5, latitude: 5, location: "Field" } } : { userRecovery: { status: "AWAKE" } }),
  };
  await test.moveStep.onSuccess(result);
  await test.handleCrossing(Promise.resolve(result), null, { x: 5, y: 5 }, "Field", { revision: 17, refetch: false });
  expect(test.shown).toHaveBeenCalledTimes(1);
  expect(test.shown.mock.calls[0]![0].description).toBe(hasData ? AUTO_WAKE_MESSAGE : result.message);
  expect(test.scope.applyCrossing).toHaveBeenCalledTimes(hasData ? 1 : 0);
  expect(test.scope.refreshMovementPosition).toHaveBeenCalledTimes(hasData ? 0 : 1);
});
