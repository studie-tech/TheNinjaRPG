import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";
import * as toastUi from "@/components/ui/use-toast";
import { showActionReadinessToast } from "@/libs/actionFeedback";
import { AUTO_WAKE_MESSAGE } from "@/libs/actionReadiness";
import * as toast from "@/libs/toast";
import { actualShowMutationToast } from "../setup/preload";

// Exercise movement callbacks without mounting their WebGL scene, as in combat-completion-cache.test.ts.
const source = readFileSync(
  new URL("../../src/layout/Sector.tsx", import.meta.url),
  "utf8",
);
const transpiler = new (require("bun").Transpiler)({ loader: "ts" }) as {
  transformSync(source: string): string;
};
const block = (startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0)
    throw new Error(`Missing movement callback: ${startMarker}`);
  return source.slice(start, end);
};
const evaluate = (code: string, scope: object) =>
  new Function("scope", `with (scope) { ${transpiler.transformSync(code)} }`)(scope);
type CallbackOptions = { onSuccess: (...args: unknown[]) => Promise<void> };
type CrossingHandler = (...args: unknown[]) => Promise<void>;

beforeEach(() => {
  vi.spyOn(toast, "showMutationToast").mockImplementation(actualShowMutationToast);
});
afterEach(() => vi.restoreAllMocks());

const setup = () => {
  const shown = vi
    .spyOn(toastUi, "toast")
    .mockImplementation(Object.assign(() => "movement", { dismiss: () => "movement" }));
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
    routeTargetRef: { current: undefined },
    publishSurroundingsRef: { current: false },
    publishSurroundings: () => undefined,
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
  const commitMovePosition = evaluate(
    `${block("  const commitMovePosition = async (", "\n\n  /** Restore every movement")}\nreturn commitMovePosition;`,
    scope,
  ) as CrossingHandler;
  const reconcileCrossing = evaluate(
    `${block("  const reconcileCrossing = async (", "  const clearAllHighlights")}\nreturn reconcileCrossing;`,
    { ...scope, commitMovePosition },
  ) as CrossingHandler;
  const handlers = { ...scope, commitMovePosition, reconcileCrossing };
  const executeMove = evaluate(
    `${block("  const executeMove = useSceneMutation({", "\n\n  const move =")}\nreturn executeMove;`,
    handlers,
  ) as CallbackOptions;
  const moveStep = evaluate(
    `${block("  const moveStepAsync = useSceneMutation({", "\n\n  /**\n   * Assemble")}\nreturn moveStepAsync;`,
    handlers,
  ) as CallbackOptions;
  const handleCrossing = evaluate(
    `${block("  const handleCrossing = async (", "\n\n  /** Restore every movement")}\nreturn handleCrossing;`,
    handlers,
  ) as CrossingHandler;
  return { shown, scope, executeMove, moveStep, handleCrossing, commitMovePosition };
};

it("keeps the viewer's own marker when its profile still records the previous sector", async () => {
  const invalidate = vi.fn(async () => {});
  const viewer = { userId: "self", sector: 228, longitude: 12, latitude: 3 };
  const scope = {
    isActiveRef: { current: true },
    userRef: { current: { userId: "self" } },
    userData: { userId: "self" },
    usersRef: {
      current: [
        { ...viewer, allianceStatus: "SELF" },
        { userId: "other", sector: 228, longitude: 1, latitude: 1 },
      ],
    },
    sectorRef: { current: 227 },
    actorRevisionRef: { current: 0 },
    remoteWalksRef: { current: new Map<string, symbol>() },
    arrivalsRef: { current: { wanted: new Set<string>(), queued: new Set<string>() } },
    isUserCurrentlyStealthed: () => false,
    mapAttackRelation: () => "NEUTRAL",
    warData: undefined,
    publishSurroundings: () => undefined,
    utils: { travel: { getSectorData: { invalidate } } },
  };
  const updateUsersList = evaluate(
    `${block("  const updateUsersList = async (", "\n\n  /** Stand the own marker")}\nreturn updateUsersList;`,
    scope,
  ) as (data: unknown) => Promise<void>;
  await updateUsersList(viewer);
  expect(scope.usersRef.current.map((user) => user.userId)).toEqual(["self"]);
  // An own update that finds no marker leaves the sector snapshot alone.
  scope.usersRef.current = [];
  await updateUsersList(viewer);
  expect(invalidate).not.toHaveBeenCalled();
});

it("records a committed crossing even when another mutation reconciled the profile first", async () => {
  const { scope, commitMovePosition } = setup();
  const landed = { sector: 227, longitude: 12, latitude: 3, location: "" };
  const mutation = { revision: 4, refetch: false };
  // A quest check in the same batch bumped the profile revision: the guarded write is rejected.
  scope.userRef.current = {
    sector: 228,
    longitude: 0,
    latitude: 3,
    location: "",
  } as never;
  scope.updateUser.mockImplementation(async () => false as never);
  await commitMovePosition(landed, mutation);
  expect(scope.updateUser).toHaveBeenCalledTimes(2);
  expect(scope.updateUser.mock.calls[0]).toEqual([
    expect.objectContaining(landed),
    mutation,
  ] as never);
  expect(scope.updateUser.mock.calls[1]).toEqual([
    expect.objectContaining(landed),
  ] as never);
  // An accepted write, or a profile that already holds the tile, needs nothing more.
  scope.updateUser.mockClear();
  scope.updateUser.mockImplementation(async () => true as never);
  await commitMovePosition(landed, mutation);
  expect(scope.updateUser).toHaveBeenCalledTimes(1);
  scope.updateUser.mockClear();
  scope.updateUser.mockImplementation(async () => false as never);
  scope.userRef.current = { ...landed } as never;
  await commitMovePosition(landed, mutation);
  expect(scope.updateUser).toHaveBeenCalledTimes(1);
});

it.each([
  "ordinary",
  "sector crossing",
  "shortened path",
  "interception",
  "rejection",
] as const)("shows one recovery notice for %s movement", async (outcome) => {
  const test = setup();
  const hasData = outcome !== "interception" && outcome !== "rejection";
  const data = {
    sector: outcome === "sector crossing" ? 2 : 1,
    longitude: outcome === "shortened path" ? 4 : 5,
    latitude: 5,
    location: "Field",
  };
  const result = {
    success: outcome !== "rejection",
    message: hasData
      ? "OK"
      : `${outcome === "interception" ? "Attacked by village protector" : "Movement interrupted"} ${AUTO_WAKE_MESSAGE}`,
    actionNotice: AUTO_WAKE_MESSAGE,
    ...(hasData ? { data } : { userRecovery: { status: "AWAKE" } }),
  };
  await test.executeMove.onSuccess(
    result,
    { sector: 1, longitude: 5, latitude: 5 },
    { walk: Promise.resolve(), userRevision: 17 },
  );
  expect(test.shown).toHaveBeenCalledTimes(1);
  expect(test.shown.mock.calls[0]![0].description).toBe(
    hasData ? AUTO_WAKE_MESSAGE : result.message,
  );
  expect(test.scope.refreshMovementPosition).toHaveBeenCalledTimes(hasData ? 0 : 1);
  expect(test.scope.runJourneySegment).toHaveBeenCalledTimes(
    outcome === "ordinary" ? 1 : 0,
  );
  expect(test.scope.applyCrossing).toHaveBeenCalledTimes(
    outcome === "sector crossing" ? 1 : 0,
  );
  if (!hasData)
    expect(test.scope.updateUser).toHaveBeenCalledWith(result, {
      revision: 17,
      refetch: false,
      userRecovery: { status: "AWAKE" },
    });
});

it.each([true, false])(
  "shows one recovery notice for a pre-fired crossing with destination data %s",
  async (hasData) => {
    const test = setup();
    const result = {
      success: true,
      message: hasData ? "OK" : `Attacked by village protector ${AUTO_WAKE_MESSAGE}`,
      actionNotice: AUTO_WAKE_MESSAGE,
      ...(hasData
        ? { data: { sector: 2, longitude: 5, latitude: 5, location: "Field" } }
        : { userRecovery: { status: "AWAKE" } }),
    };
    await test.moveStep.onSuccess(result);
    await test.handleCrossing(Promise.resolve(result), null, { x: 5, y: 5 }, "Field", {
      revision: 17,
      refetch: false,
    });
    expect(test.shown).toHaveBeenCalledTimes(1);
    expect(test.shown.mock.calls[0]![0].description).toBe(
      hasData ? AUTO_WAKE_MESSAGE : result.message,
    );
    expect(test.scope.applyCrossing).toHaveBeenCalledTimes(hasData ? 1 : 0);
    expect(test.scope.refreshMovementPosition).toHaveBeenCalledTimes(hasData ? 0 : 1);
  },
);

/** Remote walks use straight paths and optionally controlled step completion. */
const walkScope = (
  users: { userId: string; longitude: number; latitude: number }[],
  controlled = false,
) => {
  const sleepers: (() => void)[] = [];
  const scope = {
    isActiveRef: { current: true },
    userRef: { current: { userId: "self" } },
    userData: { userId: "self" },
    usersRef: { current: users.map((user) => ({ ...user, sector: 1 })) },
    sectorRef: { current: 1 },
    actorRevisionRef: { current: 0 },
    remoteWalksRef: { current: new Map<string, symbol>() },
    arrivalsRef: { current: { wanted: new Set<string>(), queued: new Set<string>() } },
    motionStepsRef: { current: new Map() },
    gridRef: { current: {} },
    findHex: (_grid: unknown, { x, y }: { x: number; y: number }) => ({
      col: x,
      row: y,
    }),
    pathFinderRef: {
      current: {
        getShortestPath: vi.fn(
          (from: { col: number; row: number }, to: { col: number; row: number }) => {
            const path = [];
            for (
              let col = from.col, row = from.row;
              col !== to.col || row !== to.row;
            ) {
              col += Math.sign(to.col - col);
              row += Math.sign(to.row - row);
              path.push({ col, row });
            }
            return path;
          },
        ),
      },
    },
    worldMotionHeading: () => ({ direction: "horizontal", facing: 1 }),
    publishMotionStep: vi.fn(),
    sleep: vi.fn(
      () =>
        new Promise<void>((resolve) =>
          controlled ? sleepers.push(resolve) : setTimeout(resolve, 0),
        ),
    ),
    SECTOR_WALK_STEP_MS: 100,
    isUserCurrentlyStealthed: () => false,
    mapAttackRelation: () => "NEUTRAL",
    warData: undefined,
    publishSurroundings: () => undefined,
    utils: { travel: { getSectorData: { invalidate: vi.fn(async () => {}) } } },
  };
  const { updateUsersList, cancelArrival } = evaluate(
    `${block("  const updateUsersList = async (", "\n\n  /** Stand the own marker")}\nreturn { updateUsersList, cancelArrival };`,
    scope,
  ) as { updateUsersList: (data: unknown) => Promise<void>; cancelArrival: unknown };
  scope.publishMotionStep.mockImplementation(
    evaluate(
      `${block("  const publishMotionStep = (", "\n\n  /** Copy the live user list")}\nreturn publishMotionStep;`,
      scope,
    ),
  );
  let onEvent = (_data: unknown) => {};
  evaluate(
    block(
      "  // Listen to websocket events for this sector",
      "  useEffect(() => {\n    showUsersRef",
    ),
    {
      ...scope,
      props: { sector: 1 },
      pusher: {},
      updateUsersList,
      cancelArrival,
      useEffect: (effect: () => void) => effect(),
      subscribeSharedChannel: (
        _pusher: unknown,
        _sector: string,
        handlers: { event: typeof onEvent },
      ) => {
        onEvent = handlers.event;
      },
    },
  );
  const releaseStep = async () => {
    expect(sleepers.length).toBeGreaterThan(0);
    sleepers.shift()!();
    // Let the walk and its nested instant merge finish their promise continuations.
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return {
    scope,
    updateUsersList,
    broadcast: (data: unknown) => onEvent(data),
    releaseStep,
    sleepers,
  };
};

it("walks a remote user by identity while others leave the list mid-walk", async () => {
  const { scope, updateUsersList } = walkScope([
    { userId: "leaver", longitude: 9, latitude: 9 },
    { userId: "walker", longitude: 0, latitude: 0 },
    { userId: "bystander", longitude: 5, latitude: 5 },
  ]);
  const walk = updateUsersList({
    userId: "walker",
    sector: 1,
    longitude: 3,
    latitude: 0,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  // A departure shifts every later index while the walk sleeps between steps.
  scope.usersRef.current.splice(0, 1);
  await walk;
  const users = scope.usersRef.current.map((user) => [user.userId, user.longitude]);
  expect(users).toEqual([
    ["walker", 3],
    ["bystander", 5],
  ]);
});

it("ends a remote walk when a newer move for the same user arrives", async () => {
  const { scope, updateUsersList } = walkScope([
    { userId: "walker", longitude: 0, latitude: 0 },
  ]);
  // The first walk is longer, so it would still be stepping after the second one ends.
  const first = updateUsersList({
    userId: "walker",
    sector: 1,
    longitude: 8,
    latitude: 0,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = updateUsersList({
    userId: "walker",
    sector: 1,
    longitude: 1,
    latitude: 3,
  });
  await Promise.all([first, second]);
  expect(scope.usersRef.current).toHaveLength(1);
  expect(scope.usersRef.current[0]).toMatchObject({ longitude: 1, latitude: 3 });
});

const remotePosition = (longitude: number, latitude = 0) => ({
  userId: "walker",
  sector: 1,
  longitude,
  latitude,
});

it("merges hidden broadcasts without paths or timers and animates after reactivation", async () => {
  const test = walkScope([remotePosition(0)], true);
  test.scope.isActiveRef.current = false;
  test.broadcast(remotePosition(10));
  expect(test.scope.usersRef.current[0]).toMatchObject(remotePosition(10));
  expect(test.scope.pathFinderRef.current.getShortestPath).not.toHaveBeenCalled();
  expect(test.scope.sleep).not.toHaveBeenCalled();
  expect(test.scope.publishMotionStep).not.toHaveBeenCalled();
  expect(test.scope.actorRevisionRef.current).toBe(1);
  expect(test.scope.utils.travel.getSectorData.invalidate).not.toHaveBeenCalled();

  test.scope.isActiveRef.current = true;
  test.broadcast(remotePosition(12));
  expect(test.scope.usersRef.current[0]?.longitude).toBe(11);
  expect(test.scope.pathFinderRef.current.getShortestPath).toHaveBeenCalledTimes(1);
  await test.releaseStep();
  expect(test.scope.usersRef.current[0]?.longitude).toBe(12);
  await test.releaseStep();
  expect(test.scope.sleep).toHaveBeenCalledTimes(2);
  expect(test.scope.sleep).toHaveBeenNthCalledWith(1, 100);
  expect(test.scope.publishMotionStep).toHaveBeenCalledTimes(2);
  expect(test.scope.remoteWalksRef.current.size).toBe(0);
  expect(test.scope.motionStepsRef.current.size).toBe(0);
});

it("settles a walk that becomes hidden after its pending step without scheduling more tiles", async () => {
  const test = walkScope([remotePosition(0)], true);
  const walk = test.updateUsersList(remotePosition(10));
  expect(test.scope.usersRef.current[0]?.longitude).toBe(1);
  test.scope.isActiveRef.current = false;
  await test.releaseStep();
  await walk;
  expect(test.scope.usersRef.current[0]).toMatchObject(remotePosition(10));
  expect(test.scope.sleep).toHaveBeenCalledTimes(1);
  expect(test.scope.publishMotionStep).toHaveBeenCalledTimes(1);
  expect(test.scope.remoteWalksRef.current.size).toBe(0);
  expect(test.scope.motionStepsRef.current.size).toBe(0);
  test.scope.isActiveRef.current = true;
  expect(test.scope.usersRef.current[0]?.longitude).toBe(10);
});

it("keeps a newer hidden destination when an older walk callback resumes", async () => {
  const test = walkScope([remotePosition(0)], true);
  const walk = test.updateUsersList(remotePosition(10));
  test.scope.isActiveRef.current = false;
  test.broadcast(remotePosition(20));
  expect(test.scope.usersRef.current[0]?.longitude).toBe(20);
  expect(test.scope.motionStepsRef.current.size).toBe(0);
  await test.releaseStep();
  await walk;
  expect(test.scope.usersRef.current[0]?.longitude).toBe(20);
  expect(test.scope.sleep).toHaveBeenCalledTimes(1);
  expect(test.scope.remoteWalksRef.current.size).toBe(0);
});

it("does not reuse cancelled walk ownership when a scene reactivates before an old callback", async () => {
  const test = walkScope([remotePosition(0)], true);
  const oldWalk = test.updateUsersList(remotePosition(10));
  test.scope.isActiveRef.current = false;
  test.broadcast(remotePosition(20));
  test.scope.isActiveRef.current = true;
  const replacement = test.updateUsersList(remotePosition(22));
  const replacementToken = test.scope.remoteWalksRef.current.get("walker");
  const replacementMotion = test.scope.motionStepsRef.current.get("walker");
  expect(test.scope.usersRef.current[0]?.longitude).toBe(21);
  await test.releaseStep();
  await oldWalk;
  expect(test.scope.usersRef.current[0]?.longitude).toBe(21);
  expect(test.scope.remoteWalksRef.current.get("walker")).toBe(replacementToken);
  expect(test.scope.motionStepsRef.current.get("walker")).toBe(replacementMotion);
  expect(test.scope.sleep).toHaveBeenCalledTimes(2);
  await test.releaseStep();
  await test.releaseStep();
  await replacement;
  expect(test.scope.usersRef.current[0]?.longitude).toBe(22);
  expect(test.scope.remoteWalksRef.current.size).toBe(0);
  expect(test.scope.motionStepsRef.current.size).toBe(0);
});

it.each(["stealth", "departure"])(
  "removes a hidden %s broadcast without animating or refetching",
  (kind) => {
    const test = walkScope([remotePosition(0)], true);
    test.scope.isActiveRef.current = false;
    test.scope.isUserCurrentlyStealthed = () => kind === "stealth";
    test.broadcast({ ...remotePosition(10), sector: kind === "departure" ? 2 : 1 });
    expect(test.scope.usersRef.current).toHaveLength(0);
    expect(test.scope.pathFinderRef.current.getShortestPath).not.toHaveBeenCalled();
    expect(test.scope.sleep).not.toHaveBeenCalled();
    expect(test.scope.utils.travel.getSectorData.invalidate).not.toHaveBeenCalled();
  },
);
